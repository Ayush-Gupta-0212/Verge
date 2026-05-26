'use client';

import { useCallback, useRef } from 'react';

interface LongPressOptions {
  delay?: number;            // ms before the long-press fires (default 450)
  moveTolerance?: number;    // px the finger can drift before cancelling
}

interface LongPressBindings {
  onTouchStart: (e: React.TouchEvent | React.MouseEvent) => void;
  onTouchEnd:   () => void;
  onTouchMove:  (e: React.TouchEvent) => void;
  onTouchCancel: () => void;
  // The mouse variants are no-ops on touch devices; useful for right-
  // click parity on desktop without us shipping a separate handler.
  onContextMenu: (e: React.MouseEvent) => void;
}

// Returns spread-able event handlers that call onLongPress after `delay`
// of stationary press. Cancels on touch end, scroll-style move, or
// element leave. Pairs well with single-click handlers that fire only
// when the long-press hasn't triggered.
export function useLongPress(
  onLongPress: (target: HTMLElement) => void,
  opts: LongPressOptions = {},
): LongPressBindings & { firedRef: React.MutableRefObject<boolean> } {
  const delay = opts.delay ?? 450;
  const tolerance = opts.moveTolerance ?? 14;

  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef<boolean>(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startedAtRef.current = null;
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    firedRef.current = false;
    const point = 'touches' in e ? e.touches[0] : (e as React.MouseEvent);
    const x = point.clientX;
    const y = point.clientY;
    startedAtRef.current = { x, y };
    const target = e.currentTarget as HTMLElement;
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      try {
        // Haptic nudge on Android-style browsers — invisible on others.
        navigator.vibrate?.(8);
      } catch { /* ignore */ }
      onLongPress(target);
    }, delay);
  }, [delay, onLongPress]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!startedAtRef.current) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - startedAtRef.current.x;
    const dy = t.clientY - startedAtRef.current.y;
    if (Math.hypot(dx, dy) > tolerance) {
      clear();
    }
  }, [clear, tolerance]);

  const onTouchEnd = useCallback(() => clear(), [clear]);
  const onTouchCancel = useCallback(() => clear(), [clear]);

  // Right-click on desktop fires the same handler so power users get parity.
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    firedRef.current = true;
    onLongPress(e.currentTarget as HTMLElement);
  }, [onLongPress]);

  return {
    onTouchStart,
    onTouchEnd,
    onTouchMove,
    onTouchCancel,
    onContextMenu,
    firedRef,
  };
}
