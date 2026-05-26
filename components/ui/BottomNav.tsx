'use client';

import clsx from 'clsx';
import { useUIStore } from '@/stores/useUIStore';
import { useUserStore } from '@/stores/useUserStore';
import type { View } from '@/lib/types';

// Mobile-only bottom tab bar. Mirrors the desktop sidebar's 5 nav items
// horizontally. Hidden on `md` and up via Tailwind.

const Sparkle = () => (
  <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
    <path d="M10 2.5l1.5 4.5L16 8.5l-4.5 1.5L10 14.5l-1.5-4.5L4 8.5l4.5-1.5L10 2.5z"
      stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);
const Wave = () => (
  <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
    <path d="M2 13l3-4 3 3 4-7 3 5 3-3" stroke="currentColor" strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Nexus = () => (
  <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
    <circle cx="10" cy="10" r="1.6" fill="currentColor" />
    <circle cx="10" cy="3"  r="1.4" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="10" cy="17" r="1.4" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="3"  cy="10" r="1.4" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="17" cy="10" r="1.4" stroke="currentColor" strokeWidth="1.2" />
    <path d="M10 4.4v4M10 11.6v4M4.4 10h4M11.6 10h4"
      stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>
);
const Vault = () => (
  <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
    <rect x="3" y="4" width="14" height="13" rx="2"
      stroke="currentColor" strokeWidth="1.3" />
    <path d="M3 8h14" stroke="currentColor" strokeWidth="1.3" />
    <path d="M9 12.5h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
const Astral = () => (
  <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
    <circle cx="10" cy="7.5" r="3" stroke="currentColor" strokeWidth="1.3" />
    <path d="M3.5 17c1.4-2.8 4-4 6.5-4s5.1 1.2 6.5 4"
      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const ITEMS: Array<{ id: View; label: string; icon: React.ReactNode }> = [
  { id: 'flow',    label: 'Flow',    icon: <Sparkle /> },
  { id: 'chronos', label: 'Chronos', icon: <Wave /> },
  { id: 'nexus',   label: 'Nexus',   icon: <Nexus /> },
  { id: 'vault',   label: 'Vault',   icon: <Vault /> },
  { id: 'astral',  label: 'Astral',  icon: <Astral /> },
];

export default function BottomNav() {
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const avatarUrl = useUserStore((s) => s.profile?.avatar_url ?? null);

  return (
    <nav
      className="pointer-events-auto fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/85 backdrop-blur-xl md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex items-stretch justify-around">
        {ITEMS.map((item) => {
          const active = view === item.id;
          // Astral gets the user's avatar (when set) instead of the
          // generic silhouette — mobile's primary identity cue.
          const showAvatar = item.id === 'astral' && !!avatarUrl;
          return (
            <li key={item.id} className="flex-1">
              <button
                onClick={() => setView(item.id)}
                className={clsx(
                  'relative flex w-full flex-col items-center justify-center gap-1 py-2.5 transition-colors',
                  active ? 'text-amber' : 'text-ink-faint hover:text-ink-mute',
                )}
                aria-current={active ? 'page' : undefined}
              >
                {active && (
                  <span className="absolute top-0 left-1/2 h-[2px] w-8 -translate-x-1/2 rounded-b bg-amber shadow-[0_0_10px_2px_rgba(255,138,61,0.45)]" />
                )}
                {showAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl!}
                    alt="You"
                    className={clsx(
                      'h-5 w-5 rounded-full object-cover ring-1 transition-all',
                      active ? 'ring-amber' : 'ring-line',
                    )}
                  />
                ) : (
                  item.icon
                )}
                <span className="text-[10px] font-medium tracking-[0.10em]">
                  {item.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
