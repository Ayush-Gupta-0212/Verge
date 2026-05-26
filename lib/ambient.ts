'use client';

// Ambient noise generator for the focus overlay.
// Synthesizes brown / pink / white noise via Web Audio so we don't need
// to ship audio assets. Output is a 2-second buffer looped continuously
// with a 500ms fade in / 300ms fade out to avoid clicks.

export type AmbientKind = 'off' | 'brown' | 'pink' | 'white';

export const AMBIENT_LABEL: Record<AmbientKind, string> = {
  off:   'Silence',
  brown: 'Brown',
  pink:  'Pink',
  white: 'White',
};

function makeNoiseBuffer(ctx: AudioContext, kind: AmbientKind): AudioBuffer {
  const length = ctx.sampleRate * 2; // 2-second loop
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  if (kind === 'white') {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  } else if (kind === 'pink') {
    // Voss-McCartney pink-noise approximation.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    // Brown noise — integrated white, low-frequency biased.
    let last = 0;
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buffer;
}

export class AmbientPlayer {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private current: AmbientKind = 'off';
  private volume: number;

  constructor(volume = 0.30) {
    this.volume = volume;
  }

  get kind(): AmbientKind {
    return this.current;
  }

  // Idempotent — calling with the same kind is a no-op.
  async start(kind: Exclude<AmbientKind, 'off'>): Promise<void> {
    if (this.current === kind && this.source) return;
    this.stopImmediate();
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const buffer = makeNoiseBuffer(this.ctx, kind);
    this.source = this.ctx.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;

    this.gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(this.volume, now + 0.5);

    this.source.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.source.start();
    this.current = kind;
  }

  stop(): void {
    if (!this.source || !this.ctx || !this.gain) {
      this.current = 'off';
      return;
    }
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + 0.30);
    const s = this.source;
    setTimeout(() => {
      try { s.stop(); } catch { /* already stopped */ }
    }, 350);
    this.source = null;
    this.gain = null;
    this.current = 'off';
  }

  private stopImmediate(): void {
    if (!this.source) return;
    try { this.source.stop(); } catch { /* ignore */ }
    this.source.disconnect();
    this.gain?.disconnect();
    this.source = null;
    this.gain = null;
  }

  dispose(): void {
    this.stopImmediate();
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => undefined);
    }
    this.ctx = null;
    this.current = 'off';
  }
}

// Next kind in the cycle: off → brown → pink → white → off.
export function cycleAmbient(k: AmbientKind): AmbientKind {
  const order: AmbientKind[] = ['off', 'brown', 'pink', 'white'];
  const i = order.indexOf(k);
  return order[(i + 1) % order.length];
}
