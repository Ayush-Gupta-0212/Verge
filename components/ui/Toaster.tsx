'use client';

import clsx from 'clsx';
import { useToastStore, type ToastKind } from '@/stores/useToastStore';

// Toast stack — fixed bottom-right, auto-dismissed by the store.
// Surfaces store-level errors (and undo affordances) that previously vanished
// into console.warn.

const KIND_STYLES: Record<ToastKind, string> = {
  error:   'border-red-500/40 bg-red-500/[0.06]',
  success: 'border-amber/40 bg-amber/[0.06]',
  info:    'border-line bg-bg/80',
};

const KIND_DOT: Record<ToastKind, string> = {
  error:   'bg-red-400 shadow-[0_0_10px_2px_rgba(248,113,113,0.5)]',
  success: 'bg-amber shadow-[0_0_10px_2px_rgba(255,138,61,0.5)]',
  info:    'bg-ink-mute',
};

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[60] flex max-w-[360px] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto flex items-start gap-3 rounded-xl border p-3 pr-3 backdrop-blur-md animate-fade-in',
            'shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)]',
            KIND_STYLES[t.kind],
          )}
        >
          <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', KIND_DOT[t.kind])} />
          <p className="flex-1 text-sm leading-snug text-ink">{t.message}</p>
          {t.action && (
            <button
              onClick={t.action.onClick}
              className="shrink-0 rounded-md border border-amber/40 bg-amber/[0.08] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber transition-colors hover:bg-amber/[0.16]"
            >
              {t.action.label}
            </button>
          )}
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 rounded p-1 text-ink-faint transition-colors hover:bg-white/[0.04] hover:text-ink"
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
