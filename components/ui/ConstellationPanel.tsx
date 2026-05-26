'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTaskStore } from '@/stores/useTaskStore';
import { useTimerStore } from '@/stores/useTimerStore';
import { useUIStore } from '@/stores/useUIStore';
import { useUserStore } from '@/stores/useUserStore';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { DEFAULT_PREFERENCES, type Task, type TimerSession } from '@/lib/types';
import { dateToYMD } from '@/lib/dates';
import {
  computeStreak as sharedComputeStreak,
  computeStreak as sharedComputeStreakFull,
  mondayKey as sharedMondayKey,
} from '@/lib/insights';
import FocusHeatmap from '@/components/ui/FocusHeatmap';
import AchievementGallery from '@/components/ui/AchievementGallery';
import RichAnalytics from '@/components/ui/RichAnalytics';
import EmptyState from '@/components/ui/EmptyState';
import { toastError, toastInfo, toastSuccess } from '@/stores/useToastStore';
import clsx from 'clsx';

// Astral — profile view. Stats derive from real data; the portrait shows
// the user's actual display name (editable inline). Sign-out lives here.

export default function ConstellationPanel() {
  const router = useRouter();
  const stars   = useUserStore((s) => s.stars);
  const user    = useUserStore((s) => s.user);
  const profile = useUserStore((s) => s.profile);
  const updateDisplayName = useUserStore((s) => s.updateDisplayName);
  const uploadAvatar = useUserStore((s) => s.uploadAvatar);
  const removeAvatar = useUserStore((s) => s.removeAvatar);
  const signOut = useUserStore((s) => s.signOut);

  const tasks      = useTaskStore((s) => s.tasks);
  const history    = useTimerStore((s) => s.history);
  const setView    = useUIStore((s) => s.setView);
  const selectTask = useUIStore((s) => s.selectTask);

  const supabaseConfigured = !!getSupabaseBrowser();

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const flowHours = useMemo(() => {
    const totalMs = history.reduce((a, s) => a + s.duration_ms, 0);
    return totalMs / 3600000;
  }, [history]);

  const completed = useMemo(
    () => tasks.filter((t) => t.completed_at),
    [tasks],
  );

  const constellations = useMemo(() => {
    const sorted = [...tasks]
      .filter((t) => !t.completed_at)
      .sort((a, b) => weight(b.priority) - weight(a.priority));
    const top = sorted.slice(0, 3);
    const padded: Array<Task | null> = [...top];
    while (padded.length < 3) padded.push(null);
    return padded;
  }, [tasks]);

  // Real constellation — every completed task / earned star, projected onto
  // the centre column. We cap at 60 most recent so the field stays readable.
  const projectedStars = useMemo(() => {
    if (size.w === 0) return [];
    return stars.slice(-60).map((s) => ({
      star: s,
      task: tasks.find((t) => t.id === s.task_id) ?? null,
      // Map unit-sphere [x,y] into the column's pixel rect, with a margin
      // so stars don't crowd the portrait or the constellation chips.
      x: ((s.position[0] + 1) / 2) * size.w * 0.92 + size.w * 0.04,
      y: ((s.position[1] + 1) / 2) * size.h * 0.85 + size.h * 0.075,
    }));
  }, [stars, tasks, size]);

  const portraitCenter = { x: size.w / 2, y: size.h * 0.5 };

  const scatter = constellations.map((t, i) => {
    const positions = [
      { x: 0.32, y: 0.28 },
      { x: 0.30, y: 0.78 },
      { x: 0.74, y: 0.30 },
    ];
    return {
      pos: positions[i],
      color: t ? priorityColor(t.priority) : '#6a6357',
      label: t?.title ?? '—',
      task: t,
    };
  });

  const displayName = profile?.display_name ?? user?.email?.split('@')[0] ?? 'Stargazer';
  const avatarUrl   = profile?.avatar_url ?? null;
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(displayName);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraftName(displayName); }, [displayName]);

  const onPickAvatar = () => {
    if (!supabaseConfigured) return;
    fileInputRef.current?.click();
  };
  const onAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';                   // allow re-picking the same file
    if (!file) return;
    setUploadingAvatar(true);
    await uploadAvatar(file);
    setUploadingAvatar(false);
  };

  const onSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  return (
    <section className="relative h-full w-full overflow-y-auto px-4 pb-24 md:px-10 md:pb-10 no-scrollbar">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:min-h-[600px]">
        <div className="mt-6 flex flex-col gap-5 self-start md:col-span-3">
          <StatCard
            label="Flow state"
            value={flowHours < 10 ? flowHours.toFixed(1) : Math.round(flowHours).toLocaleString()}
            unit="hrs"
            subtitle="Deep immersion logged"
            icon="spark"
          />
          <StatCard
            label="Nodes cleared"
            value={completed.length.toLocaleString()}
            subtitle="Tasks crystallised"
            icon="check"
          />
          <StatCard
            label="Stars earned"
            value={stars.length.toLocaleString()}
            subtitle="Constellation points"
            icon="spark"
          />
        </div>

        <div ref={wrapRef} className="relative min-h-[360px] md:col-span-6">
          {size.w > 0 && (
            <>
              {/* Background field — every completed task as a literal star */}
              <StarField
                points={projectedStars}
                onPickTask={(taskId) => {
                  selectTask(taskId);
                  setView('vault');
                }}
              />

              {/* Connecting lines from portrait to the active "constellations" */}
              <svg className="pointer-events-none absolute inset-0" width={size.w} height={size.h}>
                {scatter.map((s, i) => (
                  <line
                    key={i}
                    x1={portraitCenter.x}
                    y1={portraitCenter.y}
                    x2={s.pos.x * size.w}
                    y2={s.pos.y * size.h}
                    stroke={s.color}
                    strokeOpacity={s.task ? 0.32 : 0.14}
                    strokeWidth="1"
                  />
                ))}
              </svg>

              {scatter.map((s, i) => (
                <div
                  key={i}
                  className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
                  style={{ left: s.pos.x * size.w, top: s.pos.y * size.h }}
                >
                  <span
                    className="block h-3 w-3 rounded-full"
                    style={{
                      background: s.color,
                      boxShadow: s.task ? `0 0 16px 2px ${s.color}88` : 'none',
                    }}
                  />
                  {s.task && (
                    <div className="mt-2 max-w-[140px] text-[11px] text-ink-mute">
                      {s.task.title}
                    </div>
                  )}
                </div>
              ))}

              <div
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: portraitCenter.x, top: portraitCenter.y }}
              >
                <div className="relative">
                  <button
                    type="button"
                    onClick={onPickAvatar}
                    disabled={!supabaseConfigured || uploadingAvatar}
                    aria-label={avatarUrl ? 'Change display photo' : 'Upload display photo'}
                    title={
                      !supabaseConfigured
                        ? ''
                        : avatarUrl
                        ? 'Click to change photo'
                        : 'Click to upload a photo'
                    }
                    className="group relative block h-[140px] w-[140px] overflow-hidden rounded-full ring-1 ring-amber/40 transition-transform hover:scale-[1.02] disabled:cursor-default disabled:hover:scale-100"
                    style={{
                      // Gradient fallback shows behind/around the avatar so the
                      // ring of light is preserved even with a transparent PNG.
                      background:
                        'radial-gradient(circle at 30% 25%, #ffd1a8 0%, #ff8a3d 30%, #5a1a04 80%)',
                      boxShadow:
                        '0 0 60px 8px rgba(255, 138, 61, 0.4), inset -10px -16px 30px rgba(0,0,0,0.45)',
                    }}
                  >
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={avatarUrl}
                        alt={displayName}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                    {/* Hover hint — only when supabase is wired up. */}
                    {supabaseConfigured && (
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber opacity-0 transition-opacity group-hover:opacity-100">
                        {uploadingAvatar
                          ? 'Uploading…'
                          : avatarUrl
                          ? 'Change'
                          : 'Add photo'}
                      </span>
                    )}
                  </button>
                  {avatarUrl && supabaseConfigured && !uploadingAvatar && (
                    <button
                      type="button"
                      onClick={removeAvatar}
                      aria-label="Remove display photo"
                      title="Remove photo"
                      className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full border border-line bg-bg/90 text-ink-faint backdrop-blur transition-colors hover:border-red-400/60 hover:text-red-400"
                    >
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
                        <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={onAvatarFile}
                    className="hidden"
                  />
                </div>
                <div className="mt-4 text-center">
                  {editingName ? (
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => {
                        updateDisplayName(draftName);
                        setEditingName(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          updateDisplayName(draftName);
                          setEditingName(false);
                        }
                        if (e.key === 'Escape') {
                          setDraftName(displayName);
                          setEditingName(false);
                        }
                      }}
                      className="w-[200px] rounded-lg bg-bg/80 px-2 py-1 text-center font-display text-2xl font-medium text-amber focus:outline-none focus:ring-1 focus:ring-amber/40"
                    />
                  ) : (
                    <button
                      onClick={() => supabaseConfigured && setEditingName(true)}
                      className="font-display text-2xl font-medium text-amber transition-opacity hover:opacity-80"
                      title={supabaseConfigured ? 'Click to rename' : ''}
                    >
                      {displayName}
                    </button>
                  )}
                  {user?.email && (
                    <div className="mt-1 text-xs text-ink-faint">{user.email}</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-4 self-start md:col-span-3">
          <div className="card p-6">
            <div className="eyebrow mb-4">Recent constellations</div>
            <ul className="space-y-3 border-b border-line/60 pb-5">
              {constellations.map((t, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      background: t ? priorityColor(t.priority) : '#6a6357',
                      boxShadow: t ? `0 0 10px 2px ${priorityColor(t.priority)}80` : 'none',
                    }}
                  />
                  <span
                    className={t ? 'text-[15px] text-ink' : 'text-[15px] italic text-ink-faint'}
                  >
                    {t?.title ?? 'No active streams'}
                  </span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setView('nexus')}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-line py-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-amber transition-colors hover:border-amber/30 hover:bg-amber/[0.05]"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M10 3.5v13M3.5 10h13" stroke="currentColor" strokeWidth="1.1" />
              </svg>
              Explore galaxy
            </button>
          </div>

          {/* Share my week — Instagram-story image based on the last 7 days
              of focus. Opens the generated image in a new tab so the user
              can save / share / repost. */}
          <ShareWeekButton />

          {supabaseConfigured && user && (
            <button
              onClick={onSignOut}
              className="card flex w-full items-center justify-center gap-2 p-4 text-sm text-ink-mute transition-colors hover:text-amber"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                <path d="M12 4H5v12h7M9 10h9M15.5 6.5L19 10l-3.5 3.5"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Sign out
            </button>
          )}
        </div>
      </div>

      <InsightsSection history={history} tasks={tasks} />

      <PreferencesCard />

      {/* Data & account — full-width at the bottom so users can always
          find Export + Delete. Right-rail placement was too easy to miss
          on tall layouts. */}
      {supabaseConfigured && user && (
        <div className="mt-8 mb-12">
          <DataAccountCard />
        </div>
      )}
    </section>
  );
}

/* ─────────────────────────────────────────── StarField */

interface StarPoint {
  star: { id: string; intensity: number; earned_at: string };
  task: Task | null;
  x: number;
  y: number;
}

function StarField({
  points, onPickTask,
}: {
  points: StarPoint[];
  onPickTask: (taskId: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  // Drift the field gently so the constellation feels alive but stays calm.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (t: number) => {
      setTick((t - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (points.length === 0) return null;

  return (
    <>
      {points.map((p, i) => {
        const isHovered = hovered === p.star.id;
        const twinkle =
          0.45 +
          0.55 * (0.5 + 0.5 * Math.sin(tick * (0.4 + p.star.intensity) + i));
        const baseColor = p.task
          ? p.task.priority === 'high'
            ? '#ffa564'
            : p.task.priority === 'medium'
            ? '#ffd1a8'
            : '#b8d4e3'
          : '#8a93a8';
        const radius = 2 + p.star.intensity * 1.5 + (isHovered ? 2 : 0);

        return (
          <button
            key={p.star.id}
            type="button"
            onMouseEnter={() => setHovered(p.star.id)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(p.star.id)}
            onBlur={() => setHovered(null)}
            onClick={() => p.task && onPickTask(p.task.id)}
            disabled={!p.task}
            aria-label={p.task ? `${p.task.title} — completed task` : 'Earned star'}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform disabled:cursor-default"
            style={{
              left: p.x,
              top: p.y,
              width: radius * 2,
              height: radius * 2,
              background: baseColor,
              boxShadow: `0 0 ${4 + p.star.intensity * 8}px ${baseColor}aa`,
              opacity: isHovered ? 1 : twinkle * (0.55 + p.star.intensity * 0.3),
              transform: `translate(-50%, -50%) scale(${isHovered ? 1.4 : 1})`,
            }}
          />
        );
      })}

      {/* Hover tooltip — placed once, follows the hovered star */}
      {hovered && (() => {
        const p = points.find((x) => x.star.id === hovered);
        if (!p) return null;
        return (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-amber/40 bg-bg-deep/90 px-3 py-1 text-xs text-amber backdrop-blur-md"
            style={{ left: p.x, top: p.y - 16 }}
          >
            {p.task ? p.task.title : 'Earned star'}
          </div>
        );
      })()}
    </>
  );
}

/* ─────────────────────────────────────────── insights section */

function InsightsSection({
  history, tasks,
}: { history: TimerSession[]; tasks: Task[] }) {
  // `now` lives post-mount so SSR + initial hydration agree.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000 * 5);
    return () => clearInterval(id);
  }, []);

  const profile = useUserStore((s) => s.profile);
  const updatePreferences = useUserStore((s) => s.updatePreferences);

  // Freeze is "available" iff the profile hasn't recorded one for this week.
  const freezeAvailable = useMemo(() => {
    if (!now) return false;
    const thisWeek = sharedMondayKey(now);
    return profile?.streak_freeze_used_week !== thisWeek;
  }, [profile?.streak_freeze_used_week, now]);

  const streak = useMemo(
    () => sharedComputeStreakFull(history, now, freezeAvailable),
    [history, now, freezeAvailable],
  );

  // Auto-burn the freeze the moment it's actually applied to the streak —
  // by the time computeStreak returned `freezeApplied: true` we've already
  // shown the user a streak that depends on the freeze, so we owe them
  // recording the consumption.
  useEffect(() => {
    if (!now) return;
    if (!streak.freezeApplied) return;
    const thisWeek = sharedMondayKey(now);
    if (profile?.streak_freeze_used_week === thisWeek) return;
    updatePreferences({ streak_freeze_used_week: thisWeek });
  }, [streak.freezeApplied, now, profile?.streak_freeze_used_week, updatePreferences]);

  const hourly = useMemo(() => hourHistogram(history), [history]);
  const top    = useMemo(() => topTasksByMinutes(history, tasks), [history, tasks]);

  return (
    <>
      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-12">
        <StreakCard
          streak={streak}
          history={history}
          now={now}
          freezeAvailable={freezeAvailable}
          freezeApplied={streak.freezeApplied}
        />
        <TimeOfDayCard hours={hourly} />
        <TopTasksCard items={top} />
      </div>

      {/* Phase 6 — richer analytics. Each subcard hides itself if there's
          no signal, so empty profiles stay quiet. */}
      <RichAnalytics tasks={tasks} history={history} />

      {/* Badges row — full width below the insights so the gallery has room
          to breathe. */}
      <div className="mt-6">
        <AchievementGallery />
      </div>
    </>
  );
}

function StreakCard({
  streak, history, now, freezeAvailable, freezeApplied,
}: {
  streak: { current: number; longest: number; thisWeek: number };
  history: TimerSession[];
  now: Date | null;
  freezeAvailable: boolean;
  freezeApplied: boolean;
}) {
  return (
    <div className="card p-7 md:col-span-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="eyebrow-amber">Streak</div>
        {/* Freeze chip — three states:
              • In use this week — small amber pill
              • Available     — neutral with snowflake glyph
              • Already spent  — faded                                  */}
        <span
          className={clsx(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]',
            freezeApplied
              ? 'border-amber/40 bg-amber/[0.10] text-amber'
              : freezeAvailable
              ? 'border-line text-ink-mute'
              : 'border-line/40 text-ink-faint',
          )}
          title={
            freezeApplied
              ? 'Freeze active — bridged a missed day this week.'
              : freezeAvailable
              ? 'Freeze available — one missed day this week is forgiven.'
              : 'Freeze spent for this week. Resets Monday.'
          }
        >
          <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none">
            <path d="M7 1v12M2 4l10 6M2 10l10-6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {freezeApplied ? 'In use' : freezeAvailable ? 'Freeze' : 'Spent'}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="amber-glow font-display text-5xl font-medium tabular-nums">
          {streak.current}
        </span>
        <span className="text-sm text-ink-mute">day{streak.current === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-3 text-xs text-ink-faint">
        {streak.current === 0
          ? 'A single block today starts a streak.'
          : streak.current >= 7
          ? 'Steady. Keep the thread.'
          : 'Hold the line.'}
      </div>

      {/* 5-week heatmap — gives a real visual continuity to the streak
          number above. Empty cells make missed days obvious without making
          them feel punitive. */}
      <div className="mt-5 border-t border-line/40 pt-4">
        <FocusHeatmap history={history} now={now} weeks={5} />
      </div>

      <div className="mt-4 border-t border-line/40 pt-3 text-sm">
        <div className="flex items-center justify-between text-ink-mute">
          <span>Longest</span>
          <span className="tabular-nums text-ink">
            {streak.longest} day{streak.longest === 1 ? '' : 's'}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between text-ink-mute">
          <span>This week</span>
          <span className="tabular-nums text-ink">
            {streak.thisWeek} / 7
          </span>
        </div>
      </div>
    </div>
  );
}

function TimeOfDayCard({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours);
  const peakHour = hours.indexOf(Math.max(...hours));
  const totalMin = hours.reduce((a, h) => a + h, 0);

  return (
    <div className="card p-7 md:col-span-8">
      <div className="mb-1 flex items-center justify-between">
        <div className="eyebrow">When you focus</div>
        {totalMin > 0 && (
          <div className="text-xs text-ink-faint">
            Peak · {String(peakHour).padStart(2, '0')}:00
          </div>
        )}
      </div>
      <p className="mb-4 text-xs text-ink-faint">
        Focus minutes by hour of day, all-time.
      </p>
      {totalMin === 0 ? (
        <div className="py-2">
          <EmptyState
            size="sm"
            title="No rhythm yet."
            body="Log a focus session — even five quiet minutes — and your peak hours will start to emerge here."
          />
        </div>
      ) : (
        <>
          <div className="flex h-20 items-end gap-[3px]">
            {hours.map((m, h) => {
              const pct = (m / max) * 100;
              const isPeak = h === peakHour && m > 0;
              return (
                <div
                  key={h}
                  className="flex flex-1 justify-center"
                  title={`${String(h).padStart(2, '0')}:00 · ${Math.round(m)}m`}
                >
                  <div
                    className={clsx(
                      'w-full rounded-sm transition-colors',
                      m === 0
                        ? 'bg-amber/[0.08]'
                        : isPeak
                        ? 'bg-amber shadow-[0_0_12px_rgba(255,138,61,0.35)]'
                        : 'bg-amber/45',
                    )}
                    style={{ height: `${Math.max(pct, m > 0 ? 6 : 2)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-ink-faint">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </div>
        </>
      )}
    </div>
  );
}

function TopTasksCard({
  items,
}: {
  items: Array<{ task: Task; minutes: number; sessions: number }>;
}) {
  return (
    <div className="card p-7 md:col-span-12">
      <div className="mb-1 flex items-center justify-between">
        <div className="eyebrow">Top streams by hours invested</div>
        <div className="text-xs text-ink-faint">All-time focus sessions</div>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 py-8 text-center text-sm text-ink-faint">
          Once you link focus sessions to tasks, your top streams will show here.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map(({ task, minutes, sessions }, i) => {
            const pct = (minutes / items[0].minutes) * 100;
            return (
              <li key={task.id} className="flex items-center gap-4">
                <span className="w-6 text-center font-display text-sm tabular-nums text-ink-faint">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span className="truncate text-[15px] text-ink">{task.title}</span>
                    <span className="shrink-0 text-xs text-ink-mute tabular-nums">
                      {fmtMinutes(minutes)} · {sessions} session{sessions === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="h-[3px] w-full overflow-hidden rounded-full bg-amber/[0.10]">
                    <div
                      className="h-full rounded-full bg-amber shadow-[0_0_10px_rgba(255,138,61,0.45)] transition-[width] duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────── insight derivations */

// Thin wrapper kept for the existing call site — the heavy lifting now
// lives in lib/insights.ts so Flow + Astral see the same numbers.
function computeStreak(
  history: TimerSession[],
  now: Date | null,
): { current: number; longest: number; thisWeek: number } {
  const s = sharedComputeStreak(history, now);
  return { current: s.current, longest: s.longest, thisWeek: s.thisWeek };
}

function hourHistogram(history: TimerSession[]): number[] {
  const buckets = new Array(24).fill(0) as number[];
  history
    .filter((s) => s.kind === 'focus')
    .forEach((s) => {
      const startedAt = new Date(s.started_at);
      let remaining = s.duration_ms / 60_000;
      let cursor = new Date(startedAt);
      // Distribute minutes across hours the session straddles.
      while (remaining > 0) {
        const hourEnd = new Date(cursor);
        hourEnd.setMinutes(60, 0, 0);
        const slice = Math.min(remaining, (hourEnd.getTime() - cursor.getTime()) / 60_000);
        if (slice <= 0) break;
        buckets[cursor.getHours()] += slice;
        remaining -= slice;
        cursor = hourEnd;
      }
    });
  return buckets;
}

function topTasksByMinutes(
  history: TimerSession[],
  tasks: Task[],
): Array<{ task: Task; minutes: number; sessions: number }> {
  const byTask: Record<string, { minutes: number; sessions: number }> = {};
  history
    .filter((s) => s.kind === 'focus' && s.task_id)
    .forEach((s) => {
      const id = s.task_id!;
      if (!byTask[id]) byTask[id] = { minutes: 0, sessions: 0 };
      byTask[id].minutes += s.duration_ms / 60_000;
      byTask[id].sessions++;
    });
  return Object.entries(byTask)
    .map(([id, stats]) => ({ task: tasks.find((t) => t.id === id), ...stats }))
    .filter((x): x is { task: Task; minutes: number; sessions: number } => !!x.task)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/* ─────────────────────────────────────────── preferences card */

function PreferencesCard() {
  const profile = useUserStore((s) => s.profile);
  const updatePreferences = useUserStore((s) => s.updatePreferences);

  const dailyGoalMin  = profile?.daily_goal_min  ?? DEFAULT_PREFERENCES.daily_goal_min;
  const weeklyGoalMin = profile?.weekly_goal_min ?? DEFAULT_PREFERENCES.weekly_goal_min;
  const dayStart      = profile?.day_start_hour  ?? DEFAULT_PREFERENCES.day_start_hour;
  const dayEnd        = profile?.day_end_hour    ?? DEFAULT_PREFERENCES.day_end_hour;
  const notifyFocus   = profile?.notify_focus_end ?? false;
  const notifyDue     = profile?.notify_due_reminders ?? false;
  const soundsOn      = profile?.sounds_enabled ?? false;
  const reducedMotion = profile?.reduced_motion ?? false;
  const quietOn       = profile?.quiet_hours_enabled ?? false;
  const quietStart    = profile?.quiet_hours_start ?? 22;
  const quietEnd      = profile?.quiet_hours_end   ?? 7;
  const focusMin      = profile?.focus_minutes      ?? DEFAULT_PREFERENCES.focus_minutes;
  const breakMin      = profile?.break_minutes      ?? DEFAULT_PREFERENCES.break_minutes;
  const longBreakMin  = profile?.long_break_minutes ?? DEFAULT_PREFERENCES.long_break_minutes;
  const longBreakEvery = profile?.long_break_every  ?? DEFAULT_PREFERENCES.long_break_every;

  const [dailyHrs,  setDailyHrs]  = useState(String(dailyGoalMin  / 60));
  const [weeklyHrs, setWeeklyHrs] = useState(String(weeklyGoalMin / 60));
  useEffect(() => { setDailyHrs(String(dailyGoalMin  / 60)); }, [dailyGoalMin]);
  useEffect(() => { setWeeklyHrs(String(weeklyGoalMin / 60)); }, [weeklyGoalMin]);

  const saveDaily = () => {
    const hrs = Number(dailyHrs);
    if (Number.isFinite(hrs) && hrs > 0 && hrs <= 16) {
      updatePreferences({ daily_goal_min: Math.round(hrs * 60) });
    } else {
      setDailyHrs(String(dailyGoalMin / 60));
    }
  };
  const saveWeekly = () => {
    const hrs = Number(weeklyHrs);
    if (Number.isFinite(hrs) && hrs > 0 && hrs <= 168) {
      updatePreferences({ weekly_goal_min: Math.round(hrs * 60) });
    } else {
      setWeeklyHrs(String(weeklyGoalMin / 60));
    }
  };

  return (
    <div className="mt-8 mb-2">
      <div className="card p-7">
        <div className="mb-1 eyebrow-amber">Preferences</div>
        <p className="mb-6 text-sm text-ink-mute">
          Tune your daily rhythm. Changes save automatically.
        </p>

        <div className="grid grid-cols-12 gap-6">
          {/* Goals */}
          <div className="col-span-12 md:col-span-6">
            <div className="eyebrow mb-3">Goals</div>
            <div className="space-y-3">
              <FieldRow label="Daily focus">
                <NumberField
                  value={dailyHrs}
                  onChange={setDailyHrs}
                  onCommit={saveDaily}
                  unit="hours"
                  step="0.5"
                  min="0.5"
                  max="16"
                />
              </FieldRow>
              <FieldRow label="Weekly focus">
                <NumberField
                  value={weeklyHrs}
                  onChange={setWeeklyHrs}
                  onCommit={saveWeekly}
                  unit="hours"
                  step="1"
                  min="1"
                  max="168"
                />
              </FieldRow>
            </div>
          </div>

          {/* Day window */}
          <div className="col-span-12 md:col-span-6">
            <div className="eyebrow mb-3">Day window</div>
            <div className="space-y-3">
              <FieldRow label="Day starts">
                <HourSelect
                  value={dayStart}
                  onChange={(h) => updatePreferences({ day_start_hour: h })}
                  max={Math.max(0, dayEnd - 1)}
                  min={0}
                />
              </FieldRow>
              <FieldRow label="Day ends">
                <HourSelect
                  value={dayEnd}
                  onChange={(h) => updatePreferences({ day_end_hour: h })}
                  min={dayStart + 1}
                  max={24}
                />
              </FieldRow>
            </div>
          </div>

          {/* Focus loop — Pomodoro defaults. */}
          <div className="col-span-12 mt-2">
            <div className="eyebrow mb-3">Focus loop</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FieldRow label="Focus block">
                <MinuteSelect
                  value={focusMin}
                  onChange={(m) => updatePreferences({ focus_minutes: m })}
                  options={[15, 20, 25, 30, 45, 50, 60, 75, 90, 120]}
                />
              </FieldRow>
              <FieldRow label="Short break">
                <MinuteSelect
                  value={breakMin}
                  onChange={(m) => updatePreferences({ break_minutes: m })}
                  options={[3, 5, 7, 10, 15]}
                />
              </FieldRow>
              <FieldRow label="Long break">
                <MinuteSelect
                  value={longBreakMin}
                  onChange={(m) => updatePreferences({ long_break_minutes: m })}
                  options={[10, 15, 20, 25, 30]}
                />
              </FieldRow>
              <FieldRow label="Long break every">
                <select
                  value={longBreakEvery}
                  onChange={(e) =>
                    updatePreferences({ long_break_every: Number(e.target.value) })
                  }
                  className="w-32 rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm text-ink focus:border-amber/40 focus:outline-none"
                >
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} blocks
                    </option>
                  ))}
                </select>
              </FieldRow>
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">
              After every {longBreakEvery} focus block{longBreakEvery === 1 ? '' : 's'}, the next break is a long one.
            </p>
          </div>

          {/* Appearance — accent variant */}
          <div className="col-span-12 mt-2">
            <div className="eyebrow mb-3">Appearance</div>
            <AccentPicker
              value={(profile?.accent ?? 'amber') as 'amber' | 'violet' | 'aurora'}
              onChange={(v) => updatePreferences({ accent: v })}
            />
          </div>

          {/* Public profile — opt-in shareable card */}
          <div className="col-span-12 mt-2">
            <div className="eyebrow mb-3">Public profile</div>
            <PublicProfilePanel
              slug={profile?.public_slug ?? null}
              enabled={profile?.public_enabled ?? false}
              onSave={(slug, enabled) => updatePreferences({
                public_slug: slug || null,
                public_enabled: enabled,
              })}
            />
          </div>

          {/* Notifications */}
          <div className="col-span-12 mt-2">
            <div className="eyebrow mb-3">Notifications</div>
            <div className="space-y-3">
              <ToggleRow
                label="Focus session complete"
                description="Get a browser notification when a focus block reaches its target."
                checked={notifyFocus}
                onChange={(v) => updatePreferences({ notify_focus_end: v })}
              />
              <ToggleRow
                label="Due-date reminders"
                description="Get pinged when a task with a due date is coming up."
                checked={notifyDue}
                onChange={(v) => updatePreferences({ notify_due_reminders: v })}
              />
              <ToggleRow
                label="Sounds"
                description="A soft chime on focus complete and a tick when you check off a subtask."
                checked={soundsOn}
                onChange={(v) => updatePreferences({ sounds_enabled: v })}
              />
              <ToggleRow
                label="Reduced motion"
                description="Dampens animations app-wide, regardless of your OS setting."
                checked={reducedMotion}
                onChange={(v) => updatePreferences({ reduced_motion: v })}
              />
              <ToggleRow
                label="Quiet hours"
                description={
                  quietOn
                    ? `Silenced ${String(quietStart).padStart(2,'0')}:00 → ${String(quietEnd).padStart(2,'0')}:00.`
                    : 'Block notifications during your wind-down window.'
                }
                checked={quietOn}
                onChange={(v) => updatePreferences({ quiet_hours_enabled: v })}
              />
              {quietOn && (
                <div className="ml-2 grid grid-cols-2 gap-3 pl-2 pt-1 sm:max-w-md">
                  <FieldRow label="Start">
                    <HourSelect
                      value={quietStart}
                      onChange={(h) => updatePreferences({ quiet_hours_start: h })}
                    />
                  </FieldRow>
                  <FieldRow label="End">
                    <HourSelect
                      value={quietEnd}
                      onChange={(h) => updatePreferences({ quiet_hours_end: h })}
                    />
                  </FieldRow>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-ink-mute">{label}</span>
      {children}
    </div>
  );
}

function NumberField({
  value, onChange, onCommit, unit, step, min, max,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  unit: string;
  step?: string;
  min?: string;
  max?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-24 rounded-lg border border-line bg-bg/60 px-3 py-2 text-right text-sm tabular-nums text-ink focus:border-amber/40 focus:outline-none transition-colors"
      />
      <span className="text-xs text-ink-faint">{unit}</span>
    </div>
  );
}

// Three-swatch radio for the visual accent. Each swatch previews the actual
// accent color so the user sees what they're picking.
function AccentPicker({
  value, onChange,
}: {
  value: 'amber' | 'violet' | 'aurora';
  onChange: (v: 'amber' | 'violet' | 'aurora') => void;
}) {
  const swatches: Array<{
    id: 'amber' | 'violet' | 'aurora';
    label: string;
    rgb: string;
  }> = [
    { id: 'amber',  label: 'Amber',  rgb: 'rgb(255 138 61)' },
    { id: 'violet', label: 'Violet', rgb: 'rgb(183 122 255)' },
    { id: 'aurora', label: 'Aurora', rgb: 'rgb(90 230 180)' },
  ];
  return (
    <div className="flex flex-wrap gap-3">
      {swatches.map((s) => {
        const active = s.id === value;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s.id)}
            aria-pressed={active}
            className={clsx(
              'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
              active ? 'border-line-strong bg-amber/[0.06]' : 'border-line text-ink-mute hover:text-ink',
            )}
          >
            <span
              className="h-5 w-5 rounded-full ring-1 ring-white/15"
              style={{
                background: `radial-gradient(circle at 30% 25%, ${s.rgb}, ${s.rgb})`,
                boxShadow: `0 0 14px -4px ${s.rgb}`,
              }}
            />
            <span className={clsx(active && 'text-ink')}>{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Public-profile opt-in card. Lets the user choose a slug and toggle the
// page on/off. The slug input is debounced via local state so the save
// only fires when the user blurs / hits Enter.
function PublicProfilePanel({
  slug, enabled, onSave,
}: {
  slug: string | null;
  enabled: boolean;
  onSave: (slug: string, enabled: boolean) => void;
}) {
  const [draft, setDraft] = useState(slug ?? '');
  useEffect(() => setDraft(slug ?? ''), [slug]);

  // Slug must be URL-safe; we coerce silently as the user types.
  const cleaned = draft.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const url = typeof window !== 'undefined' && cleaned
    ? `${window.location.origin}/u/${cleaned}`
    : null;

  return (
    <div className="space-y-3">
      <ToggleRow
        label="Enable a shareable profile page"
        description={
          enabled
            ? 'Your last-30-days focus stats are visible to anyone with the link.'
            : 'Off — your profile is private.'
        }
        checked={enabled}
        onChange={(v) => onSave(cleaned, v)}
      />
      {enabled && (
        <>
          <FieldRow label="Slug">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => onSave(cleaned, true)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSave(cleaned, true); }}
              placeholder="your-handle"
              className="w-48 rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm text-ink focus:border-amber/40 focus:outline-none"
            />
          </FieldRow>
          {url && (
            <div className="flex items-center gap-2 text-xs text-ink-faint">
              <span>Your URL:</span>
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-amber underline-offset-2 hover:underline"
              >
                {url}
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Data & account — JSON export + account deletion. Two-step destructive
// flow on delete (button → confirm dialog) so it can't fire from a stray
// tap. Export streams the JSON straight to a download.
function DataAccountCard() {
  const router = useRouter();
  const exportAccountData = useUserStore((s) => s.exportAccountData);
  const deleteAccount     = useUserStore((s) => s.deleteAccount);
  const profile           = useUserStore((s) => s.profile);

  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const onExport = async () => {
    setBusy('export');
    try {
      const data = await exportAccountData();
      if (!data) {
        toastError('Couldn’t prepare export.');
        return;
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const name = (profile?.display_name ?? 'verge').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}-verge-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toastSuccess('Account data exported.');
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    if (confirmText.trim().toUpperCase() !== 'DELETE') {
      toastError('Type DELETE to confirm.');
      return;
    }
    setBusy('delete');
    try {
      const ok = await deleteAccount();
      if (ok) {
        toastInfo('Your account and all data have been permanently deleted.');
        router.push('/login');
      } else {
        // Server may have partially succeeded (data wiped, auth row stuck).
        // Send the user to /login anyway — their session is gone either way.
        toastError('Deletion completed with errors. Please contact support if anything looks off.');
        router.push('/login');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card p-7">
      <div className="mb-1 eyebrow-amber">Data &amp; account</div>
      <p className="mb-6 text-sm text-ink-mute">
        Take everything with you, or remove it from the cloud. Both actions
        are immediate — deletion cannot be undone.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* ── Export ──────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-line bg-bg/40 p-5">
          <div className="mb-2 flex items-center gap-2">
            <svg viewBox="0 0 20 20" className="h-4 w-4 text-amber" fill="none">
              <path d="M10 3v10M5.5 8.5L10 13l4.5-4.5M4 17h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h3 className="text-sm font-semibold text-ink">Export my data</h3>
          </div>
          <p className="mb-4 text-xs text-ink-faint">
            Downloads every task, event, focus session, achievement and
            preference tied to your account as a JSON file.
          </p>
          <button
            onClick={onExport}
            disabled={busy !== null}
            className="w-full rounded-xl border border-amber/40 bg-amber/[0.08] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-amber transition-colors hover:bg-amber/[0.14] disabled:opacity-40"
          >
            {busy === 'export' ? 'Preparing…' : 'Download JSON'}
          </button>
        </div>

        {/* ── Delete ──────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-red-500/30 bg-red-500/[0.04] p-5">
          <div className="mb-2 flex items-center gap-2">
            <svg viewBox="0 0 20 20" className="h-4 w-4 text-red-400" fill="none">
              <path d="M5 6h10M8 6V4h4v2M6 6l1 11h6l1-11M9 9v5M11 9v5"
                stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h3 className="text-sm font-semibold text-red-300">Delete account</h3>
          </div>
          <p className="mb-4 text-xs text-ink-faint">
            Permanently removes your tasks, focus history, achievements,
            stars, and login credentials from the cloud.
          </p>

          {!confirming ? (
            <button
              onClick={() => { setConfirming(true); setConfirmText(''); }}
              disabled={busy !== null}
              className="w-full rounded-xl border border-red-500/40 bg-red-500/[0.10] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-red-300 transition-colors hover:bg-red-500/[0.18] disabled:opacity-40"
            >
              Delete my account
            </button>
          ) : (
            <div className="rounded-md border border-red-500/40 bg-red-500/[0.08] p-3">
              <p className="text-[11px] text-ink-mute">
                Type <span className="font-semibold text-red-400">DELETE</span> to confirm.
              </p>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                className="mt-2 w-full rounded-md border border-line bg-bg/60 px-2 py-1 text-center text-xs text-ink focus:border-red-400/50 focus:outline-none"
                autoFocus
              />
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  onClick={() => { setConfirming(false); setConfirmText(''); }}
                  disabled={busy !== null}
                  className="text-[11px] uppercase tracking-[0.14em] text-ink-faint hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  onClick={onDelete}
                  disabled={busy !== null || confirmText.trim().toUpperCase() !== 'DELETE'}
                  className="rounded-md border border-red-500/40 bg-red-500/[0.18] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-red-300 hover:bg-red-500/[0.28] disabled:opacity-40"
                >
                  {busy === 'delete' ? 'Deleting…' : 'Delete forever'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer — privacy / terms anchored in the same panel users go to for
          export & delete. Lower-key tracking-uppercase to match other meta. */}
      <div className="mt-5 flex items-center justify-center gap-3 border-t border-line pt-4 text-[10px] uppercase tracking-[0.16em] text-ink-faint">
        <a href="/privacy" className="hover:text-amber transition-colors">Privacy</a>
        <span aria-hidden className="opacity-40">·</span>
        <a href="/terms" className="hover:text-amber transition-colors">Terms</a>
      </div>
    </div>
  );
}

// Computes the past-7-day stats live (focus hours, completed count, current
// streak) and opens the share-week image generator in a new tab. Pure
// client — the route is stateless, all stats come from query params.
function ShareWeekButton() {
  const tasks   = useTaskStore((s) => s.tasks);
  const history = useTimerStore((s) => s.history);
  const profile = useUserStore((s) => s.profile);
  const user    = useUserStore((s) => s.user);

  const onShare = () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    const focusMs = history
      .filter((s) => s.kind === 'focus' && new Date(s.started_at) >= sevenDaysAgo)
      .reduce((a, s) => a + s.duration_ms, 0);
    const doneCount = tasks.filter(
      (t) => t.completed_at && new Date(t.completed_at) >= sevenDaysAgo,
    ).length;
    const streak = sharedComputeStreak(history, now).current;

    const name = (profile?.display_name ?? user?.email?.split('@')[0] ?? 'Stargazer')
      .slice(0, 40);
    const accentHex = (() => {
      const a = profile?.accent ?? 'amber';
      if (a === 'violet') return 'b77aff';
      if (a === 'aurora') return '5ae6b4';
      return 'ff8a3d';
    })();

    const params = new URLSearchParams({
      name,
      hours: (focusMs / 3_600_000).toFixed(1),
      done: String(doneCount),
      streak: String(streak),
      accent: accentHex,
    });
    window.open(`/api/share-week?${params.toString()}`, '_blank');
  };

  return (
    <button
      onClick={onShare}
      className="card flex w-full items-center justify-center gap-2 p-4 text-sm text-ink-mute transition-colors hover:text-amber"
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none">
        <path
          d="M14 6a2 2 0 1 0-2-2M14 14a2 2 0 1 1-2 2M8 12a2 2 0 1 1-2 2M8 8a2 2 0 1 0-2-2M7.5 11l5 3M12.5 5l-5 4"
          stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
      Share my week
    </button>
  );
}

function MinuteSelect({
  value, onChange, options,
}: {
  value: number;
  onChange: (m: number) => void;
  options: number[];
}) {
  // If the persisted value isn't in the offered list, surface it anyway so
  // the user doesn't see their setting vanish.
  const choices = options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-32 appearance-none rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm text-ink focus:border-amber/40 focus:outline-none transition-colors"
    >
      {choices.map((m) => (
        <option key={m} value={m}>
          {m} min
        </option>
      ))}
    </select>
  );
}

function HourSelect({
  value, onChange, min = 0, max = 24,
}: {
  value: number;
  onChange: (h: number) => void;
  min?: number;
  max?: number;
}) {
  const opts: number[] = [];
  for (let h = min; h <= max; h++) opts.push(h);
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-32 appearance-none rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm text-ink focus:border-amber/40 focus:outline-none transition-colors"
    >
      {opts.map((h) => (
        <option key={h} value={h}>
          {String(h).padStart(2, '0')}:00
        </option>
      ))}
    </select>
  );
}

function ToggleRow({
  label, description, checked, onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink">{label}</div>
        <div className="text-xs text-ink-faint">{description}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors ' +
          (checked
            ? 'border-amber/50 bg-amber/[0.30]'
            : 'border-line bg-bg/60')
        }
        aria-pressed={checked}
        aria-label={label}
      >
        <span
          className={
            'absolute top-[2px] h-[18px] w-[18px] rounded-full transition-all ' +
            (checked
              ? 'left-[22px] bg-amber shadow-[0_0_10px_rgba(255,138,61,0.5)]'
              : 'left-[2px] bg-ink-mute')
          }
        />
      </button>
    </div>
  );
}

function StatCard({
  label, value, unit, subtitle, icon,
}: {
  label: string;
  value: string;
  unit?: string;
  subtitle: string;
  icon: 'check' | 'spark';
}) {
  return (
    <div className="card p-6">
      <div className="flex items-center gap-2">
        {icon === 'check' ? (
          <svg viewBox="0 0 20 20" className="h-4 w-4 text-amber" fill="none">
            <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M7 10.4l2 2 4-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" className="h-4 w-4 text-amber" fill="none">
            <path d="M10 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        )}
        <div className="eyebrow-amber">{label}</div>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-display text-4xl font-medium tabular-nums text-ink">{value}</span>
        {unit && <span className="text-sm text-ink-mute">{unit}</span>}
      </div>
      <div className="mt-1 text-sm text-ink-mute">{subtitle}</div>
    </div>
  );
}

function priorityColor(p: 'low' | 'medium' | 'high') {
  return p === 'high' ? '#ff7a18' : p === 'medium' ? '#ffa564' : '#b8d4e3';
}
function weight(p: 'low' | 'medium' | 'high') {
  return p === 'high' ? 3 : p === 'medium' ? 2 : 1;
}
