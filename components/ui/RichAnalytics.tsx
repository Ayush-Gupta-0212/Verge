'use client';

import { useMemo } from 'react';
import clsx from 'clsx';
import type { Task, TimerSession } from '@/lib/types';
import {
  focusByTag,
  focusByHourOfWeek,
  estimateAccuracy,
  type HourOfWeekCell,
} from '@/lib/insights';
import { tagColor } from '@/lib/colors';

// Astral's "richer analytics" block. Three cards under the existing
// insights row:
//   1. Focus by tag (90-day bar list)
//   2. Best hour-of-week heatmap (7×24)
//   3. Estimated vs actual (lifetime, completed tasks with an estimate)
//
// Each card hides itself when there's no signal so empty profiles stay
// uncluttered.

export default function RichAnalytics({
  tasks, history,
}: { tasks: Task[]; history: TimerSession[] }) {
  const byTag = useMemo(() => focusByTag(history, tasks, 90).slice(0, 8), [history, tasks]);
  const byHour = useMemo(() => focusByHourOfWeek(history), [history]);
  const estimates = useMemo(
    () => estimateAccuracy(tasks, history).slice(0, 6),
    [tasks, history],
  );

  const hasTag = byTag.length > 0;
  const hasHour = byHour.cells.some((c) => c.minutes > 0);
  const hasEst = estimates.length > 0;
  if (!hasTag && !hasHour && !hasEst) return null;

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-12">
      {hasTag && <TagFocusCard items={byTag} />}
      {hasHour && <HourOfWeekCard cells={byHour.cells} peakLabel={byHour.peakLabel} />}
      {hasEst  && <EstimateCard items={estimates} />}
    </div>
  );
}

/* ── 1) Focus by tag ─────────────────────────────────────────────────── */

function TagFocusCard({ items }: { items: { tag: string; minutes: number; sessions: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.minutes));
  return (
    <div className="card p-6 md:col-span-4">
      <div className="eyebrow mb-1">Focus by tag</div>
      <p className="mb-4 text-xs text-ink-faint">Last 90 days, top {items.length}.</p>
      <ul className="space-y-2">
        {items.map((it) => {
          const pct = (it.minutes / max) * 100;
          const color = it.tag === 'untagged' ? 'rgba(240,235,228,0.4)' : tagColor(it.tag);
          return (
            <li key={it.tag} className="flex items-center gap-3">
              <span className="w-20 truncate text-[12px] text-ink-mute">
                {it.tag === 'untagged' ? <em>untagged</em> : `#${it.tag}`}
              </span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all"
                  style={{ width: `${pct}%`, background: color }}
                />
              </div>
              <span className="w-14 text-right text-[12px] tabular-nums text-ink-mute">
                {fmtMin(it.minutes)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── 2) Best hour-of-week heatmap ────────────────────────────────────── */

const LEVEL_BG: Record<HourOfWeekCell['level'], string> = {
  0: 'bg-white/[0.04]',
  1: 'bg-amber/[0.18]',
  2: 'bg-amber/[0.36]',
  3: 'bg-amber/[0.60]',
  4: 'bg-amber shadow-[0_0_6px_rgba(255,138,61,0.45)]',
};

function HourOfWeekCard({
  cells, peakLabel,
}: { cells: HourOfWeekCell[]; peakLabel: string | null }) {
  // Render as 7 rows (days, Mon-first) × 24 cols (hours).
  const rows: HourOfWeekCell[][] = [];
  for (let d = 0; d < 7; d++) rows.push(cells.slice(d * 24, d * 24 + 24));
  const DAY_INITIAL = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

  return (
    <div className="card p-6 md:col-span-8">
      <div className="mb-1 flex items-center justify-between">
        <div className="eyebrow">When you focus</div>
        {peakLabel && (
          <div className="text-xs text-ink-faint">Peak · {peakLabel}</div>
        )}
      </div>
      <p className="mb-4 text-xs text-ink-faint">
        Minutes by day × hour, all-time. Find your reliable windows.
      </p>
      <div className="flex flex-col gap-[3px]">
        {/* Hour-axis ticks — every 6 hours, lightweight */}
        <div className="flex items-end gap-[3px] pl-6 text-[8px] text-ink-faint">
          {Array.from({ length: 24 }).map((_, h) => (
            <span key={h} className="flex w-[10px] justify-center">
              {h % 6 === 0 ? String(h).padStart(2, '0') : ''}
            </span>
          ))}
        </div>
        {rows.map((row, di) => (
          <div key={di} className="flex items-center gap-[3px]">
            <span className="w-5 text-[10px] font-semibold text-ink-faint">
              {DAY_INITIAL[di]}
            </span>
            {row.map((cell) => (
              <div
                key={cell.hour}
                title={`${DAY_INITIAL[di]} · ${String(cell.hour).padStart(2, '0')}:00 — ${Math.round(cell.minutes)}m`}
                className={clsx(
                  'h-[10px] w-[10px] rounded-[2px] transition-colors',
                  LEVEL_BG[cell.level],
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 3) Estimated vs actual ──────────────────────────────────────────── */

function EstimateCard({ items }: { items: { taskId: string; title: string; estimatedMin: number; actualMin: number; delta: number }[] }) {
  const overall = items.reduce((a, it) => a + it.delta, 0);
  const avg = Math.round(overall / items.length);
  const tone = avg > 5 ? 'over' : avg < -5 ? 'under' : 'on';

  return (
    <div className="card p-6 md:col-span-12">
      <div className="mb-1 flex items-center justify-between">
        <div className="eyebrow">Estimated vs actual</div>
        <div className="text-xs text-ink-faint">
          {items.length} task{items.length === 1 ? '' : 's'} · avg {avg >= 0 ? '+' : ''}{avg}m
          {tone === 'over'  && ' (you tend to underestimate)'}
          {tone === 'under' && ' (you tend to overestimate)'}
          {tone === 'on'    && ' (calibrated)'}
        </div>
      </div>
      <p className="mb-4 text-xs text-ink-faint">
        Completed tasks where you set an estimate, ordered by how far off the actual landed.
      </p>
      <ul className="space-y-2">
        {items.map((it) => {
          const max = Math.max(it.estimatedMin, it.actualMin, 1);
          const estPct = (it.estimatedMin / max) * 100;
          const actPct = (it.actualMin / max) * 100;
          return (
            <li key={it.taskId} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm text-ink">{it.title}</span>
                <span
                  className={clsx(
                    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.10em]',
                    Math.abs(it.delta) <= 5 ? 'bg-amber/[0.10] text-amber'
                      : it.delta > 0 ? 'bg-red-500/[0.10] text-red-400'
                      : 'bg-lunar/[0.10] text-lunar',
                  )}
                >
                  {it.delta >= 0 ? '+' : ''}{it.delta}m
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-ink-faint">
                <span className="w-12 text-right">est {it.estimatedMin}m</span>
                <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-amber/40" style={{ width: `${estPct}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full bg-amber/85 mix-blend-screen" style={{ width: `${actPct}%`, opacity: 0.7 }} />
                </div>
                <span className="w-12">act {it.actualMin}m</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function fmtMin(min: number): string {
  if (min < 60) return `${min}m`;
  const h = min / 60;
  return h < 10 ? `${h.toFixed(1)}h` : `${Math.round(h)}h`;
}
