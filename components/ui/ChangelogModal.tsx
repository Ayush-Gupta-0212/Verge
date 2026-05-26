'use client';

import { useEffect, useState } from 'react';
import { useUserStore } from '@/stores/useUserStore';
import { CHANGELOG, getCurrentAppVersion } from '@/lib/changelog';

// ----------------------------------------------------------------------------
// Changelog modal.
//
// Pops once per user × version when the bundle's version is newer than the
// last value stored at `verge:last-seen-version:<userId>`. Stays out of the
// way: only fires after onboarding has been completed (we don't pile two
// modals on the same first sign-in).
// ----------------------------------------------------------------------------

const STORAGE_PREFIX = 'verge:last-seen-version:';
const ONBOARDED_PREFIX = 'verge:onboarded-v1:';

function lastSeen(userId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + userId);
  } catch {
    return null;
  }
}

function markSeen(userId: string, version: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + userId, version);
  } catch {
    /* ignore */
  }
}

function hasCompletedOnboarding(userId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(ONBOARDED_PREFIX + userId) === '1';
  } catch {
    return false;
  }
}

export default function ChangelogModal() {
  const userId = useUserStore((s) => s.user?.id ?? null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!userId) {
      setOpen(false);
      return;
    }
    // Don't pile on the onboarding modal — wait until the user has finished
    // (or skipped) that one before showing the changelog.
    if (!hasCompletedOnboarding(userId)) {
      setOpen(false);
      return;
    }
    const current = getCurrentAppVersion();
    const seen = lastSeen(userId);

    if (seen === null) {
      // First time the changelog has ever run for this user → silently mark
      // them as current. We don't want to dump a release-notes wall on a
      // user who just signed up.
      markSeen(userId, current);
      setOpen(false);
      return;
    }

    // Only pop when the version actually moved forward.
    if (seen !== current) {
      setOpen(true);
    }
  }, [userId]);

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

  // Find every entry strictly newer than the last seen version. Falls back
  // to just the top entry if we can't compare (unknown old version).
  const current = getCurrentAppVersion();
  const seen = lastSeen(userId) || '0.0.0';
  const entries = CHANGELOG.filter((e) => semverGt(e.version, seen));
  const show = entries.length > 0 ? entries : CHANGELOG.slice(0, 1);

  const dismiss = () => {
    markSeen(userId, current);
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="changelog-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 px-4 backdrop-blur-md"
      onClick={dismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card w-[min(94vw,520px)] p-9 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.20em] text-amber">
              What's new
            </div>
            <h2 id="changelog-title" className="mt-1 font-display text-2xl font-light text-ink">
              Verge {show[0].version}
            </h2>
          </div>
          <button
            onClick={dismiss}
            aria-label="Close"
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

        <div className="mt-6 space-y-6">
          {show.map((entry) => (
            <div key={entry.version}>
              <div className="mb-2 flex items-baseline gap-2 text-[11px] uppercase tracking-[0.16em] text-ink-faint">
                <span className="text-amber font-semibold">{entry.version}</span>
                <span>·</span>
                <span>{entry.date}</span>
              </div>
              <div className="text-sm font-medium text-ink">{entry.title}</div>
              <ul className="mt-2 space-y-1.5">
                {entry.bullets.map((b, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-mute"
                  >
                    <span
                      aria-hidden
                      className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-amber"
                    />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-end">
          <button
            onClick={dismiss}
            className="btn-amber px-5 py-2 text-[11px] uppercase tracking-[0.16em]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

// Compares "1.2.3" > "1.2.0" → true. Naïve but adequate for our linear
// version line. Non-numeric segments compare lexicographically; missing
// trailing segments are treated as 0.
function semverGt(a: string, b: string): boolean {
  const partsA = a.split('.');
  const partsB = b.split('.');
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(partsA[i] ?? '0', 10);
    const nb = parseInt(partsB[i] ?? '0', 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const sa = partsA[i] ?? '';
      const sb = partsB[i] ?? '';
      if (sa > sb) return true;
      if (sa < sb) return false;
      continue;
    }
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false;
}
