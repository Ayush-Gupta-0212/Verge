// Tiny DOM-only "spark burst" — call sparkBurst(targetEl) and N amber dots
// radiate out from the element's center, then auto-cleanup after the CSS
// animation finishes. Intentionally not a React component: the burst fires
// once on a discrete action (task complete, badge unlocked, etc.) and the
// rest of the world doesn't need to know it happened.

const SPARK_COUNT = 6;
const SPARK_RADIUS = 18; // px from origin

interface SparkOptions {
  count?: number;
  radius?: number;
  /** Confetti mode — larger spread + persists ~1.6s instead of 600ms. */
  big?: boolean;
}

export function sparkBurst(target: HTMLElement | null, opts: SparkOptions = {}): void {
  if (!target || typeof window === 'undefined') return;

  // Honor reduced-motion at the JS layer too — the CSS hides them but we
  // also skip the DOM work.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const rect = target.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const count  = opts.count  ?? (opts.big ? 24 : SPARK_COUNT);
  const radius = opts.radius ?? (opts.big ? 120 : SPARK_RADIUS);
  const duration = opts.big ? 1600 : 800;

  // The dots position via fixed coords + transform; appending to body avoids
  // any clipped-overflow surprises from the host's container.
  const cx = rect.left + rect.width / 2;
  const cy = rect.top  + rect.height / 2;

  const dots: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('span');
    dot.className = 'spark-dot';
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const dist  = radius * (0.6 + Math.random() * 0.8);
    dot.style.position = 'fixed';
    dot.style.left = `${cx}px`;
    dot.style.top  = `${cy}px`;
    dot.style.zIndex = '70';
    dot.style.setProperty('--sx', `${Math.cos(angle) * dist}px`);
    dot.style.setProperty('--sy', `${Math.sin(angle) * dist}px`);
    if (opts.big) {
      dot.style.width = '6px';
      dot.style.height = '6px';
      dot.style.marginLeft = '-3px';
      dot.style.marginTop  = '-3px';
      dot.style.animationDuration = '1.4s';
    }
    document.body.appendChild(dot);
    dots.push(dot);
  }
  window.setTimeout(() => {
    dots.forEach((d) => d.remove());
  }, duration);
}

// Once-per-local-day check. Marked via localStorage so refreshes within the
// same day don't replay the celebration. Returns true if today's burst has
// not yet been fired.
const CONFETTI_KEY = 'verge:confetti-first-task';
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
export function shouldFireDailyConfetti(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(CONFETTI_KEY) !== todayKey();
  } catch {
    return false;
  }
}
export function markDailyConfettiFired(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONFETTI_KEY, todayKey());
  } catch {
    // ignore
  }
}

// Once-per-account "first task ever" celebration. Distinct from the daily
// confetti — this fires bigger, exactly once, on the user's very first
// completed task. Used to make the moment of "I made progress in Verge"
// memorable for new sign-ups.
const FIRST_TASK_KEY = 'verge:first-task-fired';
export function shouldFireFirstTaskCelebration(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(FIRST_TASK_KEY) !== '1';
  } catch {
    return false;
  }
}
export function markFirstTaskCelebrationFired(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FIRST_TASK_KEY, '1');
  } catch {
    /* ignore */
  }
}
