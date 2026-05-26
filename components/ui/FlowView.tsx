'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useTaskStore } from '@/stores/useTaskStore';
import { useTimerStore } from '@/stores/useTimerStore';
import { useScheduleStore } from '@/stores/useScheduleStore';
import { useUIStore } from '@/stores/useUIStore';
import { useUserStore } from '@/stores/useUserStore';
import {
  DEFAULT_PREFERENCES,
  type Priority,
  type ScheduleEvent,
  type Task,
} from '@/lib/types';
import { dateToYMD, formatMinute } from '@/lib/dates';
import { computeStreak } from '@/lib/insights';
import EmptyState from '@/components/ui/EmptyState';

// Flow — daily orientation dashboard. Reads goals + day window from the
// user's profile, surfaces today's date-anchored events, computes a real
// progress ring against the daily goal, and shows a weekly bar chart.

const PRIORITY_NAME: Record<Priority, string> = {
  high:   'Priority Alpha',
  medium: 'Priority Beta',
  low:    'Priority Gamma',
};
const PRIORITY_PIPS: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
const PRIORITY_DOT: Record<Priority, string> = {
  high:   'bg-amber',
  medium: 'bg-amber-soft',
  low:    'bg-lunar',
};

export default function FlowView() {
  const tasks   = useTaskStore((s) => s.tasks);
  const history = useTimerStore((s) => s.history);
  const events  = useScheduleStore((s) => s.events);

  const setView    = useUIStore((s) => s.setView);
  const setFocus   = useUIStore((s) => s.setFocus);
  const selectTask = useUIStore((s) => s.selectTask);
  const profile    = useUserStore((s) => s.profile);
  const user       = useUserStore((s) => s.user);

  const setMode   = useTimerStore((s) => s.setMode);
  const setTarget = useTimerStore((s) => s.setTarget);
  const reset     = useTimerStore((s) => s.reset);
  const start     = useTimerStore((s) => s.start);

  // Preferences with safe fallbacks.
  const dailyGoalMin  = profile?.daily_goal_min  ?? DEFAULT_PREFERENCES.daily_goal_min;
  const weeklyGoalMin = profile?.weekly_goal_min ?? DEFAULT_PREFERENCES.weekly_goal_min;

  /* ─────────────────────────────────────────────── derived */

  const displayName = profile?.display_name ?? user?.email?.split('@')[0] ?? 'Stargazer';

  // `now` populates after mount so SSR + hydration produce identical HTML.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const hour = now?.getHours() ?? -1;

  const dateLabel = useMemo(() => {
    if (!now) return ' ';
    return (
      now.toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }) +
      ' · ' +
      now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    );
  }, [now]);

  const open      = tasks.filter((t) => !t.completed_at);
  const completed = tasks.filter((t) =>  t.completed_at);

  // Streak — derived from focus sessions. Surfaced both as a chip in the
  // header and (when active) as a one-line nudge in the greeting copy so
  // it lives on the screen the user opens first.
  const streak = useMemo(() => computeStreak(history, now), [history, now]);

  const topTask = useMemo<Task | undefined>(() => {
    return [...open].sort((a, b) => {
      const w = weight(b.priority) - weight(a.priority);
      if (w !== 0) return w;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    })[0];
  }, [open]);

  // Today's events (date-anchored, not weekday-recurring).
  const todayYMD = now ? dateToYMD(now) : null;
  const nowMinute = now ? now.getHours() * 60 + now.getMinutes() : -1;

  const todayEvents = useMemo<ScheduleEvent[]>(() => {
    if (!todayYMD) return [];
    return events
      .filter((e) => e.date === todayYMD)
      .sort((a, b) => a.start_minute - b.start_minute);
  }, [events, todayYMD]);

  const nowBlock = useMemo(() => {
    if (nowMinute < 0) return null;
    return todayEvents.find(
      (e) =>
        nowMinute >= e.start_minute &&
        nowMinute <  e.start_minute + e.duration_minutes,
    ) ?? null;
  }, [todayEvents, nowMinute]);

  const nextBlock = useMemo(() => {
    if (nowMinute < 0) return null;
    return todayEvents.find((e) => e.start_minute > nowMinute) ?? null;
  }, [todayEvents, nowMinute]);

  const completedToday = useMemo(() => {
    if (!now) return [];
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    return completed.filter(
      (t) => t.completed_at && new Date(t.completed_at) >= startOfDay,
    );
  }, [completed, now]);

  const recentlyDone = useMemo(() => {
    return [...completed]
      .sort(
        (a, b) =>
          new Date(b.completed_at ?? 0).getTime() -
          new Date(a.completed_at ?? 0).getTime(),
      )
      .slice(0, 3);
  }, [completed]);

  const focusMinutesToday = useMemo(() => {
    if (!now) return 0;
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    return (
      history
        .filter(
          (s) => new Date(s.started_at) >= startOfDay && s.kind === 'focus',
        )
        .reduce((acc, s) => acc + s.duration_ms, 0) / 60000
    );
  }, [history, now]);

  // Smart greeting — varies by time of day AND today's activity, so the
  // same hour reads differently for someone who's been heads-down all day
  // vs someone who just opened the app for the first time. Falls back to
  // the time-only line when activity data isn't loaded yet.
  const greeting = useMemo(() => {
    if (!now) return '';
    const beenActive = focusMinutesToday > 0 || completedToday.length > 0;
    if (hour < 5) {
      return beenActive ? 'Still up,' : 'Late hours,';
    }
    if (hour < 12) {
      return beenActive ? 'Already in the flow,' : 'Good morning,';
    }
    if (hour < 18) {
      if (focusMinutesToday >= 120) return 'Steady afternoon,';
      return beenActive ? 'Back at it,' : 'Good afternoon,';
    }
    if (hour < 22) {
      return beenActive ? 'Still pushing,' : 'Good evening,';
    }
    return beenActive ? 'Burning low,' : 'Late again,';
  }, [now, hour, focusMinutesToday, completedToday.length]);

  const weekly = useMemo(() => {
    if (!now) {
      return Array.from({ length: 7 }).map(() => ({
        label: '',
        minutes: 0,
        isToday: false,
      }));
    }
    const days: Array<{ label: string; minutes: number; isToday: boolean }> = [];
    const todayMid = new Date(now); todayMid.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayMid); d.setDate(todayMid.getDate() - i);
      const next = new Date(d); next.setDate(d.getDate() + 1);
      const minutes =
        history
          .filter((s) => {
            const t = new Date(s.started_at).getTime();
            return (
              t >= d.getTime() &&
              t <  next.getTime() &&
              s.kind === 'focus'
            );
          })
          .reduce((a, s) => a + s.duration_ms, 0) / 60000;
      days.push({
        label: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 1),
        minutes,
        isToday: i === 0,
      });
    }
    return days;
  }, [history, now]);

  const weeklyTotalMin = weekly.reduce((a, d) => a + d.minutes, 0);
  const maxDailyMin = Math.max(dailyGoalMin, ...weekly.map((d) => d.minutes));

  /* ─────────────────────────────────────────────── actions */

  const initiateFocus = (task?: Task | null) => {
    setMode('focus');
    setTarget(45 * 60 * 1000);
    reset();
    start(task?.id ?? null);
    if (task) selectTask(task.id);
    setFocus(true);
  };

  const openNexusOnTask = (task: Task) => {
    selectTask(task.id);
    setView('nexus');
  };

  /* ─────────────────────────────────────────────── render */

  return (
    <section className="relative h-full w-full overflow-y-auto px-4 pb-24 pt-2 md:px-10 md:pb-10 no-scrollbar">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 md:gap-6">
        <div>
          <div className="eyebrow-amber">{dateLabel}</div>
          <h1 className="mt-2 font-display text-4xl font-light tracking-tight text-ink">
            {greeting}{' '}
            <span className="text-amber">{displayName}.</span>
          </h1>
          {nowBlock ? (
            <p className="mt-2 text-sm text-ink-mute">
              You're in <span className="text-ink">{nowBlock.title}</span> right now —
              keep the thread until {formatMinute(nowBlock.start_minute + nowBlock.duration_minutes)}.
            </p>
          ) : nextBlock ? (
            <p className="mt-2 text-sm text-ink-mute">
              Next up at <span className="text-ink">{formatMinute(nextBlock.start_minute)}</span>:{' '}
              <span className="text-ink">{nextBlock.title}</span>.
            </p>
          ) : open.length === 0 ? (
            <p className="mt-2 text-sm text-ink-mute">
              All quiet. Add a stream to get going.
            </p>
          ) : (
            <p className="mt-2 text-sm text-ink-mute">
              Nothing scheduled. Pick a stream and protect a block.
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 md:gap-3">
          {streak.current > 0 && (
            <StreakChip
              days={streak.current}
              focusedToday={streak.focusedToday}
            />
          )}
          <Chip label="Done today" value={completedToday.length} />
          <Chip label="Focus min"  value={Math.round(focusMinutesToday)} />
          <Chip label="Streams"    value={open.length} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
        {/* LEFT */}
        <div className="flex flex-col gap-6 md:col-span-7">
          <div className="card p-6 md:p-8">
            <div className="flex items-start justify-between">
              <div className="eyebrow-amber">Focus on</div>
              {topTask && (
                <span className="pill">{PRIORITY_NAME[topTask.priority]}</span>
              )}
            </div>
            {topTask ? (
              <>
                <h2 className="mt-5 font-display text-3xl leading-tight text-ink">
                  {topTask.title}
                </h2>
                {topTask.notes && (
                  <p className="mt-3 text-sm leading-relaxed text-ink-mute">
                    {topTask.notes}
                  </p>
                )}
                <div className="mt-6">
                  <div className="eyebrow mb-2">Energy required</div>
                  <div className="flex gap-1.5">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <span
                        key={i}
                        className={clsx(
                          'h-[6px] w-9 rounded-full',
                          i < PRIORITY_PIPS[topTask.priority]
                            ? 'bg-amber shadow-[0_0_10px_rgba(255,138,61,0.55)]'
                            : 'bg-amber/15',
                        )}
                      />
                    ))}
                  </div>
                </div>
                <div className="mt-7 flex gap-3">
                  <button onClick={() => initiateFocus(topTask)} className="btn-amber">
                    Initiate Focus
                  </button>
                  <button onClick={() => openNexusOnTask(topTask)} className="btn-ghost">
                    Open in Nexus
                  </button>
                </div>
              </>
            ) : (
              <OnboardingSteps
                tasksCount={tasks.length}
                eventsCount={events.length}
                sessionsCount={history.length}
                onOpenNexus={() => setView('nexus')}
                onOpenChronos={() => setView('chronos')}
                onStartFocus={() => initiateFocus(null)}
              />
            )}
          </div>

          {/* Today's schedule */}
          <div className="card p-7">
            <div className="mb-4 flex items-center justify-between">
              <div className="eyebrow">Today's schedule</div>
              <button
                onClick={() => setView('chronos')}
                className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-amber"
              >
                Open Chronos →
              </button>
            </div>
            {todayEvents.length === 0 ? (
              <EmptyState
                size="sm"
                title="Today is unbooked."
                body="Drop a block on Chronos and it'll appear here, with a 'Now' marker as it goes live."
                action={
                  <button
                    onClick={() => setView('chronos')}
                    className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber hover:text-amber-soft"
                  >
                    Plan today →
                  </button>
                }
              />
            ) : (
              <ul className="space-y-1">
                {todayEvents.slice(0, 5).map((e) => {
                  const isNow =
                    nowMinute >= e.start_minute &&
                    nowMinute <  e.start_minute + e.duration_minutes;
                  const isPast = nowMinute >= e.start_minute + e.duration_minutes;
                  return (
                    <li
                      key={e.id}
                      className={clsx(
                        'flex items-center gap-4 rounded-lg px-2 py-2.5 transition-colors',
                        isNow && 'bg-amber/[0.06]',
                      )}
                    >
                      <span
                        className={clsx(
                          'w-12 text-[13px] font-medium tabular-nums',
                          isNow ? 'text-amber' : isPast ? 'text-ink-faint' : 'text-ink-mute',
                        )}
                      >
                        {formatMinute(e.start_minute)}
                      </span>
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background: e.color,
                          boxShadow: isNow ? `0 0 12px 2px ${e.color}99` : 'none',
                        }}
                      />
                      <span
                        className={clsx(
                          'flex-1 text-[15px]',
                          isPast ? 'text-ink-faint line-through' : 'text-ink',
                        )}
                      >
                        {e.title}
                      </span>
                      {isNow && (
                        <span className="text-[10px] font-semibold uppercase tracking-[0.20em] text-amber">
                          Now
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Recently crystallised */}
          {now && recentlyDone.length > 0 && (
            <div className="card p-7">
              <div className="mb-4 eyebrow">Recently crystallised</div>
              <ul className="space-y-3">
                {recentlyDone.map((t) => (
                  <li key={t.id} className="flex items-center gap-3">
                    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-amber" fill="none">
                      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M7 10.4l2 2 4-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="flex-1 truncate text-[15px] text-ink/85">
                      {t.title}
                    </span>
                    <span className="text-xs text-ink-faint">
                      {timeAgo(t.completed_at!, now)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div className="flex flex-col gap-6 md:col-span-5">
          <div className="card p-7">
            <div className="mb-4 flex items-center justify-between">
              <div className="eyebrow-amber">Focus today</div>
              <div className="text-xs text-ink-faint">
                Goal · {(dailyGoalMin / 60).toFixed(dailyGoalMin % 60 === 0 ? 0 : 1)}h
              </div>
            </div>
            <div className="flex items-center gap-6">
              <ProgressRing
                value={focusMinutesToday}
                max={dailyGoalMin}
                size={120}
              />
              <div>
                <div className="font-display text-4xl font-medium tabular-nums text-ink">
                  {Math.floor(focusMinutesToday / 60)}
                  <span className="text-2xl text-ink-mute">h</span>{' '}
                  {Math.round(focusMinutesToday % 60)}
                  <span className="text-2xl text-ink-mute">m</span>
                </div>
                <div className="mt-1 text-xs text-ink-mute">
                  of {(dailyGoalMin / 60).toFixed(dailyGoalMin % 60 === 0 ? 0 : 1)}h goal
                </div>
                <button
                  onClick={() => initiateFocus(topTask ?? null)}
                  className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber transition-opacity hover:opacity-80"
                >
                  Start a block →
                </button>
              </div>
            </div>
          </div>

          <div className="card p-7">
            <div className="mb-1 flex items-center justify-between">
              <div className="eyebrow">This week</div>
              <div className="text-xs text-ink-faint">
                {(weeklyTotalMin / 60).toFixed(1)}h / {(weeklyGoalMin / 60).toFixed(0)}h
              </div>
            </div>
            <p className="mb-4 text-xs text-ink-faint">Focus minutes per day</p>
            <div className="flex h-24 items-end gap-2">
              {weekly.map((d, i) => {
                const pct = (d.minutes / Math.max(maxDailyMin, 30)) * 100;
                return (
                  <div key={i} className="flex flex-1 flex-col items-center gap-2">
                    <div className="relative flex h-full w-full items-end">
                      <div
                        className={clsx(
                          'w-full rounded-sm transition-all',
                          d.isToday
                            ? 'bg-amber shadow-[0_0_12px_rgba(255,138,61,0.35)]'
                            : d.minutes > 0
                            ? 'bg-amber/45'
                            : 'bg-amber/10',
                        )}
                        style={{ height: `${Math.max(pct, d.minutes > 0 ? 6 : 2)}%` }}
                      />
                    </div>
                    <span
                      className={clsx(
                        'text-[10px] font-semibold uppercase tracking-[0.16em]',
                        d.isToday ? 'text-amber' : 'text-ink-faint',
                      )}
                    >
                      {d.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {open.length > 0 && (
            <div className="card p-6">
              <div className="mb-3 flex items-center justify-between">
                <div className="eyebrow">Streams in orbit</div>
                <button
                  onClick={() => setView('nexus')}
                  className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-amber"
                >
                  All {open.length} →
                </button>
              </div>
              <ul className="space-y-2">
                {open.slice(0, 3).map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5"
                  >
                    <span className={clsx('h-2 w-2 rounded-full', PRIORITY_DOT[t.priority])} />
                    <span className="flex-1 truncate text-[14px] text-ink">{t.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────── helpers */

function Chip({ label, value }: { label: string; value: number }) {
  return (
    <div className="card flex items-center gap-3 px-4 py-2">
      <span className="font-display text-xl font-medium tabular-nums text-ink">
        {value}
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        {label}
      </span>
    </div>
  );
}

// Streak chip — visually distinct from the neutral data chips. The flame
// fades when today is still pending so the user reads "active streak, but
// you haven't logged anything yet" at a glance.
function StreakChip({
  days, focusedToday,
}: { days: number; focusedToday: boolean }) {
  return (
    <div
      className={clsx(
        'card flex items-center gap-2 border-amber/30 bg-amber/[0.05] px-4 py-2',
        focusedToday && 'shadow-[0_0_24px_-8px_rgba(255,138,61,0.55)]',
      )}
      title={
        focusedToday
          ? `${days}-day focus streak — extended today.`
          : `${days}-day focus streak — focus today to keep it alive.`
      }
    >
      <svg
        viewBox="0 0 16 20"
        className={clsx(
          'h-4 w-3.5 transition-opacity',
          focusedToday ? 'text-amber' : 'text-amber/55',
        )}
        fill="currentColor"
      >
        <path d="M8 1.2c1.4 2.8 0.4 4.4-0.6 5.6-1.2 1.4-2 2.8-2 4.6 0 .2.4.4.7.2 0.4-.6 1.0-1.4 1.5-1.4.8 0 .9 1 1.1 2 .3 1.5 1.5 2.6 3 2.6.4 0 .8-.4.6-.8-.4-.6-.6-1.4-.4-2.2.4-1.7 1.4-2.6 1.4-4.5 0-3-3-5-5.3-6.1z" />
      </svg>
      <span className="font-display text-xl font-medium tabular-nums text-amber">
        {days}
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber/80">
        day{days === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function ProgressRing({
  value, max, size = 120,
}: { value: number; max: number; size?: number }) {
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const c = 2 * Math.PI * radius;
  const pct = Math.min(1, value / Math.max(max, 1));
  const offset = c * (1 - pct);

  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="rgba(255, 138, 61, 0.10)"
        strokeWidth={stroke}
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="#ff8a3d"
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={offset}
        style={{
          transition: 'stroke-dashoffset 700ms cubic-bezier(0.22,1,0.36,1)',
          filter: 'drop-shadow(0 0 8px rgba(255, 138, 61, 0.45))',
        }}
      />
    </svg>
  );
}

function weight(p: Priority): number {
  return p === 'high' ? 3 : p === 'medium' ? 2 : 1;
}

/* ───────────────────────────────────────────────────── onboarding */

function OnboardingSteps({
  tasksCount, eventsCount, sessionsCount,
  onOpenNexus, onOpenChronos, onStartFocus,
}: {
  tasksCount: number;
  eventsCount: number;
  sessionsCount: number;
  onOpenNexus: () => void;
  onOpenChronos: () => void;
  onStartFocus: () => void;
}) {
  const steps = [
    {
      done: tasksCount > 0,
      title: 'Drop your first stream',
      desc:  'Streams live in Nexus. Give one a priority and a clear next move.',
      cta:   'Open Nexus',
      onCta: onOpenNexus,
    },
    {
      done: eventsCount > 0,
      title: 'Schedule a focus block',
      desc:  'Chronos lays out your week. Protect time before you need it.',
      cta:   'Open Chronos',
      onCta: onOpenChronos,
    },
    {
      done: sessionsCount > 0,
      title: 'Initiate a deep block',
      desc:  'When you sit down, hit Initiate Focus. The cosmos handles the rest.',
      cta:   'Start now',
      onCta: onStartFocus,
    },
  ];
  const next = steps.findIndex((s) => !s.done);

  return (
    <>
      <h2 className="mt-5 font-display text-3xl leading-tight text-ink">
        Three steps to begin.
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-mute">
        Verge is built around one user, one focus block at a time. Walk through
        these to set the rhythm; they'll fade as you do them.
      </p>
      <ol className="mt-7 space-y-4">
        {steps.map((s, i) => {
          const active = i === next;
          return (
            <li key={s.title} className="flex items-start gap-4">
              <span
                className={
                  'mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums transition-all ' +
                  (s.done
                    ? 'border-amber/60 bg-amber/[0.15] text-amber'
                    : active
                    ? 'border-amber bg-amber text-bg-deep shadow-[0_0_14px_rgba(255,138,61,0.45)]'
                    : 'border-line text-ink-faint')
                }
              >
                {s.done ? (
                  <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none">
                    <path d="M3 7.5l2.5 2.5L11 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className={s.done ? 'text-[15px] text-ink-mute line-through' : 'text-[15px] text-ink'}>
                  {s.title}
                </div>
                <div className="mt-1 text-sm text-ink-mute">{s.desc}</div>
                {!s.done && active && (
                  <button onClick={s.onCta} className="btn-amber mt-3">
                    {s.cta}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function timeAgo(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
