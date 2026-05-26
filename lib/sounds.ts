// Verge — tiny Web Audio synthesis library.
//
// Two sounds, both generated on the fly (zero asset weight, ~0KB ship size):
//   • playTick()  — short pluck, used on subtask completion
//   • playChime() — warm two-note bell, used on focus session complete
//
// All sounds gated behind the user's `sounds_enabled` preference; callers
// check that flag before invoking. Audio context is lazy (created on first
// play) so we don't crowd the browser's autoplay budget before the user
// interacts.

let ctxRef: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctxRef) return ctxRef;
  type WindowWithWebkitAudio = typeof window & {
    webkitAudioContext?: typeof AudioContext;
  };
  const w = window as WindowWithWebkitAudio;
  const Ctor = window.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctxRef = new Ctor();
  } catch {
    return null;
  }
  return ctxRef;
}

function envelope(
  ctx: AudioContext,
  destination: AudioNode,
  attackMs: number,
  releaseMs: number,
  peak = 0.18,
): GainNode {
  const g = ctx.createGain();
  const now = ctx.currentTime;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(peak, now + attackMs / 1000);
  g.gain.exponentialRampToValueAtTime(0.0001, now + (attackMs + releaseMs) / 1000);
  g.connect(destination);
  return g;
}

function tone(ctx: AudioContext, freq: number, type: OscillatorType, attackMs: number, releaseMs: number, peak: number) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = envelope(ctx, ctx.destination, attackMs, releaseMs, peak);
  osc.connect(g);
  osc.start();
  osc.stop(ctx.currentTime + (attackMs + releaseMs) / 1000 + 0.02);
}

export function playTick(): void {
  const ctx = getCtx();
  if (!ctx) return;
  // High wood-block-y pluck, short.
  tone(ctx, 1380, 'triangle', 4, 90, 0.12);
}

export function playChime(): void {
  const ctx = getCtx();
  if (!ctx) return;
  // Two-note warm chime — root and a perfect fifth above. Sine + triangle
  // for a "soft bell" timbre. Second note enters 120ms after the first.
  tone(ctx, 660, 'sine',     8, 700, 0.16);
  setTimeout(() => tone(ctx, 990, 'triangle', 8, 900, 0.10), 120);
}
