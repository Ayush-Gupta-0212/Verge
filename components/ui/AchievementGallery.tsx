'use client';

import clsx from 'clsx';
import { useUserStore } from '@/stores/useUserStore';
import { ACHIEVEMENTS, type AchievementIcon } from '@/lib/achievements';

// 3-col grid of badge tiles. Earned tiles glow; locked tiles are muted with
// a subtle silhouette of the icon so the user knows what to chase.

const ICON_PATHS: Record<AchievementIcon, React.ReactNode> = {
  spark: (
    <path
      d="M10 2.5l1.5 4.5L16 8.5l-4.5 1.5L10 14.5l-1.5-4.5L4 8.5l4.5-1.5L10 2.5z"
      stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
    />
  ),
  check: (
    <>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.5 10l2.5 2.5 5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  wave: (
    <path d="M2 13l3-4 3 3 4-7 3 5 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  ),
  depth: (
    <>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 10h14M10 3a14 14 0 010 14M10 3a14 14 0 000 14" stroke="currentColor" strokeWidth="1" />
    </>
  ),
  crystal: (
    <path
      d="M10 2L4 7l6 11 6-11-6-5zM4 7h12M10 2v16"
      stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
    />
  ),
  thread: (
    <path
      d="M3 5h14M3 10h14M3 15h14"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
    />
  ),
  galaxy: (
    <>
      <circle cx="10" cy="10" r="2" fill="currentColor" />
      <ellipse cx="10" cy="10" rx="7.5" ry="3" stroke="currentColor" strokeWidth="1.2" />
      <ellipse cx="10" cy="10" rx="3" ry="7.5" stroke="currentColor" strokeWidth="1.2" />
    </>
  ),
  dawn: (
    <>
      <path d="M3 13.5h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5 13.5a5 5 0 0110 0" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10 5v2M5 7l1.4 1.4M15 7l-1.4 1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </>
  ),
};

export default function AchievementGallery() {
  const earned = useUserStore((s) => s.achievements);

  const earnedCount = ACHIEVEMENTS.filter((a) => earned.has(a.key)).length;

  return (
    <div className="card p-7">
      <div className="mb-1 flex items-center justify-between">
        <div className="eyebrow">Badges</div>
        <div className="text-xs text-ink-faint tabular-nums">
          {earnedCount} / {ACHIEVEMENTS.length}
        </div>
      </div>
      <p className="mb-5 text-xs text-ink-faint">
        Milestones unlock as you focus and crystallise streams.
      </p>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
        {ACHIEVEMENTS.map((a) => {
          const got = earned.has(a.key);
          return (
            <li
              key={a.key}
              title={`${a.title} — ${a.description}`}
              className={clsx(
                'group flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all',
                got
                  ? 'border-amber/40 bg-amber/[0.05] shadow-[0_0_24px_-12px_rgba(255,138,61,0.7)]'
                  : 'border-line bg-bg/40',
              )}
            >
              <span
                className={clsx(
                  'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
                  got
                    ? 'bg-amber/20 text-amber'
                    : 'bg-white/[0.03] text-ink-faint group-hover:text-ink-mute',
                )}
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none">
                  {ICON_PATHS[a.icon]}
                </svg>
              </span>
              <span
                className={clsx(
                  'text-[11px] font-semibold leading-tight',
                  got ? 'text-amber' : 'text-ink-mute',
                )}
              >
                {a.title}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
