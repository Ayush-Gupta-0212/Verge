'use client';

import clsx from 'clsx';
import { useUIStore } from '@/stores/useUIStore';
import type { View } from '@/lib/types';

interface NavItem {
  id: View;
  label: string;
  icon: React.ReactNode;
}

const Sparkle = () => (
  <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
    <path
      d="M10 2.5l1.5 4.5L16 8.5l-4.5 1.5L10 14.5l-1.5-4.5L4 8.5l4.5-1.5L10 2.5z"
      stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
    />
    <path d="M15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"
      stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
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

const ITEMS: NavItem[] = [
  { id: 'flow',    label: 'Flow',    icon: <Sparkle /> },
  { id: 'chronos', label: 'Chronos', icon: <Wave /> },
  { id: 'nexus',   label: 'Nexus',   icon: <Nexus /> },
  { id: 'vault',   label: 'Vault',   icon: <Vault /> },
  { id: 'astral',  label: 'Astral',  icon: <Astral /> },
];

export default function Sidebar() {
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);

  return (
    <aside className="pointer-events-auto z-30 flex h-full w-[100px] shrink-0 flex-col items-center border-r border-line bg-bg/40 backdrop-blur-md">
      <div className="flex h-24 w-full items-center justify-center">
        <img
          src="/logo.png"
          alt="Verge"
          width={72}
          height={72}
          className="h-[72px] w-[72px] object-contain"
        />
      </div>

      <nav className="mt-2 flex flex-1 flex-col items-center gap-1 py-2">
        {ITEMS.map((item) => {
          const active = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={clsx(
                'relative flex w-[84px] flex-col items-center gap-1.5 rounded-2xl px-2 py-3 transition-colors',
                active
                  ? 'bg-amber/[0.07] text-amber'
                  : 'text-ink-faint hover:text-ink-mute',
              )}
              aria-current={active ? 'page' : undefined}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full bg-amber shadow-[0_0_12px_2px_rgba(255,138,61,0.45)]" />
              )}
              <span className={clsx(active ? 'text-amber' : '')}>{item.icon}</span>
              <span className="text-[11px] font-medium tracking-[0.14em]">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Footer kept intentionally minimal — no decorative no-op controls. */}
      <div className="mb-6 h-1 w-6 rounded-full bg-amber/20" aria-hidden />
    </aside>
  );
}
