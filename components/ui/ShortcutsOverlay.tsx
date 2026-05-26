'use client';

import { useEffect } from 'react';

interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

const GROUPS: Array<{
  title: string;
  items: Array<{ keys: string[]; label: string }>;
}> = [
  {
    title: 'Views',
    items: [
      { keys: ['1'], label: 'Flow' },
      { keys: ['2'], label: 'Chronos' },
      { keys: ['3'], label: 'Nexus' },
      { keys: ['4'], label: 'Vault' },
      { keys: ['5'], label: 'Astral' },
    ],
  },
  {
    title: 'Actions',
    items: [
      { keys: ['⌘', 'k'], label: 'Command palette — search anything' },
      { keys: ['f'], label: 'Toggle focus mode' },
      { keys: ['n'], label: 'New task — opens Nexus composer' },
      { keys: ['?'], label: 'Show this overlay' },
      { keys: ['esc'], label: 'Exit focus / close overlay' },
    ],
  },
  {
    title: 'Nexus list',
    items: [
      { keys: ['↑', '↓'], label: 'Move selection between streams' },
      { keys: ['c'], label: 'Mark selected stream complete' },
      { keys: ['e'], label: 'Edit selected stream title' },
      { keys: ['⌘', '⌫'], label: 'Delete selected stream' },
    ],
  },
];

export default function ShortcutsOverlay({ open, onClose }: ShortcutsOverlayProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
      <div
        className="card relative z-10 w-[min(92vw,520px)] p-7 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="eyebrow-amber">Keyboard</div>
            <h2 className="mt-2 font-display text-2xl font-light text-ink">
              Shortcuts
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-ink-faint transition-colors hover:bg-amber/[0.06] hover:text-ink"
            aria-label="Close"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="mt-6 space-y-6">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="eyebrow mb-2">{g.title}</div>
              <ul className="space-y-1.5">
                {g.items.map((item) => (
                  <li key={item.label} className="flex items-center justify-between">
                    <span className="text-sm text-ink">{item.label}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k) => (
                        <kbd
                          key={k}
                          className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border border-line bg-bg/60 px-1.5 text-[11px] font-medium uppercase text-ink-mute"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
