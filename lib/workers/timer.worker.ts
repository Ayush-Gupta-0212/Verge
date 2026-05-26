/// <reference lib="webworker" />

// Standalone timer that keeps ticking even when the tab is backgrounded.
// Uses performance.now() inside a setInterval — browsers throttle setInterval
// in background tabs, but we anchor each tick to wall-clock delta so the
// reported elapsed time stays accurate when the tab returns to focus.

type InMsg =
  | { type: 'start'; at: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset' }
  | { type: 'sync' };

type OutMsg = { type: 'tick'; elapsed: number } | { type: 'state'; running: boolean };

let running = false;
let baseElapsed = 0;      // elapsed from previous run segments
let segmentStart = 0;     // performance.now() of current segment start
let interval: ReturnType<typeof setInterval> | null = null;

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function currentElapsed(): number {
  if (!running) return baseElapsed;
  return baseElapsed + (now() - segmentStart);
}

function emitTick() {
  (self as DedicatedWorkerGlobalScope).postMessage({
    type: 'tick',
    elapsed: currentElapsed(),
  } satisfies OutMsg);
}

function startInterval() {
  if (interval) return;
  interval = setInterval(emitTick, 100);
}

function stopInterval() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'start':
      baseElapsed = 0;
      segmentStart = now();
      running = true;
      startInterval();
      emitTick();
      break;
    case 'resume':
      if (!running) {
        segmentStart = now();
        running = true;
        startInterval();
        emitTick();
      }
      break;
    case 'pause':
      if (running) {
        baseElapsed = currentElapsed();
        running = false;
      }
      stopInterval();
      emitTick();
      break;
    case 'reset':
      running = false;
      baseElapsed = 0;
      segmentStart = 0;
      stopInterval();
      emitTick();
      break;
    case 'sync':
      emitTick();
      break;
  }
  (self as DedicatedWorkerGlobalScope).postMessage({
    type: 'state',
    running,
  } satisfies OutMsg);
};
