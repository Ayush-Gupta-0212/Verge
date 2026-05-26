'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTimerStore } from '@/stores/useTimerStore';

// Wires the timer worker into the Zustand store. Mount once at the root.
// The worker keeps ticking even when the tab is backgrounded; the store's
// `tick` is the only writer of `elapsed`. Returns a stable `reset` so
// callers can fully zero the worker (e.g. on user switch).
export function useTimerWorker() {
  const workerRef = useRef<Worker | null>(null);
  const running = useTimerStore((s) => s.running);
  const tick = useTimerStore((s) => s.tick);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = new Worker(new URL('./timer.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = w;
    w.onmessage = (e: MessageEvent<{ type: string; elapsed?: number }>) => {
      if (e.data.type === 'tick' && typeof e.data.elapsed === 'number') {
        tick(e.data.elapsed);
      }
    };
    return () => {
      w.terminate();
      workerRef.current = null;
    };
  }, [tick]);

  useEffect(() => {
    const w = workerRef.current;
    if (!w) return;
    if (running) {
      const elapsed = useTimerStore.getState().elapsed;
      w.postMessage(elapsed === 0 ? { type: 'start', at: Date.now() } : { type: 'resume' });
    } else {
      w.postMessage({ type: 'pause' });
    }
  }, [running]);

  const reset = useCallback(() => {
    workerRef.current?.postMessage({ type: 'reset' });
  }, []);

  // Stable reference across renders so consumers can include it in
  // useEffect deps without triggering re-runs.
  return useMemo(() => ({ reset }), [reset]);
}
