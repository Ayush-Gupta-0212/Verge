'use client';

import type { ReactNode } from 'react';
import clsx from 'clsx';

// ----------------------------------------------------------------------------
// EmptyState — uniform "nothing here yet" panel.
//
// Replaces ad-hoc "no items" sentences across the app. Soft amber-on-dark
// styling matching the rest of Verge, with three optional pieces:
//   • icon      — a simple SVG glyph (defaults to a constellation spark)
//   • title     — single short line, like a card header
//   • body      — one-sentence explanation of what would normally appear
//   • action    — primary CTA (a button or link) that lets the user start
//
// Variants:
//   • size="md" (default) — used as a section-level empty
//   • size="sm"           — slimmer footprint for inline / sidebar use
// ----------------------------------------------------------------------------

interface EmptyStateProps {
  title: string;
  body?: string;
  icon?: ReactNode;
  action?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}

export default function EmptyState({
  title,
  body,
  icon,
  action,
  size = 'md',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center',
        size === 'md' ? 'gap-3 px-6 py-12' : 'gap-2 px-4 py-6',
        className,
      )}
    >
      <div
        className={clsx(
          'flex items-center justify-center rounded-full border border-amber/25 bg-amber/[0.05]',
          size === 'md' ? 'h-14 w-14' : 'h-10 w-10',
        )}
      >
        {icon ?? <DefaultIcon size={size} />}
      </div>
      <h3
        className={clsx(
          'font-display font-light text-ink',
          size === 'md' ? 'text-lg' : 'text-base',
        )}
      >
        {title}
      </h3>
      {body && (
        <p
          className={clsx(
            'max-w-[420px] leading-relaxed text-ink-mute',
            size === 'md' ? 'text-sm' : 'text-xs',
          )}
        >
          {body}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

function DefaultIcon({ size }: { size: 'sm' | 'md' }) {
  const px = size === 'md' ? 22 : 18;
  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      className="text-amber"
      aria-hidden
    >
      <path
        d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="6" r="0.9" fill="currentColor" />
      <circle cx="5" cy="18" r="0.9" fill="currentColor" />
    </svg>
  );
}
