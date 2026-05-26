import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { ScheduleEvent } from '@/lib/types';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { useUserStore } from '@/stores/useUserStore';
import { toastError, toastInfo } from '@/stores/useToastStore';
import { addDays, dateToYMD, mondayOf, parseYMD } from '@/lib/dates';
import { expandOccurrences, parseRRule } from '@/lib/rrule';

// Schedule store — date-anchored calendar events.
//
// The previous cell-based weekly model is gone from the UI; the table
// `schedule_cells` still exists in the schema for a future "recurring
// template" feature, but Verge now reads/writes `schedule_events`.

interface ScheduleState {
  events: ScheduleEvent[];
  loading: boolean;
  load: () => Promise<void>;
  upsert: (input: Partial<ScheduleEvent> & {
    date: string;
    start_minute: number;
    duration_minutes: number;
    title: string;
    color: string;
  }) => Promise<ScheduleEvent>;
  move: (id: string, date: string, start_minute: number) => Promise<void>;
  resize: (id: string, duration_minutes: number) => Promise<void>;
  clear: (id: string) => Promise<void>;
  // Delete every event in a series (a recurring event was created with the
  // same series_id on each instance). Local + remote in one call.
  clearSeries: (seriesId: string) => Promise<void>;
  // Create a recurring event by materializing N instances upfront. Skips
  // dates already occupied (best-effort — minor overlaps go to the user via
  // the conflict toast in the modal save path).
  createSeries: (input: {
    date: string;
    start_minute: number;
    duration_minutes: number;
    title: string;
    color: string;
    notes?: string | null;
    task_id?: string | null;
    rrule: string;             // already-formatted RRule JSON
    horizonWeeks?: number;     // default 26
  }) => Promise<{ count: number; series_id: string }>;
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  events: [],
  loading: false,

  load: async () => {
    set({ loading: true });
    const supabase = getSupabaseBrowser();
    const user = useUserStore.getState().user;

    if (!supabase) {
      set({ events: seedEvents(), loading: false });
      return;
    }
    if (!user) {
      set({ events: [], loading: false });
      return;
    }

    // Load a generous window so prev/next-week nav doesn't need a refetch.
    const now = new Date();
    const from = new Date(now); from.setDate(now.getDate() - 60);
    const to   = new Date(now); to.setDate(now.getDate()   + 120);

    const { data, error } = await supabase
      .from('schedule_events')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', dateToYMD(from))
      .lte('date', dateToYMD(to))
      .order('date',         { ascending: true })
      .order('start_minute', { ascending: true });

    if (error) {
      console.warn('[verge] load schedule:', error.message);
      set({ events: [], loading: false });
      return;
    }
    set({ events: (data ?? []) as ScheduleEvent[], loading: false });
  },

  upsert: async (input) => {
    const id = input.id ?? uuid();
    const user = useUserStore.getState().user;
    const full: ScheduleEvent = {
      id,
      user_id: input.user_id ?? user?.id ?? null,
      date: input.date,
      start_minute: input.start_minute,
      duration_minutes: input.duration_minutes,
      title: input.title,
      color: input.color,
      notes: input.notes ?? null,
      task_id: input.task_id ?? null,
    };
    set((s) => ({
      events: [...s.events.filter((e) => e.id !== id), full].sort(sortEvents),
    }));
    const supabase = getSupabaseBrowser();
    if (supabase && user) {
      const { error } = await supabase.from('schedule_events').upsert(full);
      if (error) {
        console.warn('[verge] upsert event:', error.message);
        toastError(`Couldn't save event — ${error.message}`);
      }
    }
    return full;
  },

