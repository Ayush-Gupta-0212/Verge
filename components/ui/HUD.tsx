'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useUIStore } from '@/stores/useUIStore';
import { useTimerWorker } from '@/lib/workers/useTimerWorker';
import { useTimerStore } from '@/stores/useTimerStore';
import { useTaskStore } from '@/stores/useTaskStore';
import { useScheduleStore } from '@/stores/useScheduleStore';
import { useSubtaskStore } from '@/stores/useSubtaskStore';
import { useUserStore } from '@/stores/useUserStore';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import TopBar from './TopBar';
import FlowView from './FlowView';
import TaskScheduler from './TaskScheduler';
import TimetablePanel from './TimetablePanel';
import VaultView from './VaultView';
import ConstellationPanel from './ConstellationPanel';
import FocusTimerPanel from './FocusTimerPanel';
import Toaster from './Toaster';
import ShortcutsOverlay from './ShortcutsOverlay';
import CommandPalette from './CommandPalette';
import PWAClient from './PWAClient';
import OnboardingModal from './OnboardingModal';
import ChangelogModal from './ChangelogModal';
import { ensureNotificationPermission, notify } from '@/lib/notifications';
import { useIsMobile } from '@/lib/useBreakpoint';
import { useSwipe } from '@/lib/useSwipe';
import { identify, initBrowserTelemetry } from '@/lib/telemetry';
import { maybeSeedFirstRun } from '@/lib/seedFirstRun';
import type { View } from '@/lib/types';

// Order the five views form when swiping. Left swipe → next, right swipe →
// previous. The cycle wraps so the last → first feels continuous.
const VIEW_CYCLE: View[] = ['flow', 'chronos', 'nexus', 'vault', 'astral'];

