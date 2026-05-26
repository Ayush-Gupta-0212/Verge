// Dynamic favicon — paints the Verge mark into a canvas, optionally
// stamping the current streak number and/or a focus-running ring, then
// swaps the document's <link rel="icon"> href to the data URL.
//
// Runs only in the browser. No-op on the server or if the canvas can't
// produce a data URL (extremely defensive).

const FAVICON_SIZE = 64;

let lastUrl: string | null = null;
let baseLinkHref: string | null = null;
let injectedLink: HTMLLinkElement | null = null;

function ensureLink(): HTMLLinkElement | null {
  if (typeof document === 'undefined') return null;
  // Prefer reusing the Next-injected /icon link so the user's static one
  // remains intact when nothing dynamic is happening.
  if (injectedLink) return injectedLink;

  const existing = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (existing) {
    baseLinkHref = existing.href || null;
  }
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  document.head.appendChild(link);
  injectedLink = link;
  return link;
}

export interface FaviconState {
  streak: number;       // 0 = no badge
  focusActive: boolean; // amber ring around the mark
}

export function paintFavicon(state: FaviconState): void {
  if (typeof document === 'undefined') return;
  const link = ensureLink();
  if (!link) return;

  const canvas = document.createElement('canvas');
  canvas.width = FAVICON_SIZE;
  canvas.height = FAVICON_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Backdrop: rounded obsidian square matching the app icon style.
  const r = 12;
  const w = FAVICON_SIZE;
  ctx.fillStyle = '#0a0807';
  roundRect(ctx, 1, 1, w - 2, w - 2, r);
  ctx.fill();

  // Amber rim when focus is running.
  if (state.focusActive) {
    ctx.strokeStyle = '#ff8a3d';
    ctx.lineWidth = 3;
    roundRect(ctx, 2, 2, w - 4, w - 4, r - 1);
    ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(255,138,61,0.45)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, 2, 2, w - 4, w - 4, r - 1);
    ctx.stroke();
  }

  // Centered "V" mark in amber.
  ctx.fillStyle = '#ff8a3d';
  ctx.font = '300 44px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('V', w / 2, w / 2 + 2);

  // Streak chip — small amber bubble bottom-right with the count.
  if (state.streak > 0) {
    const chipW = state.streak > 99 ? 28 : state.streak > 9 ? 24 : 20;
    const chipH = 18;
    const cx = w - chipW - 3;
    const cy = w - chipH - 3;
    ctx.fillStyle = '#ff8a3d';
    roundRect(ctx, cx, cy, chipW, chipH, 9);
    ctx.fill();
    ctx.fillStyle = '#0a0807';
    ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(state.streak), cx + chipW / 2, cy + chipH / 2 + 1);
  }

  const url = canvas.toDataURL('image/png');
  if (url === lastUrl) return;     // no-op when nothing changed
  lastUrl = url;
  link.href = url;
}

// Restore the original /icon link when the user logs out or the dynamic
// reasons go away. Best-effort.
export function resetFavicon(): void {
  if (!injectedLink) return;
  if (baseLinkHref) injectedLink.href = baseLinkHref;
  lastUrl = null;
}

/* helpers */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}
