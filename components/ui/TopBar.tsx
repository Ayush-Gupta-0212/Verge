'use client';

import { useUIStore } from '@/stores/useUIStore';
import { useUserStore } from '@/stores/useUserStore';

// Verge top header — wordmark + (optional) search + profile shortcut.
// Compact at mobile widths; the profile button moves into the search row
// so the brand can stay visible while everything still fits.
export default function TopBar({ showSearch = true }: { showSearch?: boolean }) {
  const search = useUIStore((s) => s.search);
  const setSearch = useUIStore((s) => s.setSearch);
  const setView = useUIStore((s) => s.setView);
  const avatarUrl = useUserStore((s) => s.profile?.avatar_url ?? null);

  return (
    <header className="pointer-events-auto z-20 flex flex-wrap items-center justify-between gap-3 px-4 py-4 md:gap-6 md:px-10 md:py-6">
      <div className="flex items-center gap-2">
        <img
          src="/logo.png"
          alt="Verge"
          width={40}
          height={40}
          className="h-10 w-10 object-contain"
        />
        <span className="font-display text-xl font-light tracking-tight text-amber md:text-2xl">
          Verge
        </span>
      </div>

      {showSearch ? (
        <div className="relative order-3 w-full max-w-[640px] flex-1 md:order-2 md:w-auto">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the void…"
            className="w-full rounded-full border border-line bg-bg/60 px-5 py-2.5 pr-12 text-sm text-ink placeholder:text-ink-faint focus:border-amber/30 focus:outline-none transition-colors md:px-6 md:py-3.5"
          />
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint md:right-5"
          >
            <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M13.5 13.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </div>
      ) : (
        <div className="hidden flex-1 md:block" />
      )}

      <button
        onClick={() => setView('astral')}
        aria-label="Open profile"
        className="order-2 flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-line text-amber transition-colors hover:border-amber/30 hover:bg-amber/[0.05] md:order-3 md:h-10 md:w-10"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt="Your profile"
            className="h-full w-full object-cover"
          />
        ) : (
          <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
            <circle cx="10" cy="7.5" r="3" stroke="currentColor" strokeWidth="1.3" />
            <path d="M4 17c1.4-2.5 3.6-3.5 6-3.5s4.6 1 6 3.5"
              stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </header>
  );
}
