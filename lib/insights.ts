// Shared "insights" math — derivations from timer history that more than
// one view needs. Lifted out of ConstellationPanel so Flow, Astral, and any
// future view (heatmap, achievements) can share a single source of truth.

import type { TimerSession } from '@/lib/types';
import { dateToYMD } from '@/lib/dates';

export interface Streak {
  current: number;       // consecutive focus days ending today (or yesterday)
  longest: number;       // longest streak ever
  thisWeek: number;      // distinct focus days this Monday-anchored week (0..7)
  // True iff the user already focused today. Used for the "X to go" copy.
  focusedToday: boolean;
  // Set of YYYY-MM-DD strings of every focus day, for downstream heatmaps
  // and badge calculations.
  focusDays: Set<string>;
  // True iff the streak counted a missed day by spending the user's weekly
  // freeze. The Astral card uses this to label the freeze as "in use."
  freezeApplied: boolean;
}

// Returns the YYYY-MM-DD of the Monday that "owns" the given date — i.e.,
// the start of that ISO-style week. Used by the streak-freeze cooldown to
// know which week's freeze the user has spent.
export function mondayKey(d: Date): string {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  const dow = (r.getDay() + 6) % 7;
  r.setDate(r.getDate() - dow);
  return dateToYMD(r);
}

const MIN_FOCUS_MS = 60_000; // anything under a minute is noise.

