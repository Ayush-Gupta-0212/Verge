'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useIsMobile } from '@/lib/useBreakpoint';

// Pull-to-refresh — wraps a scroll container, exposes an amber indicator
// when the user drags down from the top, and fires `onRefresh` when the
// drag passes the threshold. Mobile-only; on desktop the component is
// transparent (renders children with no extra handlers).
//
// Designed for the page-level scrollers in Chronos and Vault. The host
// scroll container must own its own overflow-y; we just listen to its
// touch events.

const TRIGGER_PX = 70;
const MAX_PULL   = 110;

interface Props {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
  className?: string;
}

export default function PullToRefresh({ onRefresh, children, className }: Props) {
  const isMobile = useIsMobile();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const trackingRef = useRef(false);
  const startYRef = useRef(0);

  useEffect(() => {
    if (!isMobile) return;
    const el = wrapRef.current;
    if (!el) return;

    const findScroller = (): HTMLElement => {
      // The host page usually has overflow-y on a parent; we still listen
      // on `el` and check the nearest scrollTop=0 ancestor as "at top."
      let cur: HTMLElement | null = el;
      while (cur) {
        const style = window.getComputedStyle(cur);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') return cur;
        cur = cur.parentElement;
      }
      return el;
    };

    const onTouchStart = (e: TouchEvent) => {
      const scroller = findScroller();
      if (scroller.scrollTop > 0) return;        // only pull when already at top
      trackingRef.current = true;
      startYRef.current = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!trackingRef.current) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) {
        setPull(0);
        return;
      }
      // Damping — feels like rubber-band resistance past the trigger.
      const damped = dy < TRIGGER_PX ? dy : TRIGGER_PX + (dy - TRIGGER_PX) * 0.4;
      setPull(Math.min(MAX_PULL, damped));
    };
    const onTouchEnd = async () => {
      if (!trackingRef.current) return;
      trackingRef.current = false;
      if (pull >= TRIGGER_PX && !busy) {
        setBusy(true);
        try { await onRefresh(); }
        finally {
          setBusy(false);
          setPull(0);
        }
      } else {
        setPull(0);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove',  onTouchMove,  { passive: true });
    el.addEventListener('touchend',   onTouchEnd,   { passive: true });
    el.addEventListener('touchcancel', onTouchEnd,  { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
      el.removeEventListener('touchend',   onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isMobile, pull, busy, onRefresh]);

  const progress = Math.min(1, pull / TRIGGER_PX);

  return (
    <div ref={wrapRef} className={clsx('relative', className)}>
      {/* Amber chevron indicator. Anchored at the top of the host; rotates
          and fades in proportional to the pull distance. The spinner takes
          over once we cross the trigger or while busy. */}
      {isMobile && (pull > 0 || busy) && (
        <div
          className="pointer-events-none absolute left-1/2 z-30 -translate-x-1/2"
          style={{ top: Math.max(8, pull - 32) }}
          aria-hidden
        >
          <div
            className={clsx(
              'flex h-8 w-8 items-center justify-center rounded-full border border-amber/40 bg-bg-deep/85 backdrop-blur-md transition-colors',
              (busy || progress >= 1) && 'border-amber',
            )}
          >
            {busy ? (
              <svg viewBox="0 0 20 20" className="h-4 w-4 animate-spin text-amber" fill="none">
                <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.6" strokeDasharray="20 12" strokeLinecap="round" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 20 20"
                className="h-4 w-4 text-amber transition-transform"
                style={{ transform: `rotate(${progress * 180}deg)`, opacity: 0.4 + progress * 0.6 }}
                fill="none"
              >
                <path d="M10 4v10M5 9l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
