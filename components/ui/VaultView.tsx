'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useTaskStore } from '@/stores/useTaskStore';
import { useTimerStore } from '@/stores/useTimerStore';
import { useUIStore } from '@/stores/useUIStore';
import type { Task, TimerSession } from '@/lib/types';
import { dateToYMD, isSameDay, mondayOf } from '@/lib/dates';
import { tagColor } from '@/lib/colors';
import { toastInfo, toastSuccess } from '@/stores/useToastStore';
import PullToRefresh from '@/components/ui/PullToRefresh';
import EmptyState from '@/components/ui/EmptyState';

// Vault — the archive. Crystallised tasks grouped by week of completion,
// searchable via the global header bar, with a CSV export for each visible
// slice.

export default function VaultView() {
  const tasks   = useTaskStore((s) => s.tasks);
  const restore = useTaskStore((s) => s.restore);
  const reloadTasks = useTaskStore((s) => s.load);
  const history = useTimerStore((s) => s.history);
  const reloadHistory = useTimerStore((s) => s.loadHistory);
  const search  = useUIStore((s) => s.search);

  const onRestore = async (t: Task) => {
    await restore(t.id);
    toastInfo(`Brought "${t.title}" back to Nexus.`);
  };

  // Pull-to-refresh — reload completed tasks + history. Lightweight: both
  // stores already de-dupe identical state via reference equality.
  const onPullRefresh = async () => {
    await Promise.all([reloadTasks(), reloadHistory()]);
  };

  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000 * 5);
    return () => clearInterval(id);
  }, []);

  const q = search.trim().toLowerCase();

  // All completed tasks, search-filtered + sorted newest first.
  const completed = useMemo(() => {
    return tasks
      .filter((t) => t.completed_at)
      .filter((t) => !q || t.title.toLowerCase().includes(q) || (t.tags ?? []).some((x) => x.includes(q)))
      .sort(
        (a, b) =>
          new Date(b.completed_at ?? 0).getTime() -
          new Date(a.completed_at ?? 0).getTime(),
      );
  }, [tasks, q]);

  // Group by ISO week of completion, with labels: This week / Last week /
  // explicit date range.
  const groups = useMemo<Array<{ key: string; label: string; tasks: Task[] }>>(() => {
    if (!now) {
      // Pre-mount stable bucket — single "Recent" group keeps SSR matching.
      return [{ key: 'recent', label: 'Recent', tasks: completed }];
    }
    const todayMonday = mondayOf(now);
    const lastMonday = new Date(todayMonday);
    lastMonday.setDate(todayMonday.getDate() - 7);

    const map = new Map<
      string,
      { key: string; label: string; tasks: Task[]; weekStart: Date }
    >();
    completed.forEach((t) => {
      const d = new Date(t.completed_at!);
      const monday = mondayOf(d);
      const key = dateToYMD(monday);
      if (!map.has(key)) {
        let label: string;
        if (isSameDay(monday, todayMonday)) label = 'This week';
        else if (isSameDay(monday, lastMonday)) label = 'Last week';
        else {
          const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
          label = `${monday.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} — ${sunday.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
        }
        map.set(key, { key, label, tasks: [], weekStart: monday });
      }
      map.get(key)!.tasks.push(t);
    });
    return [...map.values()]
      .sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime())
      .map(({ key, label, tasks }) => ({ key, label, tasks }));
  }, [completed, now]);

  const totalFocusMs = history.reduce((a, s) => a + s.duration_ms, 0);

  const onExport = () => {
    exportCsv(completed, history);
    toastSuccess(`Exported ${completed.length} task${completed.length === 1 ? '' : 's'} to CSV.`);
  };

  return (
    <PullToRefresh
      onRefresh={onPullRefresh}
      className="relative h-full w-full overflow-y-auto px-4 pb-24 md:px-10 md:pb-10 no-scrollbar"
    >
    <section className="relative w-full">
      <div className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow-amber">Vault</div>
          <h1 className="mt-2 font-display text-3xl font-light text-ink">
            Everything crystallised.
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Tile label="Archived"     value={completed.length.toString()} />
          <Tile label="Focus logged" value={fmtHrs(totalFocusMs)} />
          <button
            onClick={onExport}
            disabled={completed.length === 0}
            className="btn-ghost disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="inline-flex items-center gap-1.5">
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
                <path d="M10 3v10M5.5 8.5L10 13l4.5-4.5M4 17h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Export CSV
            </span>
          </button>
        </div>
      </div>

      {/* Search hint when the global query is active. */}
      {q && (
        <div className="mb-4 text-xs text-ink-faint">
          Matching <span className="text-amber">&quot;{q}&quot;</span> · {completed.length} result{completed.length === 1 ? '' : 's'}
        </div>
      )}

      {completed.length === 0 ? (
        q ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-ink-faint">
            No completed tasks match that search.
          </div>
        ) : (
          <EmptyState
            title="The vault is dark."
            body="Every task you complete in Nexus gets crystallised here, grouped by week. Mark something done to plant your first star."
            action={
              <button
                onClick={() => useUIStore.getState().setView('nexus')}
                className="btn-amber px-5 py-2 text-[11px] uppercase tracking-[0.16em]"
              >
                Go to Nexus
              </button>
            }
          />
        )
      ) : (
        groups.map((g) => (
          <Group
            key={g.key}
            label={g.label}
            tasks={g.tasks}
            history={history}
            onRestore={onRestore}
          />
        ))
      )}
    </section>
    </PullToRefresh>
  );
}

/* ─────────────────────────────────────────── group section */

function Group({
  label, tasks, history, onRestore,
}: {
  label: string;
  tasks: Task[];
  history: TimerSession[];
  onRestore: (t: Task) => void;
}) {
  const groupMin = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.id));
    return (
      history
        .filter((s) => s.task_id && ids.has(s.task_id))
        .reduce((a, s) => a + s.duration_ms, 0) / 60_000
    );
  }, [tasks, history]);

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="eyebrow-amber">{label}</h2>
        <div className="text-xs text-ink-faint">
          {tasks.length} task{tasks.length === 1 ? '' : 's'}
          {groupMin > 0 && (
            <span> · {fmtMin(groupMin)} focused</span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tasks.map((t) => (
          <Card key={t.id} task={t} onRestore={onRestore} />
        ))}
      </div>
    </div>
  );
}

function Card({ task, onRestore }: { task: Task; onRestore: (t: Task) => void }) {
  return (
    <div className="card card-hover group relative p-5">
      <div className="flex items-center gap-2">
        <span
          className={clsx(
            'h-2 w-2 rounded-full',
            task.priority === 'high'   ? 'bg-amber' :
            task.priority === 'medium' ? 'bg-amber-soft' : 'bg-lunar',
          )}
        />
        <span className="eyebrow capitalize">{task.priority}</span>
      </div>
      <div className="mt-3 text-[15px] text-ink">{task.title}</div>
      {(task.tags ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {(task.tags ?? []).slice(0, 4).map((t) => (
            <span
              key={t}
              className="rounded-full px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.08em]"
              style={{ background: `${tagColor(t)}1c`, color: tagColor(t) }}
            >
              #{t}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 text-xs text-ink-faint" suppressHydrationWarning>
        {task.completed_at && new Date(task.completed_at).toLocaleString()}
      </div>
      {/* Hover-only restore — keeps the card visually clean by default but
          gives the user a one-click way to bring a wrongly-checked task back
          to Nexus. */}
      <button
        type="button"
        onClick={() => onRestore(task)}
        title="Restore to Nexus"
        aria-label={`Restore "${task.title}" to Nexus`}
        className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-bg/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-mute opacity-0 backdrop-blur transition-all hover:border-amber/40 hover:text-amber group-hover:opacity-100 focus:opacity-100"
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none">
          <path d="M3 8a5 5 0 1 1 1.46 3.54M3 12V8h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Restore
      </button>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-5 py-3">
      <div className="eyebrow text-[10px]">{label}</div>
      <div className="font-display text-2xl font-medium tabular-nums text-ink">{value}</div>
    </div>
  );
}

/* ─────────────────────────────────────────── helpers */

function fmtHrs(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)}m`;
  return `${h.toFixed(1)}h`;
}

function fmtMin(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function exportCsv(tasks: Task[], history: TimerSession[]): void {
  const sessionsByTask: Record<string, { count: number; minutes: number }> = {};
  history.forEach((s) => {
    if (!s.task_id) return;
    if (!sessionsByTask[s.task_id]) {
      sessionsByTask[s.task_id] = { count: 0, minutes: 0 };
    }
    sessionsByTask[s.task_id].count++;
    sessionsByTask[s.task_id].minutes += s.duration_ms / 60_000;
  });

  const header = [
    'Title', 'Priority', 'Completed At', 'Tags', 'Notes',
    'Focus Sessions', 'Focus Minutes',
  ];
  const rows = tasks.map((t) => {
    const stats = sessionsByTask[t.id] ?? { count: 0, minutes: 0 };
    return [
      t.title,
      t.priority,
      t.completed_at ?? '',
      (t.tags ?? []).join(';'),
      (t.notes ?? '').replace(/\r?\n/g, ' '),
      String(stats.count),
      stats.minutes.toFixed(1),
    ];
  });

  const csv = [header, ...rows]
    .map((r) => r.map(escapeCsv).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `verge-vault-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeCsv(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