// `freezeAvailable` reflects the profile state — has the user already spent
// this week's freeze? When true, computeStreak will tolerate a single missed
// day (yesterday) and continue counting back through it.
export function computeStreak(
  history: TimerSession[],
  now: Date | null,
  freezeAvailable: boolean = false,
): Streak {
  if (!now) {
    return { current: 0, longest: 0, thisWeek: 0, focusedToday: false, focusDays: new Set(), freezeApplied: false };
  }

  const focusDays = new Set<string>();
  history
    .filter((s) => s.kind === 'focus' && s.duration_ms >= MIN_FOCUS_MS)
    .forEach((s) => focusDays.add(dateToYMD(new Date(s.started_at))));

  // Current — count back from today; if today has none, fall back to
  // yesterday so the streak doesn't visually break before evening focus.
  const todayYMD = dateToYMD(now);
  const focusedToday = focusDays.has(todayYMD);

  let cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  if (!focusDays.has(dateToYMD(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let current = 0;
  let freezeApplied = false;
  while (true) {
    if (focusDays.has(dateToYMD(cursor))) {
      current++;
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    // Missed this day. If we still have a freeze and haven't used it on
    // this walk, spend it to bridge over a single empty day.
    if (freezeAvailable && !freezeApplied) {
      freezeApplied = true;
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    break;
  }

  // Longest — walk sorted unique days.
  const sorted = [...focusDays].sort();
  let longest = 0;
  let run = 0;
  let prev = '';
  for (const d of sorted) {
    if (prev) {
      const prevDate = new Date(prev);
      prevDate.setDate(prevDate.getDate() + 1);
      run = dateToYMD(prevDate) === d ? run + 1 : 1;
    } else {
      run = 1;
    }
    if (run > longest) longest = run;
    prev = d;
  }

  // This-week count (Monday-anchored).
  const todayMid = new Date(now); todayMid.setHours(0, 0, 0, 0);
  const dow = (todayMid.getDay() + 6) % 7;
  const monday = new Date(todayMid); monday.setDate(todayMid.getDate() - dow);
  let thisWeek = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    if (focusDays.has(dateToYMD(d))) thisWeek++;
  }

  return { current, longest, thisWeek, focusedToday, focusDays, freezeApplied };
}

/* ─────────────────────────────────────────── 30-day heatmap */

export interface HeatmapCell {
  date: string;     // YYYY-MM-DD
  ms: number;       // total focus minutes on that day
  level: 0 | 1 | 2 | 3 | 4;  // discretized intensity for color steps
}

// Returns a 7x{weeks} matrix (column-major: each column is a week, row=weekday)
// ending on the most recent Sunday-equivalent, ready for Tailwind grid render.
export function buildFocusHeatmap(
  history: TimerSession[],
  now: Date,
  weeks = 5,                   // ~ "last 5 weeks" is a clean 35-day surface
): { cells: HeatmapCell[]; maxMs: number; weeksOut: number } {
  const dayMs = new Map<string, number>();
  history
    .filter((s) => s.kind === 'focus' && s.duration_ms >= MIN_FOCUS_MS)
    .forEach((s) => {
      const k = dateToYMD(new Date(s.started_at));
      dayMs.set(k, (dayMs.get(k) ?? 0) + s.duration_ms);
    });

  // Anchor: today, then walk back `weeks * 7 - 1` days so the rightmost
  // column ends on today.
  const totalDays = weeks * 7;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (totalDays - 1));

  const cells: HeatmapCell[] = [];
  let maxMs = 0;
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const k = dateToYMD(d);
    const ms = dayMs.get(k) ?? 0;
    if (ms > maxMs) maxMs = ms;
    cells.push({ date: k, ms, level: 0 });
  }

  // Discretize against the user's own peak (4 buckets above zero). This
  // adapts the color scale to the user — heavy users get a meaningful
  // gradient, light users still see "did → didn't" clearly.
  const step = Math.max(MIN_FOCUS_MS, maxMs / 4);
  cells.forEach((c) => {
    if (c.ms === 0)        c.level = 0;
    else if (c.ms < step)     c.level = 1;
    else if (c.ms < step * 2) c.level = 2;
    else if (c.ms < step * 3) c.level = 3;
    else                      c.level = 4;
  });

  return { cells, maxMs, weeksOut: weeks };
}

/* ─────────────────────────────────────────── per-tag focus split */

export interface TagFocus {
  tag: string;
  minutes: number;
  sessions: number;
}

// Rolls all focus sessions up by tag (read from the linked task's tags).
// Sessions without a linked task — or whose task has no tags — fall into
// the "untagged" bucket so the breakdown always sums to the total.
export function focusByTag(
  history: TimerSession[],
  tasks: Array<{ id: string; tags?: string[] | null }>,
  sinceDays?: number,
): TagFocus[] {
  const since = sinceDays
    ? Date.now() - sinceDays * 86400000
    : 0;
  const byTag = new Map<string, { ms: number; sessions: number }>();
  const taskTags = new Map<string, string[]>();
  tasks.forEach((t) => taskTags.set(t.id, t.tags ?? []));

  history
    .filter((s) => s.kind === 'focus' && s.duration_ms >= MIN_FOCUS_MS)
    .filter((s) => new Date(s.started_at).getTime() >= since)
    .forEach((s) => {
      const tags = (s.task_id && taskTags.get(s.task_id)) || [];
      const targets = tags.length > 0 ? tags : ['untagged'];
      targets.forEach((tag) => {
        const cur = byTag.get(tag) ?? { ms: 0, sessions: 0 };
        cur.ms += s.duration_ms;
        cur.sessions += 1;
        byTag.set(tag, cur);
      });
    });

  return [...byTag.entries()]
    .map(([tag, v]) => ({ tag, minutes: Math.round(v.ms / 60000), sessions: v.sessions }))
    .sort((a, b) => b.minutes - a.minutes);
}

/* ─────────────────────────────────────────── best hour-of-week heatmap */

export interface HourOfWeekCell {
  day: number;        // 0 = Mon … 6 = Sun
  hour: number;       // 0..23
  minutes: number;
  level: 0 | 1 | 2 | 3 | 4;
}

// 7 (days) × 24 (hours) grid of focus minutes. Discretized per-user against
// their peak hour so the gradient is meaningful regardless of scale.
export function focusByHourOfWeek(history: TimerSession[]): {
  cells: HourOfWeekCell[];
  peakLabel: string | null;
} {
  const grid: HourOfWeekCell[] = [];
  const totals = new Array(7 * 24).fill(0);
  history
    .filter((s) => s.kind === 'focus' && s.duration_ms >= MIN_FOCUS_MS)
    .forEach((s) => {
      const d = new Date(s.started_at);
      const day = (d.getDay() + 6) % 7;          // Mon-first
      const idx = day * 24 + d.getHours();
      totals[idx] += s.duration_ms / 60000;
    });

  const peak = Math.max(0, ...totals);
  let peakIdx = -1;
  for (let i = 0; i < totals.length; i++) {
    if (totals[i] === peak && peak > 0) { peakIdx = i; break; }
  }

  const step = Math.max(1, peak / 4);
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const minutes = totals[day * 24 + hour];
      let level: HourOfWeekCell['level'] = 0;
      if (minutes > 0) {
        if      (minutes < step)     level = 1;
        else if (minutes < step * 2) level = 2;
        else if (minutes < step * 3) level = 3;
        else                          level = 4;
      }
      grid.push({ day, hour, minutes, level });
    }
  }

  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const peakLabel = peakIdx >= 0
    ? `${DAY_NAMES[Math.floor(peakIdx / 24)]} · ${String(peakIdx % 24).padStart(2, '0')}:00`
    : null;

  return { cells: grid, peakLabel };
}

/* ─────────────────────────────────────────── estimated vs actual */

export interface EstimateAccuracy {
  taskId: string;
  title: string;
  estimatedMin: number;
  actualMin: number;
  delta: number;       // positive = overran, negative = under
}

// For completed tasks that had an `estimated_min`, sums the actual focus
// minutes from history. Lets the user see whether they're optimistic
// (always underestimating) or padding (always overestimating).
export function estimateAccuracy(
  tasks: Array<{ id: string; title: string; completed_at: string | null; estimated_min?: number | null }>,
  history: TimerSession[],
): EstimateAccuracy[] {
  const minutesByTask = new Map<string, number>();
  history
    .filter((s) => s.kind === 'focus' && s.duration_ms >= MIN_FOCUS_MS && s.task_id)
    .forEach((s) => {
      const cur = minutesByTask.get(s.task_id!) ?? 0;
      minutesByTask.set(s.task_id!, cur + s.duration_ms / 60000);
    });

  return tasks
    .filter((t) => t.completed_at && t.estimated_min && t.estimated_min > 0)
    .map((t) => {
      const actual = Math.round(minutesByTask.get(t.id) ?? 0);
      return {
        taskId:       t.id,
        title:        t.title,
        estimatedMin: t.estimated_min!,
        actualMin:    actual,
        delta:        actual - t.estimated_min!,
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