export default function HUD() {
  const router = useRouter();
  const view = useUIStore((s) => s.view);
  const focusMode = useUIStore((s) => s.focusMode);
  const setFocus = useUIStore((s) => s.setFocus);
  const isMobile = useIsMobile();

  // Initialise auth listener (idempotent) and the lightweight telemetry
  // reporter. Telemetry is a no-op unless NEXT_PUBLIC_SENTRY_DSN is set, so
  // calling it unconditionally is fine.
  const init = useUserStore((s) => s.init);
  useEffect(() => {
    init();
    initBrowserTelemetry();
  }, [init]);

  const authReady = useUserStore((s) => s.authReady);
  const userId    = useUserStore((s) => s.user?.id ?? null);
  const supabaseConfigured = typeof window !== 'undefined' && !!getSupabaseBrowser();

  // Timer worker — stable reset is used in the user-switch effect below.
  const timerWorker = useTimerWorker();
  const resetTimer       = useTimerStore((s) => s.reset);
  const recoverAbandoned = useTimerStore((s) => s.recoverAbandoned);
  const loadTasks    = useTaskStore((s) => s.load);
  const loadSchedule = useScheduleStore((s) => s.load);
  const loadHistory  = useTimerStore((s) => s.loadHistory);
  const loadStars    = useUserStore((s) => s.loadConstellation);
  const loadSubtasks = useSubtaskStore((s) => s.load);
  const loadAchievements = useUserStore((s) => s.loadAchievements);

  // Whenever the signed-in user changes (sign-in / sign-out / cold load):
  //   • leave focus mode (don't leak it across identities)
  //   • zero both the store timer and the worker
  //   • reload all per-user data
  //   • check localStorage for an abandoned focus session (browser closed
  //     mid-focus) and restore it as PAUSED so the user can choose what to do
  useEffect(() => {
    setFocus(false);
    resetTimer();
    timerWorker.reset();
    // Run the per-store loaders first, THEN seed — the seeder only fires when
    // tasks + events + history are all empty after the cloud round-trip.
    (async () => {
      await Promise.all([
        loadTasks(),
        loadSubtasks(),
        loadSchedule(),
        loadHistory(),
        loadStars(),
        loadAchievements(),
      ]);
      recoverAbandoned();
      // First-run seed — drops a few starter tasks + one example event if and
      // only if this user's workspace is genuinely empty. Idempotent.
      if (userId) {
        await maybeSeedFirstRun();
      }
    })();
    // Tell telemetry who's signed in so crash reports are user-attributed.
    identify(userId ? { id: userId } : null);
  }, [
    userId, setFocus, resetTimer, timerWorker, recoverAbandoned,
    loadTasks, loadSubtasks, loadSchedule, loadHistory, loadStars, loadAchievements,
  ]);

  // If we're configured for auth and the session vanishes mid-use, bounce
  // to /login. Wait for `authReady` so we don't redirect during the initial
  // hydration before the first onAuthStateChange fires.
  useEffect(() => {
    if (!supabaseConfigured) return;
    if (!authReady) return;
    if (!userId) router.push('/login');
  }, [userId, authReady, supabaseConfigured, router]);

  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [paletteOpen,   setPaletteOpen]   = React.useState(false);

  // ── mobile swipe ───────────────────────────────────────────────────────
  // Left → next view, right → previous. Disabled on desktop, while any
  // overlay is open, and while the focus mode is taking over the screen.
  const cycleView = (direction: 1 | -1) => {
    const i = VIEW_CYCLE.indexOf(view);
    if (i === -1) return;
    const next = VIEW_CYCLE[(i + direction + VIEW_CYCLE.length) % VIEW_CYCLE.length];
    useUIStore.getState().setView(next);
  };
  useSwipe({
    enabled: isMobile && !focusMode && !paletteOpen && !shortcutsOpen,
    onSwipeLeft:  () => cycleView(1),
    onSwipeRight: () => cycleView(-1),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      const isEditable =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        t?.isContentEditable;

      // Cmd+K / Ctrl+K opens the palette EVEN while typing — it's the
      // universal "search anything" shortcut and should never be blocked.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }

      // Everything else is single-key — ignore while typing or with mods.
      if (isEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const ui = useUIStore.getState();

      if (e.key === 'Escape') {
        if (paletteOpen) { setPaletteOpen(false); return; }
        if (shortcutsOpen) {
          setShortcutsOpen(false);
          return;
        }
        ui.setFocus(false);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (e.key === '1') { ui.setView('flow');    return; }
      if (e.key === '2') { ui.setView('chronos'); return; }
      if (e.key === '3') { ui.setView('nexus');   return; }
      if (e.key === '4') { ui.setView('vault');   return; }
      if (e.key === '5') { ui.setView('astral');  return; }
      if (e.key === 'f' || e.key === 'F') {
        ui.toggleFocus();
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        ui.setView('nexus');
        // Signal the Nexus to open its composer. We use a one-shot custom
        // event so we don't have to thread state through the whole tree.
        window.dispatchEvent(new CustomEvent('verge:new-task'));
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcutsOpen, paletteOpen]);

  // Achievements reconciliation — recomputes earned badges whenever the
  // underlying tallies change. The store's reconcile is a no-op when nothing
  // new qualifies, so this is cheap.
  const tasksForBadges   = useTaskStore((s) => s.tasks);
  const historyForBadges = useTimerStore((s) => s.history);
  const reconcileAchievements = useUserStore((s) => s.reconcileAchievements);
  useEffect(() => {
    // Lazy import inside the effect — `now` only needs to be approximate
    // and re-importing keeps this hook free of `now`-tick jitter.
    const run = async () => {
      const { buildStats, earnedKeys } = await import('@/lib/achievements');
      const stats = buildStats(tasksForBadges, historyForBadges, new Date());
      reconcileAchievements(earnedKeys(stats));
    };
    run();
  }, [tasksForBadges, historyForBadges, reconcileAchievements]);

  // Accent theme — reflect the user's chosen variant on <html data-accent>.
  // The CSS vars defined in globals.css use --accent-rgb so every Tailwind
  // `amber` class (and most inline rgba() box-shadows that use the var)
  // flips when this attribute changes.
  const accent = useUserStore((s) => s.profile?.accent ?? 'amber');
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  // In-app reduced-motion override — same effect as the prefers-reduced-
  // motion media query, but always-on regardless of OS setting.
  const reducedMotion = useUserStore((s) => s.profile?.reduced_motion ?? false);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (reducedMotion) {
      document.documentElement.dataset.reducedMotion = 'true';
    } else {
      delete document.documentElement.dataset.reducedMotion;
    }
  }, [reducedMotion]);

  // Dynamic favicon — stamp the current streak count + amber rim when a
  // focus session is running. Browser-tab as status bar.
  useEffect(() => {
    const compute = async () => {
      const { paintFavicon } = await import('@/lib/dynamicFavicon');
      const { computeStreak } = await import('@/lib/insights');
      const history = useTimerStore.getState().history;
      const tState  = useTimerStore.getState();
      const streak  = computeStreak(history, new Date()).current;
      paintFavicon({
        streak,
        focusActive: tState.running && tState.mode !== 'stopwatch',
      });
    };
    compute();
    // Re-compute on timer state OR history changes. We subscribe to both.
    const unsub1 = useTimerStore.subscribe(compute);
    return () => { unsub1(); };
  }, []);

  // Tab title — surface the active timer ("⏱ 24:13 — Verge") so the user
  // sees the countdown even from another tab. Restored to the default title
  // as soon as the timer pauses, finalizes, or hits zero.
  const tMode    = useTimerStore((s) => s.mode);
  const tRunning = useTimerStore((s) => s.running);
  const tElapsed = useTimerStore((s) => s.elapsed);
  const tTarget  = useTimerStore((s) => s.target);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const base = 'Verge — Time, distilled.';
    if (!tRunning || tMode === 'stopwatch') {
      document.title = base;
      return;
    }
    const remaining = Math.max(0, tTarget - tElapsed);
    const total = Math.floor(remaining / 1000);
    const m = Math.floor(total / 60).toString().padStart(2, '0');
    const s = (total % 60).toString().padStart(2, '0');
    const glyph = tMode === 'break' ? '◐' : '⏱';
    document.title = `${glyph} ${m}:${s} — Verge`;
    return () => { document.title = base; };
  }, [tMode, tRunning, tElapsed, tTarget]);

  // Notifications wiring (Phase B). Asks for permission as soon as either
  // notification flag is on; polls tasks every 60s for due-soon reminders.
  const notifyFocusEnd = useUserStore((s) => s.profile?.notify_focus_end ?? false);
  const notifyDueSoon  = useUserStore((s) => s.profile?.notify_due_reminders ?? false);

  useEffect(() => {
    if (notifyFocusEnd || notifyDueSoon) {
      ensureNotificationPermission();
    }
  }, [notifyFocusEnd, notifyDueSoon]);

  useEffect(() => {
    if (!notifyDueSoon) return;
    const notified = new Set<string>();
    const tick = () => {
      const tasks = useTaskStore.getState().tasks;
      const now = Date.now();
      const horizon = now + 30 * 60 * 1000;
      tasks.forEach((t) => {
        if (t.completed_at || !t.due_at) return;
        const due = new Date(t.due_at).getTime();
        if (due > now && due <= horizon && !notified.has(t.id)) {
          notified.add(t.id);
          const mins = Math.max(1, Math.round((due - now) / 60_000));
          // SW-routed notification with two action buttons. The SW posts
          // a message back to this page when the user taps an action.
          notify(`Due soon — ${t.title}`, `In about ${mins} min`, {
            tag: `due:${t.id}`,
            data: { taskId: t.id, type: 'due-soon' },
            actions: [
              { action: 'snooze:10', title: 'Snooze 10m' },
              { action: 'complete',  title: 'Mark done' },
            ],
          });
        }
      });
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [notifyDueSoon]);

  // Listen for SW notification-click actions. The SW broadcasts the
  // intent + taskId; we resolve it against the live store here so the
  // mutation goes through the same code path as a manual click.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg || msg.type !== 'verge:notification-action') return;
      const { action, taskId, minutes } = msg as {
        action: 'snooze' | 'complete';
        taskId?: string;
        minutes?: number;
      };
      if (!taskId) return;
      if (action === 'complete') {
        useTaskStore.getState().complete(taskId);
      } else if (action === 'snooze') {
        const until = new Date(Date.now() + (minutes ?? 10) * 60_000);
        useTaskStore.getState().snooze(taskId, until);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  if (focusMode) {
    return (
      <>
        <FocusTimerPanel />
        <Toaster />
        <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <CommandPalette   open={paletteOpen}   onClose={() => setPaletteOpen(false)} />
        <PWAClient />
      </>
    );
  }

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-10 flex">
        {/* Sidebar — desktop only. BottomNav handles mobile. */}
        <div className="hidden md:flex">
          <Sidebar />
        </div>
        <div className="pointer-events-none flex flex-1 flex-col">
          {view !== 'nexus' && <TopBar showSearch />}
          <div className="relative flex-1">
            <Slot active={view === 'flow'}><FlowView /></Slot>
            <Slot active={view === 'chronos'}><TimetablePanel /></Slot>
            <Slot active={view === 'nexus'}><TaskScheduler /></Slot>
            <Slot active={view === 'vault'}><VaultView /></Slot>
            <Slot active={view === 'astral'}><ConstellationPanel /></Slot>
          </div>
        </div>
      </div>
      <BottomNav />
      <Toaster />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <OnboardingModal />
      <ChangelogModal />
      <PWAClient />
    </>
  );
}

function Slot({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div
      className={clsx(
        'absolute inset-0 transition-opacity duration-500',
        active ? 'pointer-events-auto opacity-100 animate-fade-in' : 'pointer-events-none opacity-0',
      )}
    >
      {children}
    </div>
  );
}
