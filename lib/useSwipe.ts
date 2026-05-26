'use client';

import { useEffect } from 'react';

interface SwipeOptions {
  enabled?: boolean;            // master kill-switch (e.g. disabled on desktop)
  minDistance?: number;         // px the touch must cover horizontally
  maxVerticalDrift?: number;    // reject as vertical scroll if exceeded
  maxDuration?: number;         // ms — fling-only, not slow drags
  onSwipeLeft?:  () => void;
  onSwipeRight?: () => void;
}

// Edge-triggered horizontal swipe detector. Mounted once at the HUD root.
//
// Heuristics chosen for "feels like a real swipe":
//   • At least 60 px of horizontal travel
//   • Vertical drift under 50 px (so vertical scrolls aren't hijacked)
//   • Under 600 ms total (flicks, not slow drags)
//   • Ignores gestures starting on elements that opt out via
//     [data-no-swipe] — pages with their own horizontal scroller can set it
export function useSwipe(opts: SwipeOptions): void {
  const {
    enabled = true,
    minDistance = 60,
    maxVerticalDrift = 50,
    maxDuration = 600,
    onSwipeLeft,
    onSwipeRight,
  } = opts;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    let startX = 0, startY = 0, startT = 0;
    let optedOut = false;

    const isOptedOut = (target: EventTarget | null): boolean => {
      let el = target as HTMLElement | null;
      while (el) {
        if (el.hasAttribute && el.hasAttribute('data-no-swipe')) return true;
        // Also opt out for native scrollable rails — the day timetable
        // gets sideways scrolling on mobile and the user should be able
        // to scroll it without triggering a view swipe.
        try {
          const style = window.getComputedStyle(el);
          if (
            (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
            el.scrollWidth > el.clientWidth
          ) {
            return true;
          }
        } catch { /* ignore */ }
        el = el.parentElement;
      }
      return false;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startT = performance.now();
      optedOut = isOptedOut(e.target);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (optedOut) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = performance.now() - startT;
      if (dt > maxDuration) return;
      if (Math.abs(dy) > maxVerticalDrift) return;
      if (Math.abs(dx) < minDistance) return;
      if (dx < 0) onSwipeLeft?.();
      else        onSwipeRight?.();
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend',   onTouchEnd,   { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend',   onTouchEnd);
    };
  }, [enabled, minDistance, maxVerticalDrift, maxDuration, onSwipeLeft, onSwipeRight]);
}
