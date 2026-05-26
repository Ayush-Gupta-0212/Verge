'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTimerStore } from '@/stores/useTimerStore';
import { useUIStore } from '@/stores/useUIStore';
import { useUserStore } from '@/stores/useUserStore';
import { notify } from '@/lib/notifications';
import { playChime } from '@/lib/sounds';
import { DEFAULT_PREFERENCES } from '@/lib/types';
import {
  AmbientPlayer,
  AMBIENT_LABEL,
  cycleAmbient,
  type AmbientKind,
} from '@/lib/ambient';

// Focus — fullscreen immersion overlay.
//   • Auto-starts a focus block on mount (length from prefs, default 25m).
//   • On completion: offers "Take a break — N min" CTA driven by the user's
//     break_minutes / long_break_minutes / long_break_every settings. Choose
//     the long break automatically every Nth block.
//   • Break runs to completion → "Start next focus block?" CTA → loops.
//   • Existing controls — pause/resume, +15m extend, end now — still work.

const formatMs = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export default function FocusTimerPanel() {
  const mode      = useTimerStore((s) => s.mode);
  const running   = useTimerStore((s) => s.running);
  const elapsed   = useTimerStore((s) => s.elapsed);
  const target    = useTimerStore((s) => s.target);
  const start     = useTimerStore((s) => s.start);
  const pause     = useTimerStore((s) => s.pause);
  const resume    = useTimerStore((s) => s.resume);
  const reset     = useTimerStore((s) => s.reset);
  const finalize  = useTimerStore((s) => s.finalize);
  const setMode   = useTimerStore((s) => s.setMode);
  const setTarget = useTimerStore((s) => s.setTarget);
  const blocksSinceLongBreak = useTimerStore((s) => s.blocksSinceLongBreak);
  const setBlocksSinceLongBreak = useTimerStore((s) => s.setBlocksSinceLongBreak);

  const setFocus = useUIStore((s) => s.setFocus);

  const profile = useUserStore((s) => s.profile);
  const focusMin     = profile?.focus_minutes      ?? DEFAULT_PREFERENCES.focus_minutes;
  const breakMin     = profile?.break_minutes      ?? DEFAULT_PREFERENCES.break_minutes;
  const longBreakMin = profile?.long_break_minutes ?? DEFAULT_PREFERENCES.long_break_minutes;
  const longBreakEvery = profile?.long_break_every ?? DEFAULT_PREFERENCES.long_break_every;

  // The CTA appears AFTER finalize() has incremented the counter for the
  // just-completed focus block. So when the counter has reached the
  // configured cadence, the next break is the long one.
  const nextBreakIsLong = useMemo(
    () => longBreakEvery > 0 && blocksSinceLongBreak >= longBreakEvery,
    [blocksSinceLongBreak, longBreakEvery],
  );
  const nextBreakMinutes = nextBreakIsLong ? longBreakMin : breakMin;

  // Auto-start a focus block when the overlay opens fresh. We always set
  // mode to 'focus' here in case the user is opening from an idle state
  // after a break finalize.
  useEffect(() => {
    if (running || elapsed > 0) return;
    if (mode !== 'focus') setMode('focus');
    setTarget(focusMin * 60_000);
    start();
    // We deliberately only run on mount; re-running would loop the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isComplete = mode !== 'stopwatch' && target > 0 && elapsed >= target;

  // Browser notification on completion (focus + break, both gated on the
  // single profile flag). The chime is gated on the separate sounds toggle
  // so users can have just one, both, or neither.
  const notifyFocusEnd = useUserStore((s) => s.profile?.notify_focus_end ?? false);
  const soundsEnabled  = useUserStore((s) => s.profile?.sounds_enabled ?? false);
  const wasComplete = useRef(false);
  useEffect(() => {
    if (isComplete && !wasComplete.current) {
      if (notifyFocusEnd) {
        const mins = Math.round(target / 60_000);
        const title = mode === 'break' ? 'Break complete' : 'Focus session complete';
        const body  = mode === 'break'
          ? `${mins} min break — ready when you are.`
          : `${mins} min focused — well held.`;
        notify(title, body);
      }
      if (soundsEnabled) playChime();
    }
    wasComplete.current = isComplete;
  }, [isComplete, notifyFocusEnd, soundsEnabled, target, mode]);

  const display = isComplete
    ? formatMs(target)              // freeze at the target value when complete
    : mode === 'stopwatch'
    ? formatMs(elapsed)
    : formatMs(Math.max(0, target - elapsed));

  // ── transitions ─────────────────────────────────────────────────────────
  // Each transition finalizes the *current* segment (writes a session row
  // for focus, increments the Pomodoro counter), resets the timer state,
  // and immediately kicks off the next phase.

  const startBreak = async () => {
    const wasLong = nextBreakIsLong;
    const minutes = nextBreakMinutes;
    await finalize();          // closes the focus segment, increments counter
    if (wasLong) setBlocksSinceLongBreak(0);  // long break consumes the cadence
    setMode('break');
    setTarget(minutes * 60_000);
    start();                   // fresh segment — start() zeros elapsed
  };

  const startNextFocus = async () => {
    await finalize();          // closes the break segment (no DB write)
    setMode('focus');
    setTarget(focusMin * 60_000);
    start();
  };

  const exit = async () => {
    await finalize();
    pause();
    reset();
    setFocus(false);
  };

  const togglePauseResume = () => (running ? pause() : resume());
  const extend = () => setTarget(target + 15 * 60 * 1000);

  const isFocus = mode === 'focus';
  const isBreak = mode === 'break';

  // Status copy shifts based on phase + completion state.
  const statusLabel = isComplete
    ? isBreak ? 'BREAK COMPLETE' : 'SESSION COMPLETE'
    : running
      ? isBreak ? 'BREATHE EASY' : 'DEEP IMMERSION ACTIVE'
      : 'PAUSED';

  return (
    <div className="focus-stage animate-fade-in">
      <button
        onClick={exit}
        aria-label="Exit focus"
        className="absolute right-8 top-8 flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink-mute transition-colors hover:border-amber/40 hover:text-ink"
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none">
          <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      <div className="absolute left-1/2 top-[14%] -translate-x-1/2 text-center">
        <div className={clsx(
          'amber-glow font-display text-7xl font-medium tabular-nums',
          running && !isComplete && 'timer-pulse',
        )}>
          {display}
        </div>
        <div
          className={clsx(
            'mt-2 text-[12px] font-semibold tracking-[0.34em]',
            isComplete ? 'text-amber' : 'text-ink-mute',
          )}
        >
          {statusLabel}
        </div>
        {/* Phase tag below status — explicit "FOCUS" vs "BREAK" so the user
            never confuses which timer is running. */}
        {!isComplete && (isFocus || isBreak) && (
          <div className="mt-1 text-[10px] font-semibold tracking-[0.30em] text-ink-faint">
            {isBreak ? `BREAK · ${Math.round(target / 60_000)}m` : `FOCUS · ${Math.round(target / 60_000)}m`}
          </div>
        )}
        {running && !isComplete && (
          <div className="mt-3 flex justify-center">
            <div className="h-[2px] w-16 rounded-full bg-amber/60 breathe-line" />
          </div>
        )}

        {/* Loop CTAs on completion. Replaces the dead "End now" of the old
            single-shot timer with a real Pomodoro flow. */}
        {isComplete && (
          <div className="mt-6 flex flex-col items-center gap-3">
            {isFocus ? (
              <>
                <button onClick={startBreak} className="btn-amber">
                  Take a {nextBreakMinutes}-min {nextBreakIsLong ? 'long ' : ''}break
                </button>
                <button onClick={exit} className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint hover:text-ink-mute">
                  End session
                </button>
              </>
            ) : (
              <>
                <button onClick={startNextFocus} className="btn-amber">
                  Start next {focusMin}-min focus block
                </button>
                <button onClick={exit} className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint hover:text-ink-mute">
                  Done for now
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-[8%] flex flex-col items-center gap-3">
        <div className="flex items-center justify-center gap-4 md:gap-5">
          <AmbientButton />

          <button
            onClick={togglePauseResume}
            aria-label={running ? 'Pause' : 'Resume'}
            disabled={isComplete}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink-mute transition-colors hover:border-amber/40 hover:text-amber disabled:opacity-30"
          >
            {running ? (
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none">
                <path d="M7 5v10M13 5v10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
                <path d="M6.5 4.5l9 5.5-9 5.5V4.5z" />
              </svg>
            )}
          </button>

          <button onClick={extend} disabled={isComplete} className="btn-ghost disabled:opacity-30">
            Extend +15m
          </button>

          {/* "I got distracted" — silent, tally-style counter persisted to
              the session row on finalize. Only shown while a focus/break
              segment is actually running (not stopwatch, not complete). */}
          {(isFocus || isBreak) && !isComplete && (
            <InterruptionButton />
          )}

          <button
            onClick={exit}
            aria-label="End session"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink-mute transition-colors hover:border-amber/40 hover:text-amber"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none">
              <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────── ambient noise button */

function AmbientButton() {
  const [kind, setKind] = useState<AmbientKind>('off');
  const playerRef = useRef<AmbientPlayer | null>(null);

  useEffect(() => {
    playerRef.current = new AmbientPlayer(0.28);
    return () => {
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  const cycle = async () => {
    const next = cycleAmbient(kind);
    setKind(next);
    if (next === 'off') {
      playerRef.current?.stop();
    } else {
      await playerRef.current?.start(next);
    }
  };

  const active = kind !== 'off';

  return (
    <button
      onClick={cycle}
      aria-label={`Ambient noise: ${AMBIENT_LABEL[kind]}`}
      className={clsx(
        'flex h-10 w-10 items-center justify-center rounded-full border transition-colors',
        active
          ? 'border-amber/40 bg-amber/[0.08] text-amber'
          : 'border-line text-ink-mute hover:border-amber/40 hover:text-amber',
      )}
      title={`Ambient · ${AMBIENT_LABEL[kind]}`}
    >
      <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none">
        {kind === 'off' && (
          <>
            <path d="M3 8v4h3l4 3V5L6 8H3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M14 7l4 6M18 7l-4 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </>
        )}
        {kind !== 'off' && (
          <>
            <path d="M3 8v4h3l4 3V5L6 8H3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M13 7c1.5 1 1.5 5 0 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            {(kind === 'pink' || kind === 'white') && (
              <path d="M16 5c2.5 2 2.5 8 0 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            )}
            {kind === 'white' && (
              <path d="M18.5 3c3 3.5 3 10.5 0 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            )}
          </>
        )}
      </svg>
    </button>
  );
}

// "I got distracted" tally. One tap = +1 logged interruption for the
// current segment. Doesn't pause the timer — the philosophy is *honest
// data, no friction* — but the count appears in a small ring so the user
// sees their tally. Reset when the segment finalizes.
function InterruptionButton() {
  const count = useTimerStore((s) => s.interruptions);
  const bump  = useTimerStore((s) => s.bumpInterruptions);
  return (
    <button
      onClick={bump}
      aria-label="Log an interruption"
      title="Tap when you notice yourself drifting — recorded silently."
      className={clsx(
        'relative flex h-10 w-10 items-center justify-center rounded-full border text-ink-mute transition-colors hover:border-amber/40 hover:text-amber',
        count > 0 ? 'border-amber/40 text-amber' : 'border-line',
      )}
    >
      <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none">
        <path
          d="M10 3v6M10 13.5v.5"
          stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
        />
        <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      {count > 0 && (
        <span
          className="absolute -right-1 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber px-1 text-[9px] font-bold text-bg"
        >
          {count}
        </span>
      )}
    </button>
  );
}
