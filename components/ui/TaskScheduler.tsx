'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTaskStore } from '@/stores/useTaskStore';
import { useUIStore } from '@/stores/useUIStore';
import { useTimerStore } from '@/stores/useTimerStore';
import { useUserStore } from '@/stores/useUserStore';
import {
  useSubtaskStore,
  subtasksForTask,
  subtaskProgress,
} from '@/stores/useSubtaskStore';
import { tagColor } from '@/lib/colors';
import { parseYMD, startOfDay } from '@/lib/dates';
import RepeatPicker from '@/components/ui/RepeatPicker';
import EmptyState from '@/components/ui/EmptyState';
import {
  sparkBurst,
  shouldFireDailyConfetti,
  markDailyConfettiFired,
  shouldFireFirstTaskCelebration,
  markFirstTaskCelebrationFired,
} from '@/lib/spark';
import { toastSuccess } from '@/stores/useToastStore';
import { playTick } from '@/lib/sounds';
import { useLongPress } from '@/lib/useLongPress';
import type { Priority, Subtask, Task, TimerSession } from '@/lib/types';

// Nexus — task view.
//
//   Left rail
//     • Daily Resonance — today's completion ratio (only what was finished
//       today against today's open + finished load). Reflects actual daily
//       progress instead of all-time completion.
//     • Active Streams — filter chips + search + scrollable list. Filters:
//       Open, High, Due, Done, All. Search matches title.
//
//   Centre  — empty for the R3F TimeSpine behind the HUD.
//
//   Right rail (DetailCard) — the selected task:
//     • Priority pill + "..." menu (Mark complete · Delete)
//     • Inline-editable title (click to edit)
//     • Inline-editable notes (click to edit)
//     • Due-date picker with relative label
//     • Time invested + session count + last 3 sessions
//     • Energy required pips
//     • Initiate Focus State CTA

const PRIORITY_NAME: Record<Priority, string> = {
  high:   'Priority Alpha',
  medium: 'Priority Beta',
  low:    'Priority Gamma',
};
const PRIORITY_DOT: Record<Priority, string> = {
  high:   'bg-amber',
  medium: 'bg-amber-soft',
  low:    'bg-lunar',
};
const PRIORITY_PIPS: Record<Priority, number> = { high: 3, medium: 2, low: 1 };

type FilterId = 'open' | 'high' | 'due' | 'done' | 'all';
const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'high', label: 'High' },
  { id: 'due',  label: 'Due' },
  { id: 'done', label: 'Done' },
  { id: 'all',  label: 'All' },
];

const DUE_SOON_DAYS = 7;

