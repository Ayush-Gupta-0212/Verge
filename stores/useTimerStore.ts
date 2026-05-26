import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { TimerSession } from '@/lib/types';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { useUserStore } from '@/stores/useUserStore';
import { toastInfo } from '@/stores/useToastStore';

type Mode = 'stopwatch' | 'focus' | 'break';

interface TimerState {
  mode: Mode;
  running: boolean;
  elapsed: number;
  target: number;
  sessionStart: number | null;
  activeSessionId: string | null;
  // The task this session belongs to. Set on start, surfaced on finalize so
  // history rows carry the right task_id.
  activeTaskId: string | null;
  history: TimerSession[];
  // # of focus blocks completed since the last long break. Drives the
  // "next break is a long one" decision in the Pomodoro loop.
  blocksSinceLongBreak: number;
  // Self-reported "I got distracted" taps for the current segment. Reset
  // alongside the session lifecycle; persisted to timer_sessions on
  // finalize for future quality analytics.
  interruptions: number;
  bumpInterruptions: () => void;

  setMode: (m: Mode) => void;
  setTarget: (ms: number) => void;
  // Manually reset the Pomodoro counter — called when the user starts a
  // long break to "consume" their accumulated focus blocks.
  setBlocksSinceLongBreak: (n: number) => void;
  start: (taskId?: string | null) => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  tick: (elapsed: number) => void;
  finalize: (taskIdOverride?: string | null) => Promise<void>;
  loadHistory: (sinceDays?: number) => Promise<void>;
  // Recover an in-progress session from localStorage on app boot. If the
  // browser was closed mid-focus, the worker died but the persisted state
  // lets us resurrect the session as PAUSED so the user can choose to
  // resume or finalize it.
  recoverAbandoned: () => void;
}

const DEFAULT_FOCUS_TARGET = 25 * 60 * 1000;

// Storage key for crash-recovery. Cleared on reset/finalize.
const PERSIST_KEY = 'verge:timer-state';
const PERSIST_TTL_MS = 24 * 60 * 60 * 1000; // discard sessions > 24h stale.

interface PersistedTimer {
  mode: Mode;
  target: number;
  sessionStart: number;
  activeSessionId: string;
  activeTaskId: string | null;
  lastSeenElapsed: number;
  lastSeenAt: number;
  running: boolean;
}

function readPersisted(): PersistedTimer | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedTimer;
  } catch {
    return null;
  }
}

function writePersisted(p: PersistedTimer): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(p));
  } catch {
    // localStorage full / blocked / SSR — silent.
  }
}

function clearPersisted(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PERSIST_KEY);
  } catch {
    // ignore
  }
}

// Throttle persist writes — the worker ticks 10x/sec; we only need ~1x/sec
// to recover gracefully.
let lastPersistAt = 0;