  move: async (id, date, start_minute) => {
    set((s) => ({
      events: s.events
        .map((e) => (e.id === id ? { ...e, date, start_minute } : e))
        .sort(sortEvents),
    }));
    const supabase = getSupabaseBrowser();
    const user = useUserStore.getState().user;
    if (supabase && user) {
      const { error } = await supabase
        .from('schedule_events')
        .update({ date, start_minute })
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) {
        console.warn('[verge] move event:', error.message);
        toastError(`Couldn't move event — ${error.message}`);
      }
    }
  },

  resize: async (id, duration_minutes) => {
    set((s) => ({
      events: s.events.map((e) =>
        e.id === id ? { ...e, duration_minutes } : e,
      ),
    }));
    const supabase = getSupabaseBrowser();
    const user = useUserStore.getState().user;
    if (supabase && user) {
      const { error } = await supabase
        .from('schedule_events')
        .update({ duration_minutes })
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) {
        console.warn('[verge] resize event:', error.message);
        toastError(`Couldn't resize event — ${error.message}`);
      }
    }
  },

  clear: async (id) => {
    set((s) => ({ events: s.events.filter((e) => e.id !== id) }));
    const supabase = getSupabaseBrowser();
    const user = useUserStore.getState().user;
    if (supabase && user) {
      const { error } = await supabase
        .from('schedule_events')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) {
        console.warn('[verge] clear event:', error.message);
        toastError(`Couldn't delete event — ${error.message}`);
      }
    }
  },

  clearSeries: async (seriesId) => {
    set((s) => ({ events: s.events.filter((e) => e.series_id !== seriesId) }));
    const supabase = getSupabaseBrowser();
    const user = useUserStore.getState().user;
    if (supabase && user) {
      const { error } = await supabase
        .from('schedule_events')
        .delete()
        .eq('series_id', seriesId)
        .eq('user_id', user.id);
      if (error) {
        console.warn('[verge] clearSeries:', error.message);
        toastError(`Couldn't delete series — ${error.message}`);
      }
    }
  },

  createSeries: async ({
    date, start_minute, duration_minutes, title, color,
    notes = null, task_id = null, rrule, horizonWeeks = 26,
  }) => {
    const rule = parseRRule(rrule);
    if (!rule) {
      toastError('Invalid recurrence rule.');
      return { count: 0, series_id: '' };
    }
    const user = useUserStore.getState().user;
    const series_id = uuid();

    // Anchor at the chosen day at midnight local (we only use the date for
    // recurrence math; the time-of-day comes from start_minute).
    const anchor = parseYMD(date);
    // Window: from the anchor through `horizonWeeks` ahead.
    const horizonEnd = new Date(anchor);
    horizonEnd.setDate(anchor.getDate() + horizonWeeks * 7);

    // Always include the anchor itself, then expand strictly after it.
    const allDates: Date[] = [anchor, ...expandOccurrences(rule, anchor, anchor, horizonEnd, 200)];

    // Build the rows. The first instance carries the rrule string so future
    // "edit series" UX can find the source rule; subsequent instances just
    // share the series_id.
    const occupied = new Set(get().events.map((e) => `${e.date}|${e.start_minute}`));
    const rows: ScheduleEvent[] = [];
    allDates.forEach((d, i) => {
      const ymd = dateToYMD(d);
      const key = `${ymd}|${start_minute}`;
      if (occupied.has(key)) return; // skip slots already filled
      rows.push({
        id: uuid(),
        user_id: user?.id ?? null,
        date: ymd,
        start_minute,
        duration_minutes,
        title,
        color,
        notes,
        task_id,
        rrule: i === 0 ? rrule : null,
        series_id,
      });
      occupied.add(key);
    });

    // Optimistic local insert.
    set((s) => ({
      events: [...s.events, ...rows].sort(sortEvents),
    }));

    // Bulk insert to Supabase.
    const supabase = getSupabaseBrowser();
    if (supabase && user && rows.length > 0) {
      const { error } = await supabase.from('schedule_events').insert(rows);
      if (error) {
        // Roll back local on hard failure so the UI doesn't lie.
        const newIds = new Set(rows.map((r) => r.id));
        set((s) => ({
          events: s.events.filter((e) => !newIds.has(e.id)),
        }));
        toastError(`Couldn't create recurring event — ${error.message}`);
        return { count: 0, series_id };
      }
    }

    if (rows.length > 0) {
      toastInfo(`Created ${rows.length} occurrence${rows.length === 1 ? '' : 's'}.`);
    }
    return { count: rows.length, series_id };
  },
}));

