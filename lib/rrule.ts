// Verge — minimal recurrence rule helper.
//
// We don't ship the full ICS RRULE spec — that's a huge surface for what
// 95% of productivity-app recurrences need. This module covers:
//
//   • daily        — every N days
//   • weekly       — every N weeks on chosen weekdays
//   • monthly      — every N months on the same day-of-month as the anchor
//
// Stored as a small JSON string in the `rrule` text column. JSON keeps it
// readable in the DB and parseable client-side without a library.

export type Freq = 'daily' | 'weekly' | 'monthly';
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

export interface RRule {
  freq: Freq;
  interval: number;             // every N units, default 1
  byweekday?: Weekday[];        // weekly only — default = the anchor's weekday
}

export const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/* ─────────────────────────────────────────── parse / format */

export function parseRRule(s: string | null | undefined): RRule | null {
  if (!s) return null;
  try {
    const parsed = JSON.parse(s) as Partial<RRule>;
    if (!parsed.freq || !['daily', 'weekly', 'monthly'].includes(parsed.freq)) {
      return null;
    }
    return {
      freq: parsed.freq,
      interval: Math.max(1, Math.min(99, parsed.interval ?? 1)),
      byweekday:
        parsed.freq === 'weekly' && Array.isArray(parsed.byweekday)
          ? parsed.byweekday.filter((d): d is Weekday => WEEKDAYS.includes(d as Weekday))
          : undefined,
    };
  } catch {
    return null;
  }
}

export function formatRRule(r: RRule): string {
  return JSON.stringify(r);
}

/* ─────────────────────────────────────────── human label */

const WEEKDAY_LABELS: Record<Weekday, string> = {
  MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun',
};

// Short, human-readable summary for chips/labels: "Daily", "Every 2 weeks",
// "Weekly on Mon, Wed, Fri", "Monthly".
export function summarizeRRule(r: RRule): string {
  const n = r.interval || 1;

  if (r.freq === 'daily') {
    return n === 1 ? 'Daily' : `Every ${n} days`;
  }

  if (r.freq === 'weekly') {
    const days = (r.byweekday ?? []).map((d) => WEEKDAY_LABELS[d]).join(', ');
    if (n === 1) {
      return days ? `Weekly on ${days}` : 'Weekly';
    }
    return days ? `Every ${n} weeks on ${days}` : `Every ${n} weeks`;
  }

  // monthly
  return n === 1 ? 'Monthly' : `Every ${n} months`;
}

/* ─────────────────────────────────────────── next-instance math */

const ISO_WEEKDAY: Weekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']; // index = JS getDay()

function jsWeekday(d: Date): Weekday {
  return ISO_WEEKDAY[d.getDay()];
}

// Next occurrence STRICTLY after `from` for the given rule, anchored to
// `anchor` (the original task/event date). Returns null if computation
// fails (shouldn't happen with valid rules).
export function nextOccurrence(
  rule: RRule,
  anchor: Date,
  from: Date,
): Date | null {
  const interval = Math.max(1, rule.interval || 1);

  if (rule.freq === 'daily') {
    // Number of full days between anchor and `from`, then jump forward by
    // the next multiple of `interval`.
    const diffDays = Math.floor((stripTime(from).getTime() - stripTime(anchor).getTime()) / 86400000);
    const stepsAhead = Math.floor(diffDays / interval) + 1;
    const next = new Date(anchor);
    next.setDate(anchor.getDate() + stepsAhead * interval);
    next.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), 0);
    return next;
  }

  if (rule.freq === 'weekly') {
    const days = (rule.byweekday && rule.byweekday.length > 0)
      ? rule.byweekday
      : [jsWeekday(anchor)];

    // Walk forward day-by-day from the day AFTER `from`. Cap at 366 to
    // avoid infinite loops on misconfigured rules.
    const start = new Date(from);
    start.setDate(from.getDate() + 1);
    for (let offset = 0; offset < 366; offset++) {
      const candidate = new Date(start);
      candidate.setDate(start.getDate() + offset);
      const wd = jsWeekday(candidate);
      if (!days.includes(wd)) continue;
      // Check the week-interval: how many weeks since anchor?
      const anchorWeek = weeksSinceEpoch(anchor);
      const candWeek = weeksSinceEpoch(candidate);
      const weekDiff = candWeek - anchorWeek;
      if (weekDiff < 0) continue;
      if (weekDiff % interval !== 0) continue;
      candidate.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), 0);
      return candidate;
    }
    return null;
  }

  if (rule.freq === 'monthly') {
    // Step forward `interval` months at a time from the most recent
    // month-anchor at or before `from`.
    const monthsBetween =
      (from.getFullYear() - anchor.getFullYear()) * 12 +
      (from.getMonth() - anchor.getMonth());
    const stepsAhead = Math.floor(monthsBetween / interval) + 1;
    const next = new Date(anchor);
    next.setMonth(anchor.getMonth() + stepsAhead * interval);
    next.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), 0);
    return next;
  }

  return null;
}

// Generate up to `maxCount` future occurrences in the half-open window
// (windowStart, windowEnd]. Used for materializing recurring schedule
// events upfront (e.g., 12 weeks ahead).
export function expandOccurrences(
  rule: RRule,
  anchor: Date,
  windowStart: Date,
  windowEnd: Date,
  maxCount = 200,
): Date[] {
  const out: Date[] = [];
  let cursor = windowStart;
  while (out.length < maxCount) {
    const next = nextOccurrence(rule, anchor, cursor);
    if (!next) break;
    if (next > windowEnd) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

/* ─────────────────────────────────────────── small helpers */

function stripTime(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

// Roughly: weeks since 1970-01-05 (a Monday). Used to test "every N weeks"
// alignment. Doesn't need calendar-week precision — only diffs matter.
function weeksSinceEpoch(d: Date): number {
  const MON_EPOCH = Date.UTC(1970, 0, 5); // 1970-01-05 was a Monday
  return Math.floor((d.getTime() - MON_EPOCH) / (7 * 86400000));
}
