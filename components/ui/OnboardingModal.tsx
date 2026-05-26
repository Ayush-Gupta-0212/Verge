'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useUserStore } from '@/stores/useUserStore';
import { useUIStore } from '@/stores/useUIStore';

// ----------------------------------------------------------------------------
// Onboarding modal.
//
// Fires once per (user × device) on first sign-in. The trigger logic lives
// inside this component so it can self-suppress as soon as it mounts and
// the user has already seen it — no extra wiring in HUD beyond rendering
// the component.
//
// Persisted via localStorage key `verge:onboarded-v1:<userId>`. Bump the
// version suffix on a future redesign to re-onboard everyone.
// ----------------------------------------------------------------------------

const STORAGE_PREFIX = 'verge:onboarded-v1:';

interface Step {
  eyebrow: string;
  title: string;
  body: string;
  swatch: string; // hex for the leading swatch dot
}

const STEPS: Step[] = [
  {
    eyebrow: 'Flow',
    title: 'Your daily orientation',
    body:
      "The home dashboard. A greeting, today's tiles, your streak and progress ring. Open the app and you land here.",
    swatch: '#ff8a3d',
  },
  {
    eyebrow: 'Chronos · Nexus',
    title: 'Plan and schedule',
    body:
      'Nexus is for tasks (lists, priorities, focus sessions). Chronos is the calendar — drag to draft an event, click an event to edit. Use Cmd/Ctrl + K to jump anywhere.',
    swatch: '#b8d4e3',
  },
  {
    eyebrow: 'Focus · Vault · Astral',
    title: 'Do the work, then look back',
    body:
      'Focus is the fullscreen immersion overlay (Pomodoro + breathing). Vault archives every cleared task. Astral is your profile, badges, and richer analytics.',
    swatch: '#7df0c8',
  },
];

function alreadyOnboarded(userId: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + userId) === '1';
  } catch {
    return false;
  }
}

function markOnboarded(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + userId, '1');
  } catch {
    /* ignore */
  }
}

export default function OnboardingModal() {
  const userId = useUserStore((s) => s.user?.id ?? null);
  const profile = useUserStore((s) => s.profile);
  const setView = useUIStore((s) => s.setView);
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);

  // Decide whether to show on mount + whenever the signed-in user changes.
  useEffect(() => {
    if (!userId) {
      setOpen(false);
      return;
    }
    if (alreadyOnboarded(userId)) {
      setOpen(false);
      return;
    }
    setStep(0);
    setOpen(true);
  }, [userId]);

  // Esc closes (marks onboarded — they saw it).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !userId) return null;

  const dismiss = () => {
    if (userId) markOnboarded(userId);
    setOpen(false);
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else {
      // On the last step, "Get started" jumps to Nexus so the user lands
      // somewhere they can act on the starter tasks they just received.
      setView('nexus');
      dismiss();
    }
  };

  const back = () => setStep(Math.max(0, step - 1));

  const greeting =
    profile?.display_name && profile.display_name !== 'Stargazer'
      ? `Welcome, ${profile.display_name}`
      : 'Welcome to Verge';

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 px-4 backdrop-blur-md"
      onClick={dismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-[min(94vw,520px)] p-9 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
      >
        {/* Header — greeting + step counter */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.20em] text-amber">
              {greeting}
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              A quick tour — under a minute.
            </p>
          </div>
          <button
            onClick={dismiss}
            aria-label="Close onboarding"
            className="text-ink-faint hover:text-amber transition-colors"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Step body */}
        <div className="mt-7">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{
                background: current.swatch,
                boxShadow: `0 0 14px 2px ${current.swatch}99`,
              }}
            />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
              {current.eyebrow}
            </span>
          </div>
          <h2
            id="onboarding-title"
            className="mt-3 font-display text-2xl font-light leading-tight text-ink"
          >
            {current.title}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-mute">
            {current.body}
          </p>
        </div>

        {/* Step indicator */}
        <div className="mt-8 flex items-center justify-center gap-2">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              aria-label={`Go to step ${i + 1}`}
              className={clsx(
                'h-1.5 rounded-full transition-all',
                i === step ? 'w-6 bg-amber' : 'w-1.5 bg-white/20 hover:bg-white/40',
              )}
            />
          ))}
        </div>

        {/* Footer — controls */}
        <div className="mt-8 flex items-center justify-between gap-3">
          <button
            onClick={dismiss}
            className="text-[11px] uppercase tracking-[0.16em] text-ink-faint hover:text-ink transition-colors"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={back}
                className="rounded-full border border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-mute transition-colors hover:border-amber/40 hover:text-amber"
              >
                Back
              </button>
            )}
            <button
              onClick={next}
              className="btn-amber px-5 py-2 text-[11px] uppercase tracking-[0.16em]"
            >
              {isLast ? 'Get started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