export const useTimerStore = create<TimerState>((set, get) => ({
  mode: 'focus',
  running: false,
  elapsed: 0,
  target: DEFAULT_FOCUS_TARGET,
  sessionStart: null,
  activeSessionId: null,
  activeTaskId: null,
  history: [],
  blocksSinceLongBreak: 0,
  interruptions: 0,

  bumpInterruptions: () => set((s) => ({ interruptions: s.interruptions + 1 })),

  setMode: (m) =>
    set((s) => ({
      mode: m,
      // Stopwatch counts up — no target. Focus + break both have a target,
      // but the panel is responsible for setting it (uses the user's prefs).
      target: m === 'stopwatch' ? 0 : s.target || DEFAULT_FOCUS_TARGET,
    })),

  setTarget: (ms) => set({ target: ms }),

  setBlocksSinceLongBreak: (n) => set({ blocksSinceLongBreak: Math.max(0, n) }),

  start: (taskId) => {
    if (get().running) return;
    // "Fresh segment" = no live session right now. We zero elapsed in this
    // case so a chained finalize → start (Pomodoro break loop) doesn't carry
    // the previous segment's accumulated minutes into the new one.
    const wasFresh = get().sessionStart == null;
    const sessionStart = get().sessionStart ?? Date.now();
    const activeSessionId = get().activeSessionId ?? uuid();
    const activeTaskId = get().activeTaskId ?? taskId ?? null;
    set({
      running: true,
      sessionStart,
      activeSessionId,
      activeTaskId,
      // Fresh segment resets per-segment counters (elapsed already handled
      // above; interruptions tracked here so a chained focus → break →
      // focus doesn't double-count).
      ...(wasFresh ? { elapsed: 0, interruptions: 0 } : {}),
    });
    writePersisted({
      mode: get().mode,
      target: get().target,
      sessionStart,
      activeSessionId,
      activeTaskId,
      lastSeenElapsed: get().elapsed,
      lastSeenAt: Date.now(),
      running: true,
    });
  },

  pause: () => {
    set({ running: false });
    const { mode, target, sessionStart, activeSessionId, activeTaskId, elapsed } = get();
    if (sessionStart && activeSessionId) {
      writePersisted({
        mode, target, sessionStart, activeSessionId, activeTaskId,
        lastSeenElapsed: elapsed,
        lastSeenAt: Date.now(),
        running: false,
      });
    }
  },
  resume: () => {
    set({ running: true });
    const { mode, target, sessionStart, activeSessionId, activeTaskId, elapsed } = get();
    if (sessionStart && activeSessionId) {
      writePersisted({
        mode, target, sessionStart, activeSessionId, activeTaskId,
        lastSeenElapsed: elapsed,
        lastSeenAt: Date.now(),
        running: true,
      });
    }
  },

  reset: () => {
    set({
      running: false,
      elapsed: 0,
      sessionStart: null,
      activeSessionId: null,
      activeTaskId: null,
      interruptions: 0,
    });
    clearPersisted();
  },

  tick: (elapsed) => {
    const { mode, target, running, sessionStart, activeSessionId, activeTaskId } = get();
    set({ elapsed });
    // Auto-pause when any countdown hits its target — focus AND break.
    // (Stopwatch counts up forever and is the only mode without a target.)
    if (running && mode !== 'stopwatch' && target > 0 && elapsed >= target) {
      set({ running: false });
    }
    // Persist at most ~1/sec; the worker ticks 10x/sec.
    const now = Date.now();
    if (running && sessionStart && activeSessionId && now - lastPersistAt > 1000) {
      lastPersistAt = now;
      writePersisted({
        mode,
        target,
        sessionStart,
        activeSessionId,
        activeTaskId,
        lastSeenElapsed: elapsed,
        lastSeenAt: now,
        running: true,
      });
    }
  },

  finalize: async (taskIdOverride) => {
    const { mode, elapsed, sessionStart, activeSessionId, activeTaskId, blocksSinceLongBreak, interruptions } = get();
    if (!activeSessionId || !sessionStart) return;
    const taskId =
      taskIdOverride !== undefined ? taskIdOverride : activeTaskId;

    // Bookkeep the Pomodoro counter:
    //   • completing a focus block increments
    //   • completing a break that was scheduled as the long one resets to 0
    //   • short breaks leave the counter alone (the next focus will tick it)
    let nextBlocks = blocksSinceLongBreak;
    if (mode === 'focus') nextBlocks = blocksSinceLongBreak + 1;

    set((s) => ({
      running: false,
      sessionStart: null,
      activeSessionId: null,
      activeTaskId: null,
      blocksSinceLongBreak: nextBlocks,
      interruptions: 0,
      // Only focus + stopwatch are kept as analytics rows. Breaks are
      // ephemeral — no value in cluttering history with them.
      history:
        mode === 'break'
          ? s.history
          : [
              {
                id: activeSessionId,
                user_id: useUserStore.getState().user?.id ?? null,
                kind: mode === 'focus' ? 'focus' : 'stopwatch',
                started_at: new Date(sessionStart).toISOString(),
                ended_at: new Date().toISOString(),
                duration_ms: elapsed,
                task_id: taskId,
                interruptions,
              },
              ...s.history,
            ],
    }));
    clearPersisted();

    if (mode === 'break') return; // no DB write for breaks

    const user = useUserStore.getState().user;
    const session: TimerSession = {
      id: activeSessionId,
      user_id: user?.id ?? null,
      kind: mode === 'focus' ? 'focus' : 'stopwatch',
      started_at: new Date(sessionStart).toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: elapsed,
      task_id: taskId,
      interruptions,
    };
    const supabase = getSupabaseBrowser();
    if (supabase && user) {
      // Defensive insert: if the user hasn't run the Phase 6 migration the
      // `interruptions` column won't exist; we drop the field and retry once
      // so old DBs still record the session.
      const { error } = await supabase.from('timer_sessions').insert(session);
      if (error && /column .*interruptions.*does not exist|could not find the 'interruptions'/i.test(error.message)) {
        const { interruptions: _drop, ...rest } = session;
        void _drop;
        await supabase.from('timer_sessions').insert(rest);
      }
    }
  },

  loadHistory: async (sinceDays = 365) => {
    const supabase = getSupabaseBrowser();
    const user = useUserStore.getState().user;
    if (!supabase || !user) return;
    // Replaces the previous .limit(50) — that cap silently truncated insights
    // for any user with more than ~2 weeks of activity. A 365-day window
    // gives the histograms and "top tasks" views the data they need without
    // pulling lifetime rows on every load.
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('timer_sessions')
      .select('*')
      .eq('user_id', user.id)
      .gte('started_at', since)
      .order('started_at', { ascending: false });
    if (data) set({ history: data as TimerSession[] });
  },

  recoverAbandoned: () => {
    if (get().activeSessionId) return;     // a fresh session is already live
    const p = readPersisted();
    if (!p) return;

    // Discard truly stale sessions (more than 24h since last seen) — almost
    // certainly the user moved on.
    if (Date.now() - p.lastSeenAt > PERSIST_TTL_MS) {
      clearPersisted();
      return;
    }

    // Restore as PAUSED so we don't keep counting time the user wasn't
    // actually working. The user can resume from the focus overlay.
    set({
      mode: p.mode,
      target: p.target,
      elapsed: p.lastSeenElapsed,
      sessionStart: p.sessionStart,
      activeSessionId: p.activeSessionId,
      activeTaskId: p.activeTaskId,
      running: false,
    });

    const mins = Math.max(1, Math.round(p.lastSeenElapsed / 60000));
    toastInfo(
      `Resumed paused ${p.mode} session — ${mins} min logged. Open Focus to continue.`,
    );
  },
}));
