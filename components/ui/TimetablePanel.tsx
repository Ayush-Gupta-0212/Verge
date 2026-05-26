'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  useScheduleStore,
  maxFreeMinutes,
  findFreeMinute,
  conflictingEvents,
} from '@/stores/useScheduleStore';
import { toastError, toastInfo } from '@/stores/useToastStore';
import PullToRefresh from '@/components/ui/PullToRefresh';
import { useTaskStore } from '@/stores/useTaskStore';
import {
  useSubtaskStore,
  subtasksForTask,
  subtaskProgress,
} from '@/stores/useSubtaskStore';
import { useTimerStore } from '@/stores/useTimerStore';
import { useUIStore } from '@/stores/useUIStore';
import { useUserStore } from '@/stores/useUserStore';
import { useIsMobile } from '@/lib/useBreakpoint';
import { DEFAULT_PREFERENCES, type ScheduleEvent } from '@/lib/types';
import RepeatPicker from '@/components/ui/RepeatPicker';
import {
  addDays,
  daysInMonth,
  dateToYMD,
  firstOfMonth,
  formatMinute,
  isSameDay,
  mondayOf,
  parseMinute,
  parseYMD,
} from '@/lib/dates';

// Chronos — date-anchored calendar.
//
//   • Top bar: Week/Month toggle, week navigator (← Today →), summary chips,
//     Download PNG button (server-rendered via /api/export/{week,month}).
//   • Week view: 7 columns × N rows (30-min granularity from profile day
//     window). Today's column glows; a horizontal "now" line slides through
//     the current 30-min slot.
//   • Month view: real calendar of the visible month with up to 2 event
//     previews per day; clicking a day jumps to that week.
//   • Event editor (modal): date, start time, duration (clamped to free run),
//     title, colour, linked task, notes.

// Base64-encode the minimal event payload for /api/export/{week,month}.
// `btoa` only handles latin-1, so we URI-encode first to be safe for any
// title containing unicode (em-dashes, emoji, non-Latin scripts).
function encodeEventsForExport(
  events: Array<{ date: string; start_minute: number; duration_minutes: number; title: string; color: string }>,
): string {
  const slim = events.map((e) => ({
    date: e.date,
    start_minute: e.start_minute,
    duration_minutes: e.duration_minutes,
    title: e.title,
    color: e.color,
  }));
  const json = JSON.stringify(slim);
  // unicode-safe base64: percent-encode → unescape → btoa
  const bytes = unescape(encodeURIComponent(json));
  return btoa(bytes);
}

const PALETTE = ['#ff8a3d', '#ffa564', '#b8d4e3', '#8a93a8', '#7df0c8'];
const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const PRESETS: Array<{ title: string; duration: number; color: string }> = [
  { title: 'Deep Work', duration: 120, color: '#ff8a3d' },
  { title: 'Sync',      duration: 60,  color: '#8a93a8' },
  { title: 'Break',     duration: 60,  color: '#b8d4e3' },
];
const ALL_DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480];

type DraftEvent = Partial<ScheduleEvent> & {
  date: string;
  start_minute: number;
  duration_minutes: number;
  title: string;
  color: string;
  isNew?: boolean;
};