export default function TaskScheduler() {
  const tasks    = useTaskStore((s) => s.tasks);
  const add      = useTaskStore((s) => s.add);
  const complete = useTaskStore((s) => s.complete);
  const remove   = useTaskStore((s) => s.remove);
  const update   = useTaskStore((s) => s.update);
  const snooze   = useTaskStore((s) => s.snooze);
  const reorder  = useTaskStore((s) => s.reorder);

  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const selectTask     = useUIStore((s) => s.selectTask);
  const setFocus       = useUIStore((s) => s.setFocus);

  const timerStart  = useTimerStore((s) => s.start);
  const setMode     = useTimerStore((s) => s.setMode);
  const setTarget   = useTimerStore((s) => s.setTarget);
  const resetTimer  = useTimerStore((s) => s.reset);
  const history     = useTimerStore((s) => s.history);

  const awardStar = useUserStore((s) => s.awardStar);

  // `now` is populated post-mount so SSR + initial hydration produce the
  // same HTML, then re-ticks every minute so relative labels stay fresh.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [filter, setFilter] = useState<FilterId>('open');
  // Promoted to the global UI store so the header search + Cmd-K style
  // future actions can drive Nexus too.
  const search    = useUIStore((s) => s.search);
  const setSearch = useUIStore((s) => s.setSearch);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  // Multi-select: Shift-click extends a range from the anchor (last
  // single-clicked row). Cmd/Ctrl-click toggles a single id. Selection is
  // visual on top of the existing detail panel — the detail still shows
  // whatever was last "anchor" clicked.
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(() => new Set());
  const lastAnchorRef = useRef<string | null>(null);

  // "New task" keyboard shortcut (HUD dispatches this when 'n' is pressed
  // outside an input field). Opens the compose form.
  useEffect(() => {
    const onNew = () => setComposeOpen(true);
    window.addEventListener('verge:new-task', onNew);
    return () => window.removeEventListener('verge:new-task', onNew);
  }, []);

  /* ───────────────────────────────────────────── available tags */

  const allTags = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => (t.tags ?? []).forEach((tag) => set.add(tag)));
    return [...set].sort();
  }, [tasks]);

  // If the active tag disappears (all tasks bearing it were deleted), clear.
  useEffect(() => {
    if (activeTag && !allTags.includes(activeTag)) setActiveTag(null);
  }, [activeTag, allTags]);

  /* ───────────────────────────────────────────── filtered list */

  const filteredTasks = useMemo(() => {
    let r = tasks;
    // Snoozed tasks hide from "open" / "high" / "due" until their snooze
    // moment passes. They still appear under "done" once completed and in
    // tag-only views (so the user can find them by tag).
    const isSnoozed = (t: Task) =>
      t.snooze_until && now && new Date(t.snooze_until) > now;
    if (filter === 'open') r = r.filter((t) => !t.completed_at && !isSnoozed(t));
    if (filter === 'high') r = r.filter((t) => !t.completed_at && !isSnoozed(t) && t.priority === 'high');
    if (filter === 'due')  r = r.filter((t) => !t.completed_at && !isSnoozed(t) && t.due_at && (!now || isDueSoon(t.due_at, now)));
    if (filter === 'done') r = r.filter((t) => !!t.completed_at);

    if (activeTag) r = r.filter((t) => (t.tags ?? []).includes(activeTag));

    const q = search.trim().toLowerCase();
    if (q) r = r.filter((t) => t.title.toLowerCase().includes(q));

    return [...r].sort((a, b) => {
      // Completed last.
      if (!!a.completed_at !== !!b.completed_at) return a.completed_at ? 1 : -1;
      // Manual position wins when both have it (drag-to-reorder).
      const ap = a.position ?? null;
      const bp = b.position ?? null;
      if (ap !== null && bp !== null && ap !== bp) return ap - bp;
      // Fall back to priority desc, then most recent first.
      const w = weight(b.priority) - weight(a.priority);
      if (w !== 0) return w;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [tasks, filter, search, now, activeTag]);

  /* ───────────────────────────────────────────── selection */

  // Keep selection valid as the filtered list changes.
  useEffect(() => {
    const inList = filteredTasks.some((t) => t.id === selectedTaskId);
    if (!inList) selectTask(filteredTasks[0]?.id ?? null);
  }, [filteredTasks, selectedTaskId, selectTask]);

  const selected: Task | undefined =
    tasks.find((t) => t.id === selectedTaskId) ?? filteredTasks[0];

  /* ───────────────────────────────────────────── daily resonance */

  // Today's ratio: completed_today / (open + completed_today).
  // Falls back to all-time ratio until `now` is set (avoids SSR drift).
  const resonance = useMemo(() => {
    if (tasks.length === 0) return 0;
    if (!now) {
      // Stable placeholder for SSR — ratio of completed across all tasks.
      const c = tasks.filter((t) => t.completed_at).length;
      return Math.round((c / tasks.length) * 100);
    }
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const completedToday = tasks.filter(
      (t) => t.completed_at && new Date(t.completed_at) >= startOfDay,
    ).length;
    const openCount = tasks.filter((t) => !t.completed_at).length;
    const denom = completedToday + openCount;
    if (denom === 0) return 0;
    return Math.round((completedToday / denom) * 100);
  }, [tasks, now]);

  /* ───────────────────────────────────────────── per-task stats */

  const taskStats = useMemo(() => {
    if (!selected) return { totalMs: 0, count: 0, recent: [] as TimerSession[] };
    const sessions = history.filter((s) => s.task_id === selected.id);
    const recent = [...sessions]
      .sort(
        (a, b) =>
          new Date(b.started_at).getTime() -
          new Date(a.started_at).getTime(),
      )
      .slice(0, 3);
    return {
      totalMs: sessions.reduce((a, s) => a + s.duration_ms, 0),
      count: sessions.length,
      recent,
    };
  }, [selected, history]);

  /* ───────────────────────────────────────────── actions */

  const startFocus = () => {
    if (!selected) return;
    setMode('focus');
    setTarget(45 * 60 * 1000);
    resetTimer();
    timerStart(selected.id);
    setFocus(true);
  };

  const onComplete = async () => {
    if (!selected || selected.completed_at) return;
    // Confetti gating, in priority order:
    //   1. First-EVER completed task on this account/device → big celebration
    //      + a one-time "First crystal forged" toast.
    //   2. Otherwise, first task TODAY → daily confetti.
    //   3. Otherwise, no extra spark (the row's own micro-burst still fires
    //      from the checkbox click).
    const fireFirstEver = shouldFireFirstTaskCelebration();
    const fireDaily = !fireFirstEver && shouldFireDailyConfetti();

    await complete(selected.id);
    awardStar(selected.id);

    if ((fireFirstEver || fireDaily) && typeof document !== 'undefined') {
      // Anchor at the top-center of the viewport so the spread reads as
      // "raining down" across the page, not bottom-up.
      const anchor = document.createElement('div');
      anchor.style.position = 'fixed';
      anchor.style.left = '50%';
      anchor.style.top  = '20%';
      anchor.style.width = '1px';
      anchor.style.height = '1px';
      anchor.style.pointerEvents = 'none';
      document.body.appendChild(anchor);

      if (fireFirstEver) {
        // Bigger spread (radius + count) for the once-in-a-lifetime moment.
        sparkBurst(anchor, { big: true, radius: 200, count: 40 });
        toastSuccess('First crystal forged. ✦');
        markFirstTaskCelebrationFired();
        // Also satisfy the daily gate so we don't double-fire on the same day.
        markDailyConfettiFired();
      } else {
        sparkBurst(anchor, { big: true });
        markDailyConfettiFired();
      }

      window.setTimeout(() => anchor.remove(), 2200);
    }

    const next = filteredTasks.find((t) => t.id !== selected.id && !t.completed_at);
    selectTask(next?.id ?? null);
  };

  const onDelete = async () => {
    if (!selected) return;
    const next = filteredTasks.find((t) => t.id !== selected.id);
    await remove(selected.id);
    selectTask(next?.id ?? null);
  };

  const openCount = filteredTasks.filter((t) => !t.completed_at).length;

  // ── multi-select handlers ────────────────────────────────────────────
  // Resolves a list-row click into the right intent:
  //   • plain click          → single-select (anchor, normal detail open)
  //   • Cmd/Ctrl-click       → toggle this id in the bulk set
  //   • Shift-click          → extend bulk selection from anchor to this id
  // Clearing the bulk set is automatic when the user single-clicks again
  // (so the bar disappears) or via the Clear button on the BulkBar.
  const onRowClick = (id: string, e: React.MouseEvent | { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => {
    if (e.shiftKey && lastAnchorRef.current) {
      const idx = filteredTasks.findIndex((t) => t.id === id);
      const from = filteredTasks.findIndex((t) => t.id === lastAnchorRef.current);
      if (idx === -1 || from === -1) return selectTask(id);
      const [a, b] = idx < from ? [idx, from] : [from, idx];
      const next = new Set(bulkSelected);
      for (let i = a; i <= b; i++) next.add(filteredTasks[i].id);
      setBulkSelected(next);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(bulkSelected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setBulkSelected(next);
      lastAnchorRef.current = id;
      return;
    }
    // Plain click — anchor + clear bulk.
    setBulkSelected(new Set());
    lastAnchorRef.current = id;
    selectTask(id);
  };
  const clearBulk = () => setBulkSelected(new Set());

  const bulkComplete = async () => {
    const ids = [...bulkSelected];
    for (const id of ids) {
      const t = tasks.find((x) => x.id === id);
      if (t && !t.completed_at) await complete(id);
    }
    clearBulk();
  };

  const bulkRemove = async () => {
    const ids = [...bulkSelected];
    for (const id of ids) {
      await remove(id);
    }
    clearBulk();
  };

  // ── keyboard navigation in the Nexus view ────────────────────────────
  // ↑/↓ move selection through the filtered list, c completes the selected
  // task, e jumps the detail card into edit-title mode, Cmd/Ctrl+Backspace
  // deletes. All gated on the view actually being mounted (since the effect
  // only runs when this component is rendered) and on not typing into an
  // input — text fields stay sacred.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      const isEditable =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        t?.isContentEditable;
      if (isEditable) return;

      // Cmd/Ctrl + Backspace → delete selected.
      if ((e.metaKey || e.ctrlKey) && e.key === 'Backspace') {
        if (!selected) return;
        e.preventDefault();
        onDelete();
        return;
      }
      // Reject other modifier combos so we don't fight global shortcuts.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'ArrowDown' || e.key === 'j') {
        if (filteredTasks.length === 0) return;
        e.preventDefault();
        const i = filteredTasks.findIndex((t) => t.id === selected?.id);
        const next = filteredTasks[Math.min(filteredTasks.length - 1, i + 1)];
        if (next) selectTask(next.id);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        if (filteredTasks.length === 0) return;
        e.preventDefault();
        const i = filteredTasks.findIndex((t) => t.id === selected?.id);
        const prev = filteredTasks[Math.max(0, i - 1)];
        if (prev) selectTask(prev.id);
      } else if (e.key === 'c' || e.key === 'C') {
        if (!selected || selected.completed_at) return;
        e.preventDefault();
        onComplete();
      } else if (e.key === 'e' || e.key === 'E') {
        if (!selected) return;
        e.preventDefault();
        // Detail card listens for this and switches into title-edit mode.
        window.dispatchEvent(new CustomEvent('verge:edit-task-title'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filteredTasks, selected, selectTask, onComplete, onDelete]);

  // Long-press on a mobile row fires this — scroll the detail card into
  // view so the user immediately sees the actions they probably want.
  useEffect(() => {
    const onFocus = () => {
      const el = document.getElementById('nexus-detail-card');
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener('verge:focus-detail-card', onFocus);
    return () => window.removeEventListener('verge:focus-detail-card', onFocus);
  }, []);

  return (
    <section className="relative h-full w-full overflow-y-auto px-4 pb-24 pt-4 md:px-10 md:pb-10 md:pt-6 no-scrollbar">
      <NexusHeader
        resonance={resonance}
        ready={!!now}
        openCount={openCount}
        filter={filter}
        setFilter={setFilter}
        search={search}
        setSearch={setSearch}
        allTags={allTags}
        activeTag={activeTag}
        setActiveTag={setActiveTag}
      />

      {/* Three-column triptych on desktop:
            streams (3) — spine stage (5) — detail (4)
          All three columns align to start so each can stick independently
          while the page itself owns the scroll. The middle column is empty
          HTML — the R3F spine renders behind it, with floating labels on
          top/bottom to frame the selection. */}
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-12 md:items-start">
        <div className="md:sticky md:top-2 md:col-span-3">
          <StreamsCard
            tasks={filteredTasks}
            selectedId={selected?.id ?? null}
            bulkSelected={bulkSelected}
            onRowClick={onRowClick}
            composing={composeOpen}
            onToggleCompose={() => setComposeOpen((v) => !v)}
            onSubmitNew={async (title, p) => {
              try {
                const t = await add({ title, priority: p });
                selectTask(t.id);
                setComposeOpen(false);
                setFilter('open');
                setActiveTag(null);
              } catch {
                // add() already showed a toast and rolled back local state.
                // Leave the compose form open so the user can retry.
              }
            }}
            onReorder={reorder}
            now={now}
          />
        </div>

        {/* Spine stage — desktop only. The whole column is `pointer-events:
            none` (inherited by the labels) so clicks pass straight through
            to the canvas behind, letting R3F's raycaster pick up orb hits.
            Without this the centre column's wrapper inherits the active
            Slot's `pointer-events: auto` and swallows every orb click. */}
        <div className="pointer-events-none hidden md:col-span-5 md:block">
          <div className="sticky top-2 flex h-[calc(100vh-11rem)] flex-col items-center justify-between py-4">
            <span className="eyebrow whitespace-nowrap">
              {openCount} stream{openCount === 1 ? '' : 's'} orbiting
            </span>

            {selected && !selected.completed_at ? (
              <div className="max-w-md text-center transition-opacity duration-500">
                <div className="eyebrow-amber">Currently selected</div>
                <div className="mt-2 font-display text-2xl font-light text-ink">
                  {selected.title}
                </div>
                <div
                  className="mx-auto mt-3 h-[1px] w-16 bg-amber/50"
                  style={{ boxShadow: '0 0 10px rgba(255, 138, 61, 0.4)' }}
                />
              </div>
            ) : !selected ? (
              <span className="text-sm italic text-ink-faint">
                Click a stream — or an orb — to focus on it
              </span>
            ) : (
              <span aria-hidden />
            )}
          </div>
        </div>

        <div id="nexus-detail-card" className="md:col-span-4 scroll-mt-4">
          {selected ? (
            <DetailCard
              task={selected}
              stats={taskStats}
              now={now}
              onInitiate={startFocus}
              onComplete={onComplete}
              onDelete={onDelete}
              onSnooze={(until) => snooze(selected.id, until)}
              onUpdate={update}
            />
          ) : tasks.length === 0 ? (
            <div className="card min-h-[280px] p-8">
              <EmptyState
                title="No streams in orbit."
                body="Tasks are the orbs on your Time Spine. Drop one in to start tracking your work — set a priority, snooze it, or initiate a focus session from it."
                action={
                  <button
                    onClick={() => setComposeOpen(true)}
                    className="btn-amber px-5 py-2 text-[11px] uppercase tracking-[0.16em]"
                  >
                    Add your first
                  </button>
                }
              />
            </div>
          ) : (
            <div className="card min-h-[280px] p-8">
              <EmptyState
                size="sm"
                title="Nothing matches this filter."
                body="Try a different filter chip, clear the search, or add a new task."
              />
            </div>
          )}
        </div>
      </div>

      {/* Floating bulk-action bar — only shown when 2+ rows are selected via
          Cmd-click or Shift-click. Anchored above the mobile bottom nav. */}
      {bulkSelected.size >= 2 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center md:bottom-8">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber/40 bg-bg-deep/95 px-3 py-2 backdrop-blur-md shadow-[0_18px_40px_-18px_rgba(0,0,0,0.7)] animate-fade-in">
            <span className="px-2 text-[12px] font-semibold tabular-nums text-amber">
              {bulkSelected.size}
            </span>
            <span className="text-[11px] uppercase tracking-[0.16em] text-ink-mute">
              selected
            </span>
            <span className="h-4 w-px bg-line" />
            <button
              onClick={bulkComplete}
              className="rounded-full px-3 py-1 text-[12px] font-semibold text-ink-mute transition-colors hover:bg-amber/[0.10] hover:text-amber"
            >
              Complete
            </button>
            <button
              onClick={bulkRemove}
              className="rounded-full px-3 py-1 text-[12px] font-semibold text-ink-mute transition-colors hover:bg-red-500/15 hover:text-red-400"
            >
              Delete
            </button>
            <button
              onClick={clearBulk}
              aria-label="Clear selection"
              className="ml-1 rounded-full p-1 text-ink-faint transition-colors hover:bg-white/[0.04] hover:text-ink"
            >
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ===================================================== NexusHeader */

function NexusHeader({
  resonance, ready, openCount,
  filter, setFilter, search, setSearch,
  allTags, activeTag, setActiveTag,
}: {
  resonance: number;
  ready: boolean;
  openCount: number;
  filter: FilterId;
  setFilter: (f: FilterId) => void;
  search: string;
  setSearch: (s: string) => void;
  allTags: string[];
  activeTag: string | null;
  setActiveTag: (t: string | null) => void;
}) {
  const displayPct = ready ? resonance : 0;
  return (
    <div className="card p-5 md:px-6 md:py-4">
      {/* Top row — resonance + search */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="shrink-0">
            <div className="eyebrow">Daily Resonance</div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="amber-glow font-display text-3xl font-medium tabular-nums leading-none">
                {displayPct}
              </span>
              <span className="text-sm text-amber/70">%</span>
            </div>
          </div>
          <div className="hidden h-[3px] flex-1 overflow-hidden rounded-full bg-amber/[0.10] md:block">
            <div
              className="h-full rounded-full bg-amber shadow-[0_0_12px_rgba(255,138,61,0.45)] transition-[width] duration-700"
              style={{ width: `${displayPct}%` }}
            />
          </div>
          <div className="shrink-0 text-right">
            <div className="eyebrow">In orbit</div>
            <div className="mt-0.5 font-display text-2xl font-medium tabular-nums leading-none text-ink">
              {openCount}
            </div>
          </div>
        </div>

        <div className="relative w-full md:w-[260px]">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search streams"
            className="w-full rounded-full border border-line bg-bg/40 px-4 py-1.5 pl-9 text-sm text-ink placeholder:text-ink-faint focus:border-amber/30 focus:outline-none transition-colors"
          />
          <svg viewBox="0 0 20 20" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" fill="none">
            <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M13.5 13.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* Bottom row — filter chips + tag chips */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={clsx(
              'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
              filter === f.id
                ? 'bg-amber/[0.14] text-amber'
                : 'text-ink-faint hover:text-ink-mute',
            )}
          >
            {f.label}
          </button>
        ))}

        {allTags.length > 0 && (
          <>
            <span className="mx-1 h-3 w-[1px] bg-line" aria-hidden />
            {allTags.map((t) => {
              const c = tagColor(t);
              const active = activeTag === t;
              return (
                <button
                  key={t}
                  onClick={() => setActiveTag(active ? null : t)}
                  className={clsx(
                    'rounded-full border px-2 py-[2px] text-[10px] font-medium uppercase tracking-[0.10em] transition-all',
                    active && 'scale-105',
                  )}
                  style={{
                    background: active ? `${c}26` : `${c}10`,
                    borderColor: active ? `${c}88` : `${c}33`,
                    color: active ? c : `${c}cc`,
                  }}
                >
                  #{t}
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

/* ===================================================== StreamsCard */

function StreamsCard({
  tasks, selectedId, bulkSelected, onRowClick, composing, onToggleCompose, onSubmitNew, onReorder, now,
}: {
  tasks: Task[];
  selectedId: string | null;
  bulkSelected: Set<string>;
  onRowClick: (id: string, e: React.MouseEvent) => void;
  composing: boolean;
  onToggleCompose: () => void;
  onSubmitNew: (title: string, p: Priority) => void;
  onReorder: (orderedIds: string[]) => void;
  now: Date | null;
}) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');

  // Drag-reorder state. `dragId` = the row being dragged; `overId` + `side`
  // tell us where to draw the drop indicator and where the row will land
  // when dropped.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overSide, setOverSide] = useState<'top' | 'bottom'>('top');

  const commitDrop = () => {
    if (!dragId || !overId || dragId === overId) {
      setDragId(null); setOverId(null);
      return;
    }
    const ids = tasks.map((t) => t.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdxRaw = ids.indexOf(overId);
    if (fromIdx < 0 || toIdxRaw < 0) {
      setDragId(null); setOverId(null);
      return;
    }
    // Remove the source, then insert at the resolved target index.
    const next = ids.filter((id) => id !== dragId);
    const targetIdx = (() => {
      const baseIdx = next.indexOf(overId);
      return overSide === 'bottom' ? baseIdx + 1 : baseIdx;
    })();
    next.splice(targetIdx, 0, dragId);
    onReorder(next);
    setDragId(null); setOverId(null);
  };

  return (
    <div className="card flex flex-col overflow-hidden md:max-h-[calc(100vh-11rem)]">
      {/* Header — title + add toggle */}
      <div className="flex items-center justify-between border-b border-line/40 px-5 py-3">
        <div className="eyebrow">
          Active streams · <span className="text-amber">{tasks.length}</span>
        </div>
        <button
          onClick={onToggleCompose}
          aria-label={composing ? 'Close' : 'Add task'}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-ink-faint transition-colors hover:border-amber/30 hover:text-amber"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4">
            {composing ? (
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            ) : (
              <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      {/* Compose form — slides in just above the list. */}
      {composing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            onSubmitNew(title.trim(), priority);
            setTitle('');
          }}
          className="space-y-3 border-b border-line/40 bg-bg/40 px-4 py-3"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's the next move?"
            autoFocus
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <div className="flex gap-1.5">
            {(['low', 'medium', 'high'] as Priority[]).map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => setPriority(p)}
                className={clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors',
                  priority === p
                    ? 'bg-amber/[0.10] text-ink'
                    : 'text-ink-faint hover:text-ink-mute',
                )}
              >
                <span className={clsx('h-1.5 w-1.5 rounded-full', PRIORITY_DOT[p])} />
                {p === 'high' ? 'α' : p === 'medium' ? 'β' : 'γ'}
              </button>
            ))}
            <button
              type="submit"
              className="rounded-lg bg-amber/[0.10] px-3 text-xs font-semibold text-amber hover:bg-amber/[0.18] transition-colors"
            >
              Add
            </button>
          </div>
        </form>
      )}

      {/* List */}
      <ul
        className="space-y-1 overflow-y-auto p-3 no-scrollbar md:flex-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); commitDrop(); }}
      >
        {tasks.map((t) => {
          const showTopDrop    = dragId && overId === t.id && overSide === 'top'    && dragId !== t.id;
          const showBottomDrop = dragId && overId === t.id && overSide === 'bottom' && dragId !== t.id;
          return (
            <li
              key={t.id}
              draggable
              onDragStart={(e) => {
                setDragId(t.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/task-id', t.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!dragId || dragId === t.id) return;
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const side = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
                setOverId(t.id);
                setOverSide(side);
              }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              className={clsx(
                'relative',
                showTopDrop &&    'before:absolute before:inset-x-2 before:-top-px before:h-[2px] before:rounded-full before:bg-amber before:shadow-[0_0_10px_rgba(255,138,61,0.6)]',
                showBottomDrop && 'after:absolute  after:inset-x-2  after:-bottom-px  after:h-[2px]  after:rounded-full  after:bg-amber  after:shadow-[0_0_10px_rgba(255,138,61,0.6)]',
                dragId === t.id && 'opacity-50',
              )}
            >
              <StreamRow
                task={t}
                selected={selectedId === t.id}
                bulkSelected={bulkSelected.has(t.id)}
                now={now}
                onClick={(e) => onRowClick(t.id, e)}
              />
            </li>
          );
        })}
        {tasks.length === 0 && (
          <li className="px-2 py-4 text-center text-sm text-ink-faint">
            No streams in this view.
          </li>
        )}
      </ul>
    </div>
  );
}

/* ===================================================== StreamRow
 *
 * Single row inside StreamsCard. Pulled out so each row can own its own
 * long-press hook (hooks-in-loops are illegal inside the parent map).
 *
 * Behaviour:
 *   • Tap            → onClick (normal select / bulk toggle)
 *   • Long-press     → select the task AND dispatch verge:focus-detail-card
 *                      so the detail panel scrolls into view on mobile.
 *                      Provides a haptic nudge where supported.
 *   • Right-click    → same as long-press, for parity on desktop.
 */
function StreamRow({
  task, selected, bulkSelected, now, onClick,
}: {
  task: Task;
  selected: boolean;
  bulkSelected: boolean;
  now: Date | null;
  onClick: (e: React.MouseEvent) => void;
}) {
  const longPress = useLongPress((target) => {
    // Visual feedback via the existing select state — the parent's onClick
    // would normally do this, but a long-press never fires onClick.
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    window.dispatchEvent(new CustomEvent('verge:focus-detail-card'));
  });

  return (
    <button
      onClick={(e) => {
        // The long-press synthesizes a click on the same element; ignore
        // the bubbled-up version to avoid double-handling.
        if (longPress.firedRef.current) {
          longPress.firedRef.current = false;
          return;
        }
        onClick(e);
      }}
      onTouchStart={longPress.onTouchStart}
      onTouchMove={longPress.onTouchMove}
      onTouchEnd={longPress.onTouchEnd}
      onTouchCancel={longPress.onTouchCancel}
      onContextMenu={longPress.onContextMenu}
      className={clsx(
        'group flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
        bulkSelected
          ? 'bg-amber/[0.14] ring-1 ring-amber/50'
          : selected
          ? 'bg-amber/[0.07] ring-1 ring-amber/30'
          : 'hover:bg-white/[0.02]',
        task.completed_at && 'opacity-60',
      )}
    >
      <span
        className={clsx(
          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
          PRIORITY_DOT[task.priority],
          selected && 'shadow-[0_0_10px_2px_rgba(255,138,61,0.55)]',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className={clsx(
          'truncate text-[15px] text-ink',
          task.completed_at && 'line-through',
        )}>
          {task.title}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="text-[12px] text-ink-faint">
            {streamSubtitle(task, now)}
          </span>
          {(task.tags ?? []).slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="rounded-full px-1.5 text-[9px] font-medium uppercase tracking-[0.08em]"
              style={{
                background: `${tagColor(tag)}1c`,
                color: tagColor(tag),
              }}
            >
              #{tag}
            </span>
          ))}
          {(task.tags ?? []).length > 2 && (
            <span className="text-[9px] text-ink-faint">
              +{(task.tags ?? []).length - 2}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/* ===================================================== DetailCard */

interface DetailProps {
  task: Task;
  stats: { totalMs: number; count: number; recent: TimerSession[] };
  now: Date | null;
  onInitiate: () => void;
  onComplete: () => void;
  onDelete: () => void;
  onSnooze: (until: Date | null) => void;
  onUpdate: (id: string, patch: Partial<Task>) => Promise<void>;
}

function DetailCard({
  task, stats, now, onInitiate, onComplete, onDelete, onSnooze, onUpdate,
}: DetailProps) {
  const pips = PRIORITY_PIPS[task.priority];

  // Menu
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Inline edit — title
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  useEffect(() => { setTitleDraft(task.title); setEditingTitle(false); }, [task.id, task.title]);

  // Keyboard "e" → edit title. The Nexus-level handler fires this so the
  // detail card doesn't need its own keydown listener.
  useEffect(() => {
    const onEdit = () => setEditingTitle(true);
    window.addEventListener('verge:edit-task-title', onEdit);
    return () => window.removeEventListener('verge:edit-task-title', onEdit);
  }, []);
  const commitTitle = () => {
    const next = titleDraft.trim();
    if (next && next !== task.title) onUpdate(task.id, { title: next });
    else setTitleDraft(task.title);
    setEditingTitle(false);
  };

  // Inline edit — notes
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(task.notes ?? '');
  useEffect(() => { setNotesDraft(task.notes ?? ''); setEditingNotes(false); }, [task.id, task.notes]);
  const commitNotes = () => {
    const next = notesDraft.trim();
    if (next !== (task.notes ?? '')) onUpdate(task.id, { notes: next || null });
    setEditingNotes(false);
  };

  // Due date — direct change, no edit state
  const due = dueLabel(task.due_at, now);

  return (
    <div className="card flex flex-col p-7">
      <div className="flex items-start justify-between">
        <span className="pill">{PRIORITY_NAME[task.priority]}</span>
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-full p-1 text-ink-faint transition-colors hover:bg-amber/[0.06] hover:text-ink"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5">
              <circle cx="4"  cy="10" r="1.4" fill="currentColor" />
              <circle cx="10" cy="10" r="1.4" fill="currentColor" />
              <circle cx="16" cy="10" r="1.4" fill="currentColor" />
            </svg>
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 top-9 z-20 w-52 overflow-hidden rounded-xl border border-line bg-bg-deep/95 backdrop-blur-md shadow-xl">
              <button
                role="menuitem"
                disabled={!!task.completed_at}
                onClick={(e) => {
                  // First task of the day → confetti burst. Subsequent
                  // completions get the small spark from before.
                  if (shouldFireDailyConfetti()) {
                    sparkBurst(e.currentTarget, { big: true });
                    markDailyConfettiFired();
                  } else {
                    sparkBurst(e.currentTarget);
                  }
                  onComplete();
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-ink transition-colors hover:bg-amber/[0.08] disabled:opacity-40"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4 text-amber" fill="none">
                  <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M7 10.4l2 2 4-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Mark complete
              </button>

              {/* Snooze submenu — quick presets. The detail "Due" picker still
                  exists for one-off date scheduling. */}
              <div className="border-t border-line/40 px-3 py-2">
                <div className="eyebrow mb-1.5 text-[10px]">Snooze until</div>
                <div className="flex flex-wrap gap-1">
                  {snoozePresets().map((p) => (
                    <button
                      key={p.label}
                      role="menuitem"
                      onClick={() => { onSnooze(p.until); setMenuOpen(false); }}
                      className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-mute transition-colors hover:border-amber/40 hover:text-amber"
                    >
                      {p.label}
                    </button>
                  ))}
                  {task.snooze_until && (
                    <button
                      role="menuitem"
                      onClick={() => { onSnooze(null); setMenuOpen(false); }}
                      className="rounded-md border border-amber/40 bg-amber/[0.08] px-2 py-1 text-[11px] font-semibold text-amber transition-colors hover:bg-amber/[0.18]"
                    >
                      Wake now
                    </button>
                  )}
                </div>
              </div>

              <button
                role="menuitem"
                onClick={() => { onDelete(); setMenuOpen(false); }}
                className="flex w-full items-center gap-2 border-t border-line/40 px-3 py-2.5 text-left text-sm text-ink-mute transition-colors hover:bg-red-500/10 hover:text-ink"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                  <path d="M5 6h10M8 6V4h4v2M7 6l1 11h4l1-11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Title (editable) */}
      <div className="mt-6">
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') {
                setTitleDraft(task.title);
                setEditingTitle(false);
              }
            }}
            className="w-full bg-transparent font-display text-3xl leading-tight text-ink focus:outline-none border-b border-amber/40 pb-0.5"
          />
        ) : (
          <h3
            onClick={() => setEditingTitle(true)}
            className="cursor-text font-display text-3xl leading-tight text-ink hover:text-ink/90 transition-colors"
            title="Click to rename"
          >
            {task.title}
          </h3>
        )}
      </div>

      {/* Tags */}
      <TagEditor
        tags={task.tags ?? []}
        onChange={(tags) => onUpdate(task.id, { tags })}
      />

      {/* Notes (editable) */}
      <div className="mt-4">
        {editingNotes ? (
          <textarea
            autoFocus
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={commitNotes}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setNotesDraft(task.notes ?? '');
                setEditingNotes(false);
              }
            }}
            rows={3}
            placeholder="What's the context for this?"
            className="w-full resize-none rounded-lg border border-amber/30 bg-bg/40 px-3 py-2 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
          />
        ) : (
          <p
            onClick={() => setEditingNotes(true)}
            className="min-h-[3em] cursor-text rounded-lg px-1 -mx-1 text-[15px] leading-relaxed text-ink-mute transition-colors hover:bg-amber/[0.03]"
            title="Click to edit notes"
          >
            {task.notes ?? (
              <span className="italic text-ink-faint">Click to add notes…</span>
            )}
          </p>
        )}
      </div>

      {/* Subtasks */}
      <SubtaskList taskId={task.id} />

      {/* Estimate — optional pre-task time guess. Compared against actual
          focus minutes in Astral's "Estimated vs actual" card. Free-form
          number input commits on blur. */}
      <EstimateRow
        value={task.estimated_min ?? null}
        onChange={(min) => onUpdate(task.id, { estimated_min: min })}
      />

      {/* Due date */}
      <div className="mt-6 flex items-center gap-3 border-t border-line/40 pt-4">
        <span className="eyebrow w-20 shrink-0">Due</span>
        <span
          className={clsx(
            'flex-1 text-sm',
            due.tone === 'overdue' && 'text-red-400',
            due.tone === 'soon' && 'text-amber',
            due.tone === 'normal' && 'text-ink',
            due.tone === 'none' && 'text-ink-faint italic',
          )}
        >
          {due.text}
        </span>
        <div className="relative flex items-center gap-1">
          <input
            type="date"
            value={toDateInputValue(task.due_at)}
            // `min={today}` blocks the picker from offering past days. The
            // onChange guard catches the rare browser that lets a user type
            // a back-dated value directly.
            min={now ? toDateInputValue(now.toISOString()) : undefined}
            onChange={(e) => {
              const v = e.target.value;
              if (v && now && parseYMD(v) < startOfDay(now)) {
                // Silently refuse — the picker shouldn't have allowed this.
                return;
              }
              onUpdate(task.id, { due_at: v ? toIsoEndOfDay(v) : null });
            }}
            className="cursor-pointer rounded-md border border-line bg-bg/40 px-2 py-1 text-xs text-ink-mute focus:border-amber/40 focus:outline-none [color-scheme:dark]"
          />
          {task.due_at && (
            <button
              onClick={() => onUpdate(task.id, { due_at: null })}
              aria-label="Clear due date"
              className="text-ink-faint transition-colors hover:text-red-400"
            >
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Repeat */}
      <div className="mt-3 flex items-center gap-3 border-t border-line/40 pt-3">
        <span className="eyebrow w-20 shrink-0">Repeat</span>
        <span className="flex-1 text-sm text-ink-mute">
          {task.rrule
            ? 'On complete, the next instance will be scheduled automatically.'
            : 'One-off task.'}
        </span>
        <RepeatPicker
          value={task.rrule ?? null}
          onChange={(rrule) => onUpdate(task.id, { rrule })}
          anchorDate={task.due_at ? new Date(task.due_at) : new Date(task.created_at)}
        />
      </div>

      {/* Time invested */}
      {stats.count > 0 && (
        <div className="mt-3 flex items-center gap-3 border-t border-line/40 pt-3">
          <span className="eyebrow w-20 shrink-0">Time</span>
          <span className="flex-1 text-sm text-ink">
            <span className="font-display tabular-nums">{fmtMs(stats.totalMs)}</span>
            <span className="text-ink-faint"> · {stats.count} session{stats.count === 1 ? '' : 's'}</span>
          </span>
        </div>
      )}

      {/* Energy */}
      <div className="mt-5">
        <div className="eyebrow mb-2.5">Energy required</div>
        <div className="flex gap-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <span
              key={i}
              className={clsx(
                'h-[6px] w-9 rounded-full transition-colors',
                i < pips
                  ? 'bg-amber shadow-[0_0_10px_rgba(255,138,61,0.55)]'
                  : 'bg-amber/15',
              )}
            />
          ))}
        </div>
      </div>

      {/* Recent sessions */}
      {now && stats.recent.length > 0 && (
        <div className="mt-6">
          <div className="eyebrow mb-2">Recent sessions</div>
          <ul className="space-y-1.5">
            {stats.recent.map((s) => (
              <li
                key={s.id}
                className="flex items-baseline justify-between text-sm"
              >
                <span className="font-display tabular-nums text-ink">
                  {fmtMs(s.duration_ms)}
                </span>
                <span className="text-xs text-ink-faint">
                  {timeAgo(s.started_at, now)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={onInitiate}
        disabled={!!task.completed_at}
        className="btn-amber mt-7 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {task.completed_at ? 'Already crystallised' : 'Initiate Focus State'}
      </button>
    </div>
  );
}

/* ===================================================== TagEditor */

function TagEditor({
  tags, onChange,
}: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState('');

  const commitInput = () => {
    const t = input.trim().toLowerCase();
    if (t && !tags.includes(t) && t.length <= 24) {
      onChange([...tags, t]);
    }
    setInput('');
  };

  const removeTag = (t: string) => onChange(tags.filter((x) => x !== t));

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {tags.map((t) => {
        const c = tagColor(t);
        return (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-medium uppercase tracking-[0.10em]"
            style={{ background: `${c}1c`, borderColor: `${c}44`, color: c }}
          >
            #{t}
            <button
              onClick={() => removeTag(t)}
              className="opacity-60 transition-opacity hover:opacity-100"
              aria-label={`Remove ${t}`}
            >
              ×
            </button>
          </span>
        );
      })}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commitInput();
          }
          if (e.key === 'Backspace' && !input && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={commitInput}
        placeholder={tags.length === 0 ? '+ add tag' : ''}
        className="min-w-[80px] flex-1 bg-transparent text-[11px] text-ink-mute placeholder:text-ink-faint focus:outline-none"
      />
    </div>
  );
}

/* ===================================================== SubtaskList */

function SubtaskList({ taskId }: { taskId: string }) {
  const all     = useSubtaskStore((s) => s.subtasks);
  const addSub  = useSubtaskStore((s) => s.add);
  const toggle  = useSubtaskStore((s) => s.toggle);
  const update  = useSubtaskStore((s) => s.update);
  const remove  = useSubtaskStore((s) => s.remove);
  const reorderSubs = useSubtaskStore((s) => s.reorder);

  const items = useMemo(() => subtasksForTask(all, taskId), [all, taskId]);
  const { total, done } = subtaskProgress(all, taskId);
  const [draft, setDraft] = useState('');

  // Drag-reorder for the subtask list — same indicator + commit pattern as
  // the parent stream list, scoped to one task at a time.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overSide, setOverSide] = useState<'top' | 'bottom'>('top');

  const commitDrop = () => {
    if (!dragId || !overId || dragId === overId) {
      setDragId(null); setOverId(null);
      return;
    }
    const ids = items.map((s) => s.id);
    const next = ids.filter((id) => id !== dragId);
    const baseIdx = next.indexOf(overId);
    const targetIdx = overSide === 'bottom' ? baseIdx + 1 : baseIdx;
    next.splice(targetIdx, 0, dragId);
    reorderSubs(taskId, next);
    setDragId(null); setOverId(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    await addSub(taskId, t);
    setDraft('');
  };

  return (
    <section className="mt-6 border-t border-line/40 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="eyebrow">Subtasks</div>
        {total > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-ink-faint tabular-nums">
            <span>{done}/{total}</span>
            <span className="h-[3px] w-12 overflow-hidden rounded-full bg-amber/[0.10]">
              <span
                className="block h-full rounded-full bg-amber transition-[width] duration-500"
                style={{ width: total ? `${(done / total) * 100}%` : '0%' }}
              />
            </span>
          </div>
        )}
      </div>

      {items.length > 0 && (
        <ul
          className="space-y-0.5"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); commitDrop(); }}
        >
          {items.map((sub) => (
            <SubtaskRow
              key={sub.id}
              sub={sub}
              dragging={dragId === sub.id}
              showTopDrop={!!dragId && overId === sub.id && overSide === 'top'    && dragId !== sub.id}
              showBottomDrop={!!dragId && overId === sub.id && overSide === 'bottom' && dragId !== sub.id}
              onDragStart={() => setDragId(sub.id)}
              onDragOver={(e) => {
                if (!dragId || dragId === sub.id) return;
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setOverSide(e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom');
                setOverId(sub.id);
              }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onToggle={() => toggle(sub.id)}
              onRename={(title) => update(sub.id, { title })}
              onRemove={() => remove(sub.id)}
            />
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/[0.02] transition-colors">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-faint">
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={items.length === 0 ? 'Break it down…' : 'Add another step'}
          className="flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
        />
        {draft.trim() && (
          <button
            type="submit"
            className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber"
          >
            Add
          </button>
        )}
      </form>
    </section>
  );
}

function SubtaskRow({
  sub, dragging, showTopDrop, showBottomDrop,
  onDragStart, onDragOver, onDragEnd,
  onToggle, onRename, onRemove,
}: {
  sub: Subtask;
  dragging: boolean;
  showTopDrop: boolean;
  showBottomDrop: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onToggle: () => void;
  onRename: (title: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sub.title);
  useEffect(() => { setDraft(sub.title); }, [sub.id, sub.title]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== sub.title) onRename(next);
    else setDraft(sub.title);
    setEditing(false);
  };

  return (
    <li
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/subtask-id', sub.id);
        onDragStart();
      }}
      onDragOver={(e) => { e.preventDefault(); onDragOver(e); }}
      onDragEnd={onDragEnd}
      className={clsx(
        'group relative flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.02]',
        showTopDrop &&    'before:absolute before:inset-x-2 before:-top-px before:h-[2px] before:rounded-full before:bg-amber before:shadow-[0_0_10px_rgba(255,138,61,0.6)]',
        showBottomDrop && 'after:absolute  after:inset-x-2  after:-bottom-px  after:h-[2px]  after:rounded-full  after:bg-amber  after:shadow-[0_0_10px_rgba(255,138,61,0.6)]',
        dragging && 'opacity-50',
      )}
    >
      {/* Drag handle — visually muted, becomes a grab cursor on hover. */}
      <span
        aria-hidden
        className="flex h-4 w-3 shrink-0 cursor-grab items-center justify-center text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
        title="Drag to reorder"
      >
        <svg viewBox="0 0 8 12" className="h-2.5 w-2.5" fill="currentColor">
          <circle cx="2" cy="2" r="1" />
          <circle cx="6" cy="2" r="1" />
          <circle cx="2" cy="6" r="1" />
          <circle cx="6" cy="6" r="1" />
          <circle cx="2" cy="10" r="1" />
          <circle cx="6" cy="10" r="1" />
        </svg>
      </span>
      <button
        onClick={(e) => {
          // Spark only on the un-checked → checked direction; un-checking
          // is a correction, not a celebration.
          if (!sub.completed_at) {
            sparkBurst(e.currentTarget);
            if (useUserStore.getState().profile?.sounds_enabled) playTick();
          }
          onToggle();
        }}
        className={clsx(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
          sub.completed_at
            ? 'border-amber bg-amber/30 text-amber'
            : 'border-line hover:border-amber/40',
        )}
        aria-label={sub.completed_at ? 'Mark incomplete' : 'Mark complete'}
      >
        {sub.completed_at && (
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
            <path
              d="M2.5 6.5l2 2 4-4.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') {
              setDraft(sub.title);
              setEditing(false);
            }
          }}
          className="flex-1 bg-transparent text-[14px] text-ink focus:outline-none"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className={clsx(
            'flex-1 truncate text-left text-[14px] transition-colors',
            sub.completed_at
              ? 'text-ink-faint line-through'
              : 'text-ink hover:text-ink/90',
          )}
        >
          {sub.title}
        </button>
      )}

      <button
        onClick={onRemove}
        className="text-ink-faint opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
        aria-label="Delete subtask"
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </li>
  );
}

/* ===================================================== helpers */

function weight(p: Priority): number {
  return p === 'high' ? 3 : p === 'medium' ? 2 : 1;
}

function fmtMs(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function isDueSoon(iso: string, now: Date): boolean {
  const t = new Date(iso).getTime();
  const days = Math.floor((t - now.getTime()) / 86400000);
  return days < DUE_SOON_DAYS;     // includes overdue
}

// Estimate-minutes input. Pure UI helper used by DetailCard; commits on
// blur. Empty string clears the estimate. Capped at 24h to keep the
// validation honest.
function EstimateRow({
  value, onChange,
}: { value: number | null; onChange: (min: number | null) => void }) {
  const [draft, setDraft] = useState(value ? String(value) : '');
  useEffect(() => { setDraft(value ? String(value) : ''); }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      if (value !== null) onChange(null);
      return;
    }
    const n = Math.round(Number(trimmed));
    if (!Number.isFinite(n) || n <= 0) {
      setDraft(value ? String(value) : '');
      return;
    }
    const clamped = Math.min(60 * 24, n);
    if (clamped !== value) onChange(clamped);
  };

  return (
    <div className="mt-3 flex items-center gap-3 border-t border-line/40 pt-4">
      <span className="eyebrow w-20 shrink-0">Estimate</span>
      <span className="flex-1 text-sm text-ink-faint">
        {value
          ? `Roughly ${value} min — compared to actual focus time in Astral.`
          : 'Optional. Helps calibrate your time estimates over time.'}
      </span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder="—"
        inputMode="numeric"
        className="w-16 rounded-md border border-line bg-bg/40 px-2 py-1 text-center text-xs text-ink placeholder:text-ink-faint focus:border-amber/40 focus:outline-none"
      />
      <span className="text-[10px] text-ink-faint">min</span>
    </div>
  );
}

function dueLabel(
  iso: string | null | undefined,
  now: Date | null,
): { text: string; tone: 'none' | 'normal' | 'soon' | 'overdue' } {
  if (!iso) return { text: 'No due date', tone: 'none' };
  if (!now) return { text: '…', tone: 'normal' };
  const t = new Date(iso).getTime();
  const days = Math.ceil((t - now.getTime()) / 86400000);
  if (days < 0) return { text: `Overdue ${-days}d`, tone: 'overdue' };
  if (days === 0) return { text: 'Due today', tone: 'soon' };
  if (days === 1) return { text: 'Due tomorrow', tone: 'soon' };
  if (days <= 7)  return { text: `Due in ${days}d`, tone: 'soon' };
  return {
    text: `Due ${new Date(iso).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    })}`,
    tone: 'normal',
  };
}

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toIsoEndOfDay(yyyymmdd: string): string {
  // Treat as local end-of-day so "Due Friday" stays Friday in the user's TZ.
  const d = new Date(`${yyyymmdd}T23:59:59`);
  return d.toISOString();
}

function timeAgo(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1)  return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return 'yesterday';
  if (days < 7)   return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

function streamSubtitle(t: Task, now: Date | null): string {
  if (t.completed_at) return 'Crystallised';
  if (t.snooze_until && now && new Date(t.snooze_until) > now) {
    return `Snoozed until ${new Date(t.snooze_until).toLocaleString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    })}`;
  }
  if (t.due_at && now) {
    const d = dueLabel(t.due_at, now);
    if (d.tone === 'overdue' || d.tone === 'soon') return d.text;
  }
  const map: Record<Priority, string> = {
    high:   'Deep block · 2h+',
    medium: 'Focused session',
    low:    'Light pass',
  };
  return map[t.priority];
}

// Snooze quick-presets surfaced in the DetailCard menu. "Tomorrow morning"
// targets 9am local; "Next week" targets next Monday 9am.
function snoozePresets(): Array<{ label: string; until: Date }> {
  const now = new Date();
  const inHours = (h: number) => {
    const d = new Date(now);
    d.setHours(d.getHours() + h, 0, 0, 0);
    return d;
  };
  const tomorrowMorning = (() => {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  })();
  const nextMondayMorning = (() => {
    const d = new Date(now);
    const dow = d.getDay(); // 0 Sun .. 6 Sat
    const daysUntilMon = ((8 - dow) % 7) || 7;
    d.setDate(d.getDate() + daysUntilMon);
    d.setHours(9, 0, 0, 0);
    return d;
  })();
  return [
    { label: '1 hour',     until: inHours(1) },
    { label: '4 hours',    until: inHours(4) },
    { label: 'Tomorrow',   until: tomorrowMorning },
    { label: 'Next week',  until: nextMondayMorning },
  ];
}