function sortEvents(a: ScheduleEvent, b: ScheduleEvent): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return a.start_minute - b.start_minute;
}

function seedEvents(): ScheduleEvent[] {
  const monday = mondayOf(new Date());
  const samples: Array<{
    dayOff: number; start: number; dur: number; title: string; color: string;
  }> = [
    { dayOff: 0, start:  9 * 60, dur:  60, title: 'Stand-up',                color: '#8a93a8' },
    { dayOff: 1, start:  9 * 60, dur: 120, title: 'Deep Work: Architecture', color: '#ff8a3d' },
    { dayOff: 1, start: 14 * 60, dur: 120, title: 'Design System V2',        color: '#ffa564' },
    { dayOff: 2, start: 11 * 60, dur:  60, title: 'Sync: Nexus',             color: '#b8d4e3' },
    { dayOff: 2, start: 14 * 60, dur: 180, title: 'Project: Verge',          color: '#ff7a18' },
    { dayOff: 4, start:  9 * 60, dur:  60, title: 'Review Logs',             color: '#b8d4e3' },
  ];
  return samples.map((s) => ({
    id: uuid(),
    user_id: null,
    date: dateToYMD(addDays(monday, s.dayOff)),
    start_minute: s.start,
    duration_minutes: s.dur,
    title: s.title,
    color: s.color,
  }));
}

// Convenience helpers exported for consumers that need event arithmetic.
export function eventEndMinute(e: ScheduleEvent): number {
  return e.start_minute + e.duration_minutes;
}

// Max contiguous free minutes starting at `fromMinute` on `date`.
// `ignoreId` is the event currently being edited (excluded from the check).
// Returns 0 if `fromMinute` is inside another event (a real overlap, not just
// a tight neighbour).
export function maxFreeMinutes(
  events: ScheduleEvent[],
  date: string,
  fromMinute: number,
  ignoreId?: string,
): number {
  const sameDay = events
    .filter((e) => e.date === date && e.id !== ignoreId)
    .sort((a, b) => a.start_minute - b.start_minute);
  // If the proposed start lands INSIDE an existing event, there's no room.
  for (const e of sameDay) {
    const eEnd = e.start_minute + e.duration_minutes;
    if (e.start_minute <= fromMinute && eEnd > fromMinute) {
      return 0;
    }
  }
  // Otherwise the gap stretches to the next event's start.
  for (const e of sameDay) {
    if (e.start_minute >= fromMinute) {
      return e.start_minute - fromMinute;
    }
  }
  return 24 * 60 - fromMinute;
}

// Every event that overlaps the proposed [start, start+duration) window on
// `date`, excluding `ignoreId`. Used by the modal save path to refuse a save
// (and tell the user *which* event is in the way) instead of silently
// clamping into invalid state.
export function conflictingEvents(
  events: ScheduleEvent[],
  date: string,
  startMinute: number,
  durationMinutes: number,
  ignoreId?: string,
): ScheduleEvent[] {
  const end = startMinute + durationMinutes;
  return events.filter((e) => {
    if (e.date !== date) return false;
    if (e.id === ignoreId) return false;
    const eEnd = e.start_minute + e.duration_minutes;
    return e.start_minute < end && eEnd > startMinute;
  });
}

// First free 30-min slot >= fromMinute, snapped down to :00/:30.
export function findFreeMinute(
  events: ScheduleEvent[],
  date: string,
  fromMinute: number,
): number {
  const start = Math.floor(Math.max(0, fromMinute) / 30) * 30;
  const occupied = new Set<number>();
  events
    .filter((e) => e.date === date)
    .forEach((e) => {
      const end = e.start_minute + e.duration_minutes;
      for (let m = e.start_minute; m < end; m += 30) {
        occupied.add(Math.floor(m / 30) * 30);
      }
    });
  for (let m = start; m < 24 * 60; m += 30) {
    if (!occupied.has(m)) return m;
  }
  return start;
}