export default function TimetablePanel() {
  const events       = useScheduleStore((s) => s.events);
  const upsert       = useScheduleStore((s) => s.upsert);
  const move         = useScheduleStore((s) => s.move);
  const resize       = useScheduleStore((s) => s.resize);
  const clear        = useScheduleStore((s) => s.clear);
  const reloadSchedule = useScheduleStore((s) => s.load);
  const clearSeries  = useScheduleStore((s) => s.clearSeries);
  const createSeries = useScheduleStore((s) => s.createSeries);

  const tasks   = useTaskStore((s) => s.tasks);
  const search  = useUIStore((s) => s.search);
  const profile = useUserStore((s) => s.profile);

  const dayStart = profile?.day_start_hour ?? DEFAULT_PREFERENCES.day_start_hour;
  const dayEnd   = profile?.day_end_hour   ?? DEFAULT_PREFERENCES.day_end_hour;

  const [view, setView] = useState<'week' | 'month'>('week');
  const [weekStart, setWeekStart]   = useState<Date>(() => mondayOf(new Date()));
  const [monthRef, setMonthRef]     = useState<Date>(() => firstOfMonth(new Date()));
  const [draft, setDraft]           = useState<DraftEvent | null>(null);

  // Minute-tick — drives the now line + the now/next strip.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  /* ────────────────────────────────────────── derived */

  const todayYMD  = now ? dateToYMD(now) : null;
  const nowMinute = now ? now.getHours() * 60 + now.getMinutes() : -1;

  const weekDates = useMemo(
    () => Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const weekStartYMD = dateToYMD(weekDates[0]);
  const weekEndYMD   = dateToYMD(weekDates[6]);
  const weekEvents = useMemo(
    () =>
      events.filter(
        (e) => e.date >= weekStartYMD && e.date <= weekEndYMD,
      ),
    [events, weekStartYMD, weekEndYMD],
  );

  const todayDayIdx = useMemo(
    () => (now ? weekDates.findIndex((d) => isSameDay(d, now)) : -1),
    [weekDates, now],
  );

  const todayEvents = useMemo(() => {
    if (!todayYMD) return [];
    return events
      .filter((e) => e.date === todayYMD)
      .sort((a, b) => a.start_minute - b.start_minute);
  }, [events, todayYMD]);

  const nowEvent = useMemo(() => {
    if (nowMinute < 0) return null;
    return todayEvents.find(
      (e) =>
        nowMinute >= e.start_minute &&
        nowMinute <  e.start_minute + e.duration_minutes,
    ) ?? null;
  }, [todayEvents, nowMinute]);

  const nextEvent = useMemo(() => {
    if (nowMinute < 0) return null;
    return todayEvents.find((e) => e.start_minute > nowMinute) ?? null;
  }, [todayEvents, nowMinute]);

  const weekStats = useMemo(() => {
    const totalMin = weekEvents.reduce((a, e) => a + e.duration_minutes, 0);
    const byDay: Record<string, number> = {};
    weekEvents.forEach((e) => {
      byDay[e.date] = (byDay[e.date] ?? 0) + e.duration_minutes;
    });
    let busiestYMD = '';
    let busiestMin = 0;
    Object.entries(byDay).forEach(([d, m]) => {
      if (m > busiestMin) {
        busiestMin = m;
        busiestYMD = d;
      }
    });
    const busiestDate = busiestYMD ? parseYMD(busiestYMD) : null;
    return {
      hours: totalMin / 60,
      count: weekEvents.length,
      busiest: busiestDate
        ? DAY_LABELS[((busiestDate.getDay() + 6) % 7)]
        : '—',
    };
  }, [weekEvents]);

  /* ────────────────────────────────────────── actions */

  const openCreate = (date: string, minute: number, preset?: Partial<DraftEvent>) => {
    const requested = preset?.duration_minutes ?? 60;
    const freeRun   = maxFreeMinutes(events, date, minute);
    setDraft({
      isNew: true,
      date,
      start_minute: minute,
      duration_minutes: Math.max(15, Math.min(requested, freeRun || requested)),
      title: preset?.title ?? '',
      color: preset?.color ?? PALETTE[(minute / 30) % PALETTE.length],
      user_id: null,
      notes: null,
      task_id: null,
    });
  };

  const openEdit = (e: ScheduleEvent) => {
    setDraft({ ...e, isNew: false });
  };

  const onSaveDraft = async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      if (!draft.isNew && draft.id) await clear(draft.id);
      setDraft(null);
      return;
    }

    // Refuse to save if the proposed slot is fully blocked OR if there's no
    // room for even the 15-minute minimum. Tell the user *which* event is
    // in the way so they know how to fix it.
    const freeRun = maxFreeMinutes(events, draft.date, draft.start_minute, draft.id);
    if (freeRun < 15) {
      const blockers = conflictingEvents(
        events,
        draft.date,
        draft.start_minute,
        Math.max(15, draft.duration_minutes),
        draft.id,
      );
      const who = blockers[0]?.title ?? 'another event';
      toastError(`Can't save here — overlaps with "${who}". Try another slot.`);
      return;
    }

    // The slot is partially free — clamp to whatever's available so we don't
    // silently overlap into a neighbouring event.
    const clamped = Math.min(draft.duration_minutes, freeRun);
    if (clamped < draft.duration_minutes) {
      toastInfo(
        `Trimmed to ${clamped} min — not enough room for the full duration.`,
      );
    }
    const finalDuration = Math.max(15, clamped);

    // New + recurring → fan out into a series. Subsequent edits to a series
    // instance use the regular upsert path (one occurrence at a time).
    if (draft.isNew && draft.rrule) {
      await createSeries({
        date: draft.date,
        start_minute: draft.start_minute,
        duration_minutes: finalDuration,
        title: draft.title.trim(),
        color: draft.color,
        notes: draft.notes ?? null,
        task_id: draft.task_id ?? null,
        rrule: draft.rrule,
      });
      setDraft(null);
      return;
    }

    await upsert({
      id: draft.id,
      user_id: draft.user_id ?? null,
      date: draft.date,
      start_minute: draft.start_minute,
      duration_minutes: finalDuration,
      title: draft.title.trim(),
      color: draft.color,
      notes: draft.notes ?? null,
      task_id: draft.task_id ?? null,
    });
    setDraft(null);
  };

  const onDeleteDraft = async () => {
    if (!draft || draft.isNew || !draft.id) {
      setDraft(null);
      return;
    }
    await clear(draft.id);
    setDraft(null);
  };

  const onDropEvent = async (id: string, date: string, minute: number) => {
    const ev = events.find((e) => e.id === id);
    if (!ev) return;
    if (ev.date === date && ev.start_minute === minute) return;
    const freeRun = maxFreeMinutes(events, date, minute, ev.id);
    if (freeRun === 0) return;
    const newDur = Math.min(ev.duration_minutes, freeRun);
    if (newDur === ev.duration_minutes) {
      await move(id, date, minute);
    } else {
      await upsert({
        id: ev.id,
        user_id: ev.user_id,
        date,
        start_minute: minute,
        duration_minutes: newDur,
        title: ev.title,
        color: ev.color,
        notes: ev.notes ?? null,
        task_id: ev.task_id ?? null,
      });
    }
  };

  const onPreset = (p: typeof PRESETS[number]) => {
    if (!todayYMD) return;
    const fromMinute = Math.max(nowMinute >= 0 ? nowMinute : dayStart * 60, dayStart * 60);
    const slot = findFreeMinute(events, todayYMD, fromMinute);
    openCreate(todayYMD, slot, { duration_minutes: p.duration, title: p.title, color: p.color });
  };

  // Build the export URL for whichever view is active and stream the PNG to
  // a download. Encoding the events as a base64 query param keeps the route
  // stateless (no auth/DB round-trip) and CDN-cacheable.
  const [exporting, setExporting] = useState(false);
  const onExportPng = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const accentHex = (() => {
        const a = profile?.accent ?? 'amber';
        if (a === 'violet') return 'b77aff';
        if (a === 'aurora') return '5ae6b4';
        return 'ff8a3d';
      })();
      let url: string;
      let filename: string;
      if (view === 'week') {
        const encoded = encodeEventsForExport(weekEvents);
        const params = new URLSearchParams({
          start: weekStartYMD,
          events: encoded,
          accent: accentHex,
          daystart: String(dayStart),
          dayend: String(dayEnd),
        });
        url = `/api/export/week?${params.toString()}`;
        filename = `verge-week-${weekStartYMD}.png`;
      } else {
        const ym = `${monthRef.getFullYear()}-${String(monthRef.getMonth() + 1).padStart(2, '0')}`;
        // For the month view, scope the payload to events in this month so
        // the URL stays small even for a heavy user.
        const monthEvents = events.filter((e) => e.date.startsWith(ym));
        const encoded = encodeEventsForExport(monthEvents);
        const params = new URLSearchParams({
          ym,
          events: encoded,
          accent: accentHex,
        });
        url = `/api/export/month?${params.toString()}`;
        filename = `verge-month-${ym}.png`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`export ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
      toastInfo('PNG saved.');
    } catch (err) {
      console.error('[verge] PNG export failed', err);
      toastError("Couldn't generate PNG. Try again.");
    } finally {
      setExporting(false);
    }
  };

  /* ────────────────────────────────────────── render */

  return (
    <PullToRefresh
      onRefresh={() => reloadSchedule()}
      className="relative flex h-full w-full flex-col items-center overflow-y-auto px-4 pb-24 md:px-10 md:pb-10 no-scrollbar"
    >
    <section className="relative flex w-full flex-col items-center">
      <HeaderBar
        view={view}
        setView={setView}
        stats={weekStats}
        weekStart={weekDates[0]}
        weekEnd={weekDates[6]}
        monthRef={monthRef}
        onWeekShift={(delta) => setWeekStart((w) => addDays(w, delta))}
        onWeekToday={() => setWeekStart(mondayOf(new Date()))}
        onMonthShift={(delta) =>
          setMonthRef((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1))
        }
        onMonthToday={() => setMonthRef(firstOfMonth(new Date()))}
        onExportPng={onExportPng}
        exporting={exporting}
      />

      {view === 'week' && (
        <>
          <NowStrip
            now={nowEvent}
            next={nextEvent}
            tasks={tasks}
          />
          <PresetChips onPick={onPreset} />
          <WeekView
            weekDates={weekDates}
            events={weekEvents}
            search={search.trim().toLowerCase()}
            todayDayIdx={todayDayIdx}
            nowMinute={nowMinute}
            dayStart={dayStart}
            dayEnd={dayEnd}
            onCellClick={openCreate}
            onEventClick={openEdit}
            onDrop={onDropEvent}
            onResize={resize}
          />
        </>
      )}

      {view === 'month' && (
        <MonthView
          monthRef={monthRef}
          events={events}
          onPickDay={(d) => {
            setWeekStart(mondayOf(d));
            setView('week');
          }}
          onCreateOnDay={(d) =>
            openCreate(
              dateToYMD(d),
              findFreeMinute(events, dateToYMD(d), dayStart * 60),
            )
          }
        />
      )}

      {draft && (
        <EventEditor
          draft={draft}
          onChange={setDraft}
          onSave={onSaveDraft}
          onDelete={draft.isNew ? undefined : onDeleteDraft}
          onDeleteSeries={
            draft.isNew || !draft.series_id
              ? undefined
              : async () => {
                  await clearSeries(draft.series_id!);
                  setDraft(null);
                }
          }
          onClose={() => setDraft(null)}
          tasks={tasks}
          events={events}
        />
      )}
    </section>
    </PullToRefresh>
  );
}

/* ───────────────────────────────────────────────── header */

function HeaderBar({
  view, setView, stats,
  weekStart, weekEnd, monthRef,
  onWeekShift, onWeekToday, onMonthShift, onMonthToday,
  onExportPng, exporting,
}: {
  view: 'week' | 'month';
  setView: (v: 'week' | 'month') => void;
  stats: { hours: number; count: number; busiest: string };
  weekStart: Date;
  weekEnd: Date;
  monthRef: Date;
  onWeekShift: (delta: number) => void;
  onWeekToday: () => void;
  onMonthShift: (delta: number) => void;
  onMonthToday: () => void;
  onExportPng: () => void;
  exporting: boolean;
}) {
  const weekLabel = useMemo(() => {
    const a = weekStart.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const b = weekEnd.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return `${a} — ${b}`;
  }, [weekStart, weekEnd]);

  const monthLabel = useMemo(
    () => monthRef.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    [monthRef],
  );

  return (
    <div className="z-10 mt-2 flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 rounded-full border border-line bg-bg/60 p-1.5 backdrop-blur-md">
        {(['week', 'month'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={clsx(
              'rounded-full px-6 py-2 text-[11px] font-semibold tracking-[0.18em] uppercase transition-all',
              view === v
                ? 'bg-amber/[0.18] text-amber shadow-[0_0_18px_rgba(255,138,61,0.20)]'
                : 'text-ink-faint hover:text-ink-mute',
            )}
          >
            {v} view
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => (view === 'week' ? onWeekShift(-7) : onMonthShift(-1))}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-mute transition-colors hover:border-amber/30 hover:text-amber"
          aria-label="Previous"
        >
          ‹
        </button>
        <button
          onClick={() => (view === 'week' ? onWeekToday() : onMonthToday())}
          className="rounded-full border border-line px-4 py-1.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-mute transition-colors hover:border-amber/30 hover:text-amber"
        >
          {view === 'week' ? weekLabel : monthLabel}
        </button>
        <button
          onClick={() => (view === 'week' ? onWeekShift(7) : onMonthShift(1))}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-mute transition-colors hover:border-amber/30 hover:text-amber"
          aria-label="Next"
        >
          ›
        </button>
      </div>

      <div className="flex items-center gap-2">
        <StatPill label={`${stats.hours.toFixed(1)}h booked`} />
        <StatPill label={`${stats.count} events`} />
        <StatPill label={`Busiest · ${stats.busiest}`} accent={stats.count > 0} />

        {/* Download the current view as a PNG. Server-rendered via
            /api/export/{week,month} so the output is pixel-stable across
            devices and works in mobile browsers where canvas-tainting
            tricks usually fail. */}
        <button
          onClick={onExportPng}
          disabled={exporting}
          aria-label={`Download ${view} as PNG`}
          title={`Download ${view} as PNG`}
          className="flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-mute transition-colors hover:border-amber/30 hover:text-amber disabled:opacity-50"
        >
          {exporting ? (
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 animate-spin" fill="none">
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" strokeOpacity="0.25" />
              <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
              <path
                d="M10 3v10M5.5 8.5L10 13l4.5-4.5M4 17h12"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          PNG
        </button>
      </div>
    </div>
  );
}

function StatPill({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span
      className={clsx(
        'rounded-full border px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]',
        accent
          ? 'border-amber/30 bg-amber/[0.08] text-amber'
          : 'border-line bg-bg/60 text-ink-mute',
      )}
    >
      {label}
    </span>
  );
}

/* ───────────────────────────────────────────────── now strip */

function NowStrip({
  now, next, tasks,
}: {
  now: ScheduleEvent | null;
  next: ScheduleEvent | null;
  tasks: Array<{ id: string; title: string }>;
}) {
  const setFocus = useUIStore((s) => s.setFocus);
  const selectTask = useUIStore((s) => s.selectTask);
  const setMode = useTimerStore((s) => s.setMode);
  const setTarget = useTimerStore((s) => s.setTarget);
  const reset = useTimerStore((s) => s.reset);
  const start = useTimerStore((s) => s.start);

  if (!now && !next) return null;

  const linkedTask = now?.task_id ? tasks.find((t) => t.id === now.task_id) : null;

  const initiate = () => {
    setMode('focus');
    const target = Math.min((now?.duration_minutes ?? 60), 90) * 60 * 1000;
    setTarget(target);
    reset();
    start(now?.task_id ?? null);
    if (now?.task_id) selectTask(now.task_id);
    setFocus(true);
  };

  return (
    <div className="mt-6 w-full max-w-[1100px]">
      <div className="card flex flex-wrap items-center gap-4 p-4">
        {now ? (
          <>
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inset-0 animate-ping rounded-full bg-amber opacity-50" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-amber shadow-[0_0_10px_rgba(255,138,61,0.6)]" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber">Now</span>
            <span className="text-base text-ink">{now.title}</span>
            <span className="text-xs text-ink-faint">
              until {formatMinute(now.start_minute + now.duration_minutes)}
            </span>
            {linkedTask && (
              <span className="hidden text-xs text-ink-faint md:inline">
                · linked to {linkedTask.title}
              </span>
            )}
            <button onClick={initiate} className="btn-amber ml-auto">
              Initiate Focus
            </button>
          </>
        ) : (
          <>
            <span className="h-2 w-2 shrink-0 rounded-full bg-amber/40" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
              Next at {formatMinute(next!.start_minute)}
            </span>
            <span className="text-base text-ink">{next!.title}</span>
            <span className="ml-auto text-xs text-ink-faint">
              {(next!.duration_minutes / 60).toFixed(next!.duration_minutes % 60 === 0 ? 0 : 1)}h block
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────── presets */

function PresetChips({ onPick }: { onPick: (p: typeof PRESETS[number]) => void }) {
  return (
    <div className="mt-4 flex w-full max-w-[1100px] flex-wrap items-center gap-2">
      <span className="eyebrow mr-1">Quick add</span>
      {PRESETS.map((p) => (
        <button
          key={p.title}
          onClick={() => onPick(p)}
          className="flex items-center gap-2 rounded-full border border-line bg-bg/60 px-3.5 py-1.5 text-xs font-medium text-ink-mute transition-colors hover:border-amber/30 hover:text-ink"
        >
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.title}
          <span className="text-ink-faint">
            · {p.duration / 60 >= 1 ? `${p.duration / 60}h` : `${p.duration}m`}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────────────────────────────── week view */

function WeekView({
  weekDates, events, search, todayDayIdx, nowMinute,
  dayStart, dayEnd, onCellClick, onEventClick, onDrop, onResize,
}: {
  weekDates: Date[];
  events: ScheduleEvent[];
  search: string;
  todayDayIdx: number;
  nowMinute: number;
  dayStart: number;
  dayEnd: number;
  onCellClick: (date: string, minute: number) => void;
  onEventClick: (e: ScheduleEvent) => void;
  onDrop: (id: string, date: string, minute: number) => void;
  onResize: (id: string, newDurationMinutes: number) => void;
}) {
  const totalRows = Math.max(2, (dayEnd - dayStart) * 2); // 30-min granularity
  const query = search;
  const isMobile = useIsMobile();

  // Now line position — only when today's column is visible and the
  // current minute is within the day window.
  const nowMinutesFromDayStart = nowMinute - dayStart * 60;
  const showNowLine =
    todayDayIdx >= 0 &&
    nowMinutesFromDayStart >= 0 &&
    nowMinutesFromDayStart < (dayEnd - dayStart) * 60;
  const nowRow = showNowLine ? Math.floor(nowMinutesFromDayStart / 30) : -1;
  const nowFraction = showNowLine ? (nowMinutesFromDayStart % 30) / 30 : 0;

  return (
    <div
      className="relative mt-6 w-full max-w-[1100px] flex-1 min-h-[520px] overflow-x-auto md:overflow-x-visible no-scrollbar"
      style={isMobile ? undefined : { perspective: '1600px' }}
    >
      <div
        className={isMobile ? 'min-w-[640px]' : 'absolute inset-0'}
        style={
          isMobile
            ? undefined
            : {
                transform: 'rotateX(44deg) translateZ(0)',
                transformOrigin: '50% 50%',
              }
        }
      >
        <div
          aria-hidden
          className="absolute -inset-x-10 -bottom-10 -top-10 rounded-[40px]"
          style={{
            background:
              'radial-gradient(ellipse at 50% 100%, rgba(255,122,24,0.22) 0%, transparent 55%)',
            filter: 'blur(20px)',
          }}
        />
        <div
          className="relative grid h-full rounded-2xl border border-line bg-bg/30"
          style={{
            gridTemplateColumns: `60px repeat(7, minmax(0, 1fr))`,
            gridTemplateRows:    `36px repeat(${totalRows}, minmax(0, 1fr))`,
          }}
        >
          <div />

          {/* Day headers — date + weekday, today glows */}
          {weekDates.map((d, i) => (
            <div
              key={i}
              style={{ gridColumn: i + 2, gridRow: 1 }}
              className={clsx(
                'flex items-center justify-center gap-1.5 border-b border-line text-[11px] font-semibold tracking-[0.18em]',
                i === todayDayIdx ? 'text-amber' : 'text-ink-faint',
              )}
            >
              <span>{DAY_LABELS[i]}</span>
              <span className="tabular-nums opacity-70">{d.getDate()}</span>
            </div>
          ))}

          {/* Hour labels (every 2 rows = each hour) */}
          {Array.from({ length: dayEnd - dayStart }).map((_, h) => (
            <div
              key={`hr-${h}`}
              style={{ gridColumn: 1, gridRow: h * 2 + 2 }}
              className="flex items-start justify-end pr-3 pt-0.5 text-[11px] text-ink-faint tabular-nums"
            >
              {String(dayStart + h).padStart(2, '0')}:00
            </div>
          ))}

          {/* Today-column wash */}
          {todayDayIdx >= 0 && (
            <div
              aria-hidden
              className="pointer-events-none bg-amber/[0.04]"
              style={{
                gridColumn: todayDayIdx + 2,
                gridRow: `2 / span ${totalRows}`,
              }}
            />
          )}

          {/* Background cells (clickable to create) */}
          {Array.from({ length: 7 * totalRows }).map((_, idx) => {
            const dayIdx = idx % 7;
            const row    = Math.floor(idx / 7);
            const date   = dateToYMD(weekDates[dayIdx]);
            const minute = dayStart * 60 + row * 30;
            return (
              <div
                key={`bg-${dayIdx}-${row}`}
                onClick={() => onCellClick(date, minute)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/event-id');
                  if (id) onDrop(id, date, minute);
                }}
                style={{
                  gridColumn: dayIdx + 2,
                  gridRow: row + 2,
                  borderRight: '1px solid rgba(255,138,61,0.10)',
                  borderBottom: row % 2 === 1
                    ? '1px solid rgba(255,138,61,0.10)'
                    : '1px dashed rgba(255,138,61,0.05)',
                }}
                className={clsx(
                  'cursor-pointer transition-colors',
                  dayIdx === todayDayIdx
                    ? 'hover:bg-amber/[0.07]'
                    : 'hover:bg-amber/[0.03]',
                )}
              />
            );
          })}

          {/* Now line within today's current 30-min slot */}
          {showNowLine && (
            <div
              aria-hidden
              className="pointer-events-none relative"
              style={{
                gridColumn: todayDayIdx + 2,
                gridRow: nowRow + 2,
                zIndex: 3,
              }}
            >
              <div
                className="absolute -left-1.5 right-0"
                style={{ top: `${nowFraction * 100}%` }}
              >
                <span className="absolute -top-[5px] left-0 h-2.5 w-2.5 rounded-full bg-amber shadow-[0_0_10px_rgba(255,138,61,0.7)]" />
                <span className="absolute left-1.5 right-0 top-0 h-[2px] bg-amber/85 shadow-[0_0_8px_rgba(255,138,61,0.5)]" />
              </div>
            </div>
          )}

          {/* Events */}
          {events.map((e) => {
            const dayIdx = weekDates.findIndex((d) => dateToYMD(d) === e.date);
            if (dayIdx < 0) return null;
            const rowStart = Math.round((e.start_minute - dayStart * 60) / 30);
            const rowSpan  = Math.max(1, Math.round(e.duration_minutes / 30));
            if (rowStart + rowSpan <= 0) return null;
            if (rowStart >= totalRows) return null;
            const visibleStart = Math.max(0, rowStart);
            const dim = query.length > 0 && !e.title.toLowerCase().includes(query);
            return (
              <EventBlock
                key={e.id}
                ev={e}
                dayIdx={dayIdx}
                rowStart={rowStart}
                visibleStart={visibleStart}
                totalRows={totalRows}
                dim={dim}
                onEventClick={onEventClick}
                onResize={onResize}
                allEvents={events}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────── event block */

function EventBlock({
  ev, dayIdx, rowStart, visibleStart, totalRows, dim,
  onEventClick, onResize, allEvents,
}: {
  ev: ScheduleEvent;
  dayIdx: number;
  rowStart: number;        // first row this event occupies (may be negative)
  visibleStart: number;    // clamped to >= 0; the row we actually render at
  totalRows: number;       // total grid rows, for clamping the bottom
  dim: boolean;
  onEventClick: (e: ScheduleEvent) => void;
  onResize: (id: string, newDurationMinutes: number) => void;
  allEvents: ScheduleEvent[];
}) {
  const blockRef = useRef<HTMLDivElement>(null);
  const [previewDuration, setPreviewDuration] = useState<number | null>(null);
  const resizingRef = useRef<{
    startY: number;
    startDuration: number;
    pxPerMinute: number;
    maxDuration: number;
  } | null>(null);

  // Subtask progress for the linked task — shown as a tiny "done/total"
  // chip + thin progress bar on event blocks ≥ 1h. Lets the user see
  // how the linked stream is going without opening the modal.
  const allSubtasks = useSubtaskStore((s) => s.subtasks);
  const subProgress = useMemo(
    () => (ev.task_id ? subtaskProgress(allSubtasks, ev.task_id) : null),
    [ev.task_id, allSubtasks],
  );

  const displayDuration = previewDuration ?? ev.duration_minutes;
  const displayEndMinute = ev.start_minute + displayDuration;
  // Visible span recomputes when the user is dragging the bottom handle so
  // the live preview stretches the block along with the cursor.
  const rowSpan = Math.max(1, Math.round(displayDuration / 30));
  const visibleSpan = Math.min(
    totalRows - visibleStart,
    rowSpan - (visibleStart - rowStart),
  );

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const block = blockRef.current;
    if (!block) return;
    const rect = block.getBoundingClientRect();
    if (rect.height <= 0 || ev.duration_minutes <= 0) return;

    // Free space ahead = max width we can drag to. Subtract zero (event itself
    // is at the start of its own slot, so maxFreeMinutes from start is the
    // contiguous run of free time including the event's current footprint).
    const maxFree = maxFreeMinutes(allEvents, ev.date, ev.start_minute, ev.id);
    const maxDur = Math.max(15, maxFree);

    resizingRef.current = {
      startY: e.clientY,
      startDuration: ev.duration_minutes,
      pxPerMinute: rect.height / ev.duration_minutes,
      maxDuration: maxDur,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: React.PointerEvent) => {
    const r = resizingRef.current;
    if (!r) return;
    const deltaY = e.clientY - r.startY;
    const deltaMin = deltaY / r.pxPerMinute;
    // Snap to 15-min increments (smaller granularity than the 30-min grid for
    // smoother feel — the underlying schema and visual grid both accept any
    // multiple of 15).
    const stepped = Math.round((r.startDuration + deltaMin) / 15) * 15;
    const next = Math.min(r.maxDuration, Math.max(15, stepped));
    setPreviewDuration(next);
  };

  const onResizePointerUp = (e: React.PointerEvent) => {
    const r = resizingRef.current;
    resizingRef.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    const next = previewDuration;
    setPreviewDuration(null);
    if (!r || next == null || next === ev.duration_minutes) return;
    onResize(ev.id, next);
  };

  return (
    <div
      ref={blockRef}
      draggable={!resizingRef.current}
      onDragStart={(ev2) => ev2.dataTransfer.setData('text/event-id', ev.id)}
      onClick={(ev2) => { ev2.stopPropagation(); onEventClick(ev); }}
      style={{
        gridColumn: dayIdx + 2,
        gridRow: `${visibleStart + 2} / span ${Math.max(1, visibleSpan)}`,
        backgroundColor: `${ev.color}26`,
        boxShadow: `inset 0 0 0 1px ${ev.color}66, 0 0 18px -6px ${ev.color}`,
        zIndex: previewDuration != null ? 5 : 2,
      }}
      className={clsx(
        'group relative m-1 flex flex-col justify-between overflow-hidden rounded-md p-2 text-[11px] font-medium text-ink/95 transition-all hover:scale-[1.02]',
        dim && 'opacity-25',
        previewDuration != null && 'ring-2 ring-amber/50',
      )}
      title={ev.title}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="truncate">{ev.title}</span>
        {/* Subtask progress chip — only when the event is linked to a task
            and that task actually has subtasks. */}
        {subProgress && subProgress.total > 0 && (
          <span
            className="shrink-0 rounded-full px-1.5 py-[1px] text-[8px] font-semibold tabular-nums"
            style={{ background: `${ev.color}33`, color: ev.color }}
            title={`${subProgress.done} of ${subProgress.total} subtasks complete`}
          >
            {subProgress.done}/{subProgress.total}
          </span>
        )}
      </div>
      {visibleSpan > 1 && (
        <span className="text-[9px] text-ink-faint">
          {formatMinute(ev.start_minute)} – {formatMinute(displayEndMinute)}
        </span>
      )}
      {/* Progress bar — thin, hugs the bottom. Only on events ≥ 60 min so
          the chip alone carries shorter ones. */}
      {subProgress && subProgress.total > 0 && visibleSpan >= 2 && (
        <div
          className="absolute inset-x-1.5 bottom-1.5 h-[2px] rounded-full"
          style={{ background: `${ev.color}33` }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${(subProgress.done / subProgress.total) * 100}%`,
              background: ev.color,
            }}
          />
        </div>
      )}

      {/* Bottom-edge resize handle. Only renders for events tall enough to
          afford a hit target; tiny 30-min events stay click-only to keep
          the drag-to-move affordance unambiguous. */}
      {visibleSpan >= 2 && (
        <div
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize touch-none opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100"
          style={{
            background: `linear-gradient(to top, ${ev.color}80, transparent)`,
          }}
          aria-label="Resize event"
        />
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────── month view */

function MonthView({
  monthRef, events, onPickDay, onCreateOnDay,
}: {
  monthRef: Date;
  events: ScheduleEvent[];
  onPickDay: (d: Date) => void;
  onCreateOnDay: (d: Date) => void;
}) {
  const grid = useMemo(() => {
    const first = firstOfMonth(monthRef);
    const startWeekday = (first.getDay() + 6) % 7;
    const inMonth = daysInMonth(monthRef);
    return Array.from({ length: 42 }).map((_, i) => {
      const dateNum = i - startWeekday + 1;
      if (dateNum < 1 || dateNum > inMonth) {
        return { index: i, date: null as Date | null, events: [] as ScheduleEvent[], isToday: false };
      }
      const d = new Date(monthRef.getFullYear(), monthRef.getMonth(), dateNum);
      const ymd = dateToYMD(d);
      const dayEvs = events
        .filter((e) => e.date === ymd)
        .sort((a, b) => a.start_minute - b.start_minute);
      return {
        index: i,
        date: d,
        events: dayEvs,
        isToday: isSameDay(d, new Date()),
      };
    });
  }, [monthRef, events]);

  return (
    <div className="mt-6 w-full max-w-[1100px] flex-1">
      <div className="card flex h-full flex-col p-7">
        <div className="grid grid-cols-7 gap-2">
          {DAY_LABELS.map((d) => (
            <div
              key={d}
              className="pb-2 text-center text-[10px] font-semibold tracking-[0.20em] text-ink-faint"
            >
              {d}
            </div>
          ))}
          {grid.map((c) => (
            <div
              key={c.index}
              className={clsx(
                'group relative flex aspect-square flex-col justify-between rounded-lg border p-2 text-left transition-colors',
                c.date === null && 'pointer-events-none border-line/20 opacity-25',
                c.isToday
                  ? 'border-amber/40 bg-amber/[0.07]'
                  : 'border-line/40 hover:bg-amber/[0.05]',
              )}
            >
              {c.date && (
                <>
                  <div className="flex items-start justify-between">
                    <button
                      onClick={() => c.date && onPickDay(c.date)}
                      className={clsx(
                        'text-sm tabular-nums transition-opacity hover:opacity-80',
                        c.isToday ? 'font-medium text-amber' : 'text-ink',
                      )}
                    >
                      {c.date.getDate()}
                    </button>
                    <button
                      onClick={() => c.date && onCreateOnDay(c.date)}
                      className="opacity-0 transition-opacity group-hover:opacity-100 text-[10px] text-ink-faint hover:text-amber"
                      aria-label="Add event"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {c.events.slice(0, 2).map((e) => (
                      <div
                        key={e.id}
                        className="truncate rounded px-1 text-[10px]"
                        style={{
                          backgroundColor: `${e.color}24`,
                          color: e.color,
                        }}
                      >
                        {formatMinute(e.start_minute)} {e.title}
                      </div>
                    ))}
                    {c.events.length > 2 && (
                      <div className="text-[10px] text-ink-faint">
                        +{c.events.length - 2} more
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────── editor modal */

function EventEditor({
  draft, onChange, onSave, onDelete, onDeleteSeries, onClose, tasks, events,
}: {
  draft: DraftEvent;
  onChange: (d: DraftEvent) => void;
  onSave: () => void;
  onDelete?: () => void;
  onDeleteSeries?: () => void;
  onClose: () => void;
  tasks: Array<{ id: string; title: string; completed_at: string | null }>;
  events: ScheduleEvent[];
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onSave]);

  const openTasks = tasks.filter((t) => !t.completed_at);
  const maxDur = maxFreeMinutes(events, draft.date, draft.start_minute, draft.id);
  const validDurations = ALL_DURATIONS.filter((d) => d <= (maxDur || 1440));
  if (!validDurations.includes(draft.duration_minutes)) {
    validDurations.push(draft.duration_minutes);
    validDurations.sort((a, b) => a - b);
  }

  const dateObj = parseYMD(draft.date);
  const dateLabel = dateObj.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
      <div
        className="card relative z-10 w-[min(92vw,480px)] p-7 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="eyebrow-amber">
            {draft.isNew ? 'New event' : 'Edit event'}
          </div>
          <div className="text-xs text-ink-faint">{dateLabel}</div>
        </div>

        <input
          ref={titleRef}
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          placeholder="What's on the schedule?"
          className="mt-5 w-full rounded-xl border border-line bg-bg/60 px-4 py-3 text-base text-ink placeholder:text-ink-faint focus:border-amber/40 focus:outline-none transition-colors"
        />

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div>
            <div className="eyebrow mb-2">Date</div>
            <input
              type="date"
              value={draft.date}
              onChange={(e) => onChange({ ...draft, date: e.target.value })}
              className="w-full rounded-xl border border-line bg-bg/60 px-3 py-2.5 text-sm text-ink focus:border-amber/40 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <div className="eyebrow mb-2">Start</div>
            <input
              type="time"
              step="900"
              value={formatMinute(draft.start_minute)}
              onChange={(e) => {
                const m = parseMinute(e.target.value);
                if (!Number.isNaN(m)) onChange({ ...draft, start_minute: m });
              }}
              className="w-full rounded-xl border border-line bg-bg/60 px-3 py-2.5 text-sm text-ink focus:border-amber/40 focus:outline-none transition-colors"
            />
          </div>
        </div>

        <div className="mt-4">
          <div className="eyebrow mb-2">Duration</div>
          <select
            value={draft.duration_minutes}
            onChange={(e) =>
              onChange({ ...draft, duration_minutes: Number(e.target.value) })
            }
            className="w-full appearance-none rounded-xl border border-line bg-bg/60 px-3 py-2.5 text-sm text-ink focus:border-amber/40 focus:outline-none transition-colors"
          >
            {validDurations.map((d) => (
              <option key={d} value={d}>
                {d < 60 ? `${d} minutes` : d === 60 ? '1 hour' : d % 60 === 0 ? `${d / 60} hours` : `${(d / 60).toFixed(1)} hours`}
              </option>
            ))}
          </select>
          {maxDur > 0 && maxDur < 1440 && (
            <div className="mt-1 text-[11px] text-ink-faint">
              Free until {formatMinute(draft.start_minute + maxDur)} from this start.
            </div>
          )}
        </div>

        <div className="mt-4">
          <div className="eyebrow mb-2">Colour</div>
          <div className="flex gap-2.5">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange({ ...draft, color: c })}
                className={clsx(
                  'h-8 w-8 rounded-full transition-transform',
                  draft.color === c && 'ring-2 ring-white/80 ring-offset-2 ring-offset-bg scale-110',
                )}
                style={{ background: c, boxShadow: `0 0 14px ${c}66` }}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        </div>

        {openTasks.length > 0 && (
          <div className="mt-4">
            <div className="eyebrow mb-2">Linked task (optional)</div>
            <select
              value={draft.task_id ?? ''}
              onChange={(e) =>
                onChange({ ...draft, task_id: e.target.value || null })
              }
              className="w-full appearance-none rounded-xl border border-line bg-bg/60 px-3 py-2.5 text-sm text-ink focus:border-amber/40 focus:outline-none transition-colors"
            >
              <option value="">— None —</option>
              {openTasks.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
        )}

        {/* Linked-task subtasks — show + toggle from the calendar so the
            user can tick off checklist items mid-event without context-
            switching to Nexus. */}
        {draft.task_id && <LinkedTaskSubtasks taskId={draft.task_id} />}

        <div className="mt-4">
          <div className="eyebrow mb-2">Notes</div>
          <textarea
            value={draft.notes ?? ''}
            onChange={(e) => onChange({ ...draft, notes: e.target.value })}
            placeholder="Anything to remember…"
            rows={2}
            className="w-full resize-none rounded-xl border border-line bg-bg/60 px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-amber/40 focus:outline-none transition-colors"
          />
        </div>

        {/* Repeat — only meaningful when creating a new event. Existing
            instances surface "this is part of a series" + a delete-series
            shortcut in the footer instead, keeping the per-instance edit
            path (date/time/duration) free of recurrence ambiguity. */}
        {draft.isNew && (
          <div className="mt-4 flex items-center justify-between">
            <div>
              <div className="eyebrow mb-1">Repeat</div>
              <div className="text-[11px] text-ink-faint">
                Generates up to 26 weeks of instances upfront.
              </div>
            </div>
            <RepeatPicker
              value={draft.rrule ?? null}
              onChange={(rrule) => onChange({ ...draft, rrule })}
              anchorDate={parseYMD(draft.date)}
            />
          </div>
        )}
        {!draft.isNew && draft.series_id && (
          <div className="mt-4 rounded-lg border border-amber/20 bg-amber/[0.04] px-3 py-2 text-xs text-ink-mute">
            This is one occurrence of a recurring event.
          </div>
        )}

        <div className="mt-6 flex items-center gap-3">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-red-400"
            >
              Delete
            </button>
          )}
          {onDeleteSeries && draft.series_id && (
            <button
              type="button"
              onClick={onDeleteSeries}
              className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-red-400"
            >
              Delete series
            </button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="button" onClick={onSave} className="btn-amber">
            {draft.isNew ? 'Add event' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────── linked-task subtasks
 *
 * Renders the parent task's subtask checklist inside the Chronos event
 * editor whenever the event is linked to a task. The user can tick items
 * off here without bouncing to Nexus mid-event. Read-only when no
 * subtasks exist yet — the empty state nudges the user toward Nexus
 * rather than silently rendering nothing.
 */
function LinkedTaskSubtasks({ taskId }: { taskId: string }) {
  const tasks    = useTaskStore((s) => s.tasks);
  const all      = useSubtaskStore((s) => s.subtasks);
  const toggle   = useSubtaskStore((s) => s.toggle);
  const setView  = useUIStore((s) => s.setView);
  const selectTask = useUIStore((s) => s.selectTask);

  const task = tasks.find((t) => t.id === taskId);
  const subs = subtasksForTask(all, taskId);
  const progress = subtaskProgress(all, taskId);

  // If the linked task got deleted, show a soft hint and bail.
  if (!task) {
    return (
      <div className="mt-4 rounded-xl border border-line bg-bg/40 p-3 text-xs text-ink-faint">
        Linked stream no longer exists.
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="eyebrow">
          Subtasks
          {progress.total > 0 && (
            <span className="ml-2 tabular-nums text-ink-faint">
              {progress.done} / {progress.total}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => { selectTask(task.id); setView('nexus'); }}
          className="text-[10px] uppercase tracking-[0.14em] text-ink-faint transition-colors hover:text-amber"
          title="Edit the stream in Nexus"
        >
          Open stream →
        </button>
      </div>

      {subs.length === 0 ? (
        <div className="rounded-xl border border-line bg-bg/40 p-3 text-xs text-ink-faint">
          No subtasks on this stream yet. Add them in Nexus, then they&apos;ll appear here.
        </div>
      ) : (
        <ul className="space-y-1.5 rounded-xl border border-line bg-bg/40 p-3">
          {subs.map((s) => {
            const done = !!s.completed_at;
            return (
              <li key={s.id} className="flex items-start gap-2.5">
                <button
                  type="button"
                  onClick={() => toggle(s.id)}
                  aria-label={done ? 'Mark incomplete' : 'Mark complete'}
                  className={clsx(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                    done ? 'border-amber bg-amber/30 text-amber' : 'border-line hover:border-amber/40',
                  )}
                >
                  {done && (
                    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                      <path d="M2.5 6.5l2 2 4-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <span
                  className={clsx(
                    'flex-1 text-sm leading-snug',
                    done ? 'text-ink-faint line-through' : 'text-ink',
                  )}
                >
                  {s.title}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
