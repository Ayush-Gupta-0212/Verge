// Local-time date helpers. We keep everything in the browser's local
// timezone and serialize as YYYY-MM-DD strings (date-only, no zone) so the
// stored values stay stable across timezones and devices.

export function dateToYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseYMD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(d.getDate() + n);
  return r;
}

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function mondayOf(d: Date): Date {
  const r = startOfDay(d);
  const dow = r.getDay();                  // Sun=0..Sat=6
  const diff = dow === 0 ? -6 : 1 - dow;   // back to Monday
  r.setDate(r.getDate() + diff);
  return r;
}

export function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth() &&
    a.getDate()     === b.getDate()
  );
}

export function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

// "HH:MM" from a minutes-since-midnight integer.
export function formatMinute(m: number): string {
  const clamped = Math.max(0, Math.min(1439, m));
  const h = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// Parse "HH:MM" back to minutes; returns NaN on bad input.
export function parseMinute(s: string): number {
  const [h, m] = s.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
  return Math.max(0, Math.min(1439, h * 60 + m));
}

export function humanDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
