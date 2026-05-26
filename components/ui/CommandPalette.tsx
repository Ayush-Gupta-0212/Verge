'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTaskStore } from '@/stores/useTaskStore';
import { useScheduleStore } from '@/stores/useScheduleStore';
import { useUIStore } from '@/stores/useUIStore';
import { useTimerStore } from '@/stores/useTimerStore';
import { useUserStore } from '@/stores/useUserStore';
import { DEFAULT_PREFERENCES, type View } from '@/lib/types';
import { fuzzyScore } from '@/lib/fuzzy';
import { dateToYMD, formatMinute } from '@/lib/dates';

// Cmd-K (or Ctrl-K) command palette.
//
// Three command groups, in priority order:
//   1. Actions  — "Initiate focus", "New task", "Start break", etc.
//   2. Navigate — the five views (also reachable via 1..5)
//   3. Items    — open tasks (jump to Nexus + select) and upcoming events
//
// Results rank by fuzzy match score with a small per-group weight so a
// good action match beats a mediocre task match.

type CmdGroup = 'Action' | 'Navigate' | 'Task' | 'Event';

interface Command {
  id: string;
  group: CmdGroup;
  label: string;
  subtitle?: string;
  hint?: string;             // right-side hint (e.g., "⏎", "tomorrow 14:00")
  run: () => void;
}

const GROUP_WEIGHT: Record<CmdGroup, number> = {
  Action: 1.15,
  Navigate: 1.10,
  Task: 1.0,
  Event: 0.95,
};

const VIEW_LABELS: Record<View, string> = {
  flow:    'Flow — daily orientation',
  chronos: 'Chronos — calendar',
  nexus:   'Nexus — streams + spine',
  vault:   'Vault — archive',
  astral:  'Astral — profile + insights',
};

export default function CommandPalette({
  open, onClose,
}: { open: boolean; onClose: () => void }) {
  const tasks  = useTaskStore((s) => s.tasks);
  const events = useScheduleStore((s) => s.events);

  const setView    = useUIStore((s) => s.setView);
  const setFocus   = useUIStore((s) => s.setFocus);
  const selectTask = useUIStore((s) => s.selectTask);

  const start    = useTimerStore((s) => s.start);
  const setMode  = useTimerStore((s) => s.setMode);
  const setTarget = useTimerStore((s) => s.setTarget);
  const finalize = useTimerStore((s) => s.finalize);

  const profile  = useUserStore((s) => s.profile);
  const focusMin = profile?.focus_minutes ?? DEFAULT_PREFERENCES.focus_minutes;
  const breakMin = profile?.break_minutes ?? DEFAULT_PREFERENCES.break_minutes;

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLUListElement>(null);

  // Focus the input + reset cursor each time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    queueMicrotask(() => inputRef.current?.focus());
  }, [open]);

  // Esc to dismiss
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /* ── command sources ─────────────────────────────────────────────────── */

  const baseCommands = useMemo<Command[]>(() => {
    const goto = (v: View) => {
      setView(v);
      onClose();
    };
    const cmds: Command[] = [
      {
        id: 'action.new-task',
        group: 'Action',
        label: 'New task',
        hint: 'N',
        run: () => {
          setView('nexus');
          // The TaskScheduler listens for this on the window.
          window.dispatchEvent(new CustomEvent('verge:new-task'));
          onClose();
        },
      },
      {
        id: 'action.focus',
        group: 'Action',
        label: `Initiate focus block (${focusMin}m)`,
        subtitle: 'Open the immersion overlay and start the timer.',
        hint: 'F',
        run: () => {
          setMode('focus');
          setTarget(focusMin * 60_000);
          start();
          setFocus(true);
          onClose();
        },
      },
      {
        id: 'action.break',
        group: 'Action',
        label: `Start a ${breakMin}-min break`,
        subtitle: 'A countdown without writing it to history.',
        run: async () => {
          // If a session is live, finalize it first so the break is a clean
          // segment in the loop.
          await finalize();
          setMode('break');
          setTarget(breakMin * 60_000);
          start();
          setFocus(true);
          onClose();
        },
      },
      // Views — five fast nav commands. Stay synchronized with VIEW_LABELS.
      ...(Object.keys(VIEW_LABELS) as View[]).map<Command>((v, i) => ({
        id: `nav.${v}`,
        group: 'Navigate',
        label: VIEW_LABELS[v],
        hint: String(i + 1),
        run: () => goto(v),
      })),
    ];
    return cmds;
  }, [
    setView, setFocus, setMode, setTarget, start, finalize, onClose,
    focusMin, breakMin,
  ]);

  const taskCommands = useMemo<Command[]>(() => {
    return tasks
      .filter((t) => !t.completed_at)
      .slice(0, 60) // cap so the palette stays fast on huge lists
      .map<Command>((t) => ({
        id: `task.${t.id}`,
        group: 'Task',
        label: t.title,
        subtitle: (t.tags ?? []).length
          ? `#${(t.tags ?? []).slice(0, 3).join('  #')}`
          : t.notes?.slice(0, 80) ?? undefined,
        hint: t.priority === 'high' ? 'high' : t.priority === 'medium' ? 'med' : 'low',
        run: () => {
          selectTask(t.id);
          setView('nexus');
          onClose();
        },
      }));
  }, [tasks, selectTask, setView, onClose]);

  const eventCommands = useMemo<Command[]>(() => {
    if (!events.length) return [];
    const now = new Date();
    const todayYMD = dateToYMD(now);
    return events
      .filter((e) => e.date >= todayYMD)
      .slice(0, 40)
      .map<Command>((e) => ({
        id: `event.${e.id}`,
        group: 'Event',
        label: e.title,
        subtitle: `${e.date} · ${formatMinute(e.start_minute)} for ${e.duration_minutes}m`,
        run: () => {
          setView('chronos');
          onClose();
        },
      }));
  }, [events, setView, onClose]);

  /* ── ranking ─────────────────────────────────────────────────────────── */

  const results = useMemo(() => {
    const all: Command[] = [...baseCommands, ...taskCommands, ...eventCommands];
    if (!query.trim()) {
      // Default ordering: actions + nav at top, then 8 most recent tasks +
      // 8 nearest events so opening the palette is useful before typing.
      const actions = all.filter((c) => c.group === 'Action');
      const nav     = all.filter((c) => c.group === 'Navigate');
      const top     = all.filter((c) => c.group === 'Task').slice(0, 8);
      const ev      = all.filter((c) => c.group === 'Event').slice(0, 8);
      return [...actions, ...nav, ...top, ...ev];
    }
    const scored = all
      .map((c) => {
        const text = [c.label, c.subtitle ?? '', c.group].join(' ');
        const score = fuzzyScore(text, query) * GROUP_WEIGHT[c.group];
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);
    return scored.map((x) => x.c);
  }, [baseCommands, taskCommands, eventCommands, query]);

  // Clamp cursor as results shrink.
  useEffect(() => {
    if (cursor >= results.length) setCursor(Math.max(0, results.length - 1));
  }, [results.length, cursor]);

  // Scroll the active row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  /* ── input keyboard handling ────────────────────────────────────────── */

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[cursor];
      if (r) r.run();
    } else if (e.key === 'Home') {
      setCursor(0);
    } else if (e.key === 'End') {
      setCursor(Math.max(0, results.length - 1));
    }
  };

  if (!open) return null;

  // Group the visible results so the section headers render once per group
  // without splitting the cursor index across structures.
  let lastGroup: CmdGroup | null = null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/55 backdrop-blur-sm pt-[14vh] animate-fade-in"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-[min(92vw,640px)] overflow-hidden rounded-2xl border border-line bg-bg-deep/95 backdrop-blur-xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line/60 px-4 py-3">
          <svg viewBox="0 0 20 20" className="h-4 w-4 text-ink-faint" fill="none">
            <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M13.5 13.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search streams, events, or run a command…"
            className="flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <kbd className="rounded border border-line bg-bg/60 px-1.5 py-0.5 text-[10px] font-semibold text-ink-faint">
            esc
          </kbd>
        </div>

        <ul
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto py-1 no-scrollbar"
          role="listbox"
        >
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-ink-faint">
              Nothing matches.
            </li>
          )}
          {results.map((r, i) => {
            const showGroup = r.group !== lastGroup;
            lastGroup = r.group;
            const active = i === cursor;
            return (
              <div key={r.id}>
                {showGroup && (
                  <li
                    className="sticky top-0 z-10 bg-bg-deep/95 px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint backdrop-blur"
                    role="presentation"
                  >
                    {r.group}
                  </li>
                )}
                <li
                  data-i={i}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => r.run()}
                  className={clsx(
                    'flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                    active ? 'bg-amber/[0.08] text-ink' : 'text-ink-mute hover:bg-white/[0.03]',
                  )}
                >
                  <span className="flex-1 truncate">
                    <span className={clsx(active && 'text-amber')}>{r.label}</span>
                    {r.subtitle && (
                      <span className="ml-2 text-[11px] text-ink-faint">{r.subtitle}</span>
                    )}
                  </span>
                  {r.hint && (
                    <kbd className="shrink-0 rounded border border-line bg-bg/40 px-1.5 py-0.5 text-[10px] font-semibold text-ink-faint">
                      {r.hint}
                    </kbd>
                  )}
                </li>
              </div>
            );
          })}
        </ul>

        <div className="flex items-center justify-between border-t border-line/60 px-4 py-2 text-[10px] uppercase tracking-[0.16em] text-ink-faint">
          <span className="flex items-center gap-3">
            <span><kbd className="rounded bg-white/[0.04] px-1">↑↓</kbd> navigate</span>
            <span><kbd className="rounded bg-white/[0.04] px-1">⏎</kbd> run</span>
          </span>
          <span>
            {results.length} result{results.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  );
}
