'use client';

import { useMemo } from 'react';
import clsx from 'clsx';
import type { TimerSession } from '@/lib/types';
import { buildFocusHeatmap, type HeatmapCell } from '@/lib/insights';

// 7-rows × N-weeks grid of focus intensity. Reads identical to the
// GitHub-style contribution calendar — empty cell, then 4 amber tints
// scaled to the user's own peak day.
//
// Defaults to ~5 weeks (35 days) which fits comfortably in both the Astral
// insights row and (with `weeks={3}`) the Flow card sidebar.

const WEEKDAY_LABELS = ['M', 'W', 'F'] as const;

const LEVEL_BG: Record<HeatmapCell['level'], string> = {
  0: 'bg-white/[0.04] border-white/[0.04]',
  1: 'bg-amber/[0.18] border-amber/30',
  2: 'bg-amber/[0.36] border-amber/45',
  3: 'bg-amber/[0.58] border-amber/60',
  4: 'bg-amber border-amber shadow-[0_0_8px_rgba(255,138,61,0.55)]',
};

export default function FocusHeatmap({
  history,
  now,
  weeks = 5,
  showLabels = true,
}: {
  history: TimerSession[];
  now: Date | null;
  weeks?: number;
  showLabels?: boolean;
}) {
  const data = useMemo(() => {
    if (!now) return null;
    return buildFocusHeatmap(history, now, weeks);
  }, [history, now, weeks]);

  if (!data) {
    return <div className="h-20 w-full animate-pulse rounded-md bg-white/[0.02]" />;
  }

  // Bucket cells into columns (one column per week, 7 rows starting at the
  // weekday of the first cell). The data is contiguous — column = floor(i/7).
  const columns: HeatmapCell[][] = [];
  for (let c = 0; c < data.weeksOut; c++) {
    columns.push(data.cells.slice(c * 7, c * 7 + 7));
  }

  const totalMin = data.cells.reduce((a, c) => a + c.ms, 0) / 60000;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        {showLabels && (
          <div className="flex h-[88px] flex-col justify-between py-0.5 text-[9px] font-semibold tracking-[0.10em] text-ink-faint">
            {WEEKDAY_LABELS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-[3px]">
          {columns.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-[3px]">
              {col.map((cell) => (
                <div
                  key={cell.date}
                  title={`${cell.date} — ${formatMins(cell.ms)}`}
                  className={clsx(
                    'h-[10px] w-[10px] rounded-[2px] border transition-colors',
                    LEVEL_BG[cell.level],
                  )}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {showLabels && (
        <div className="flex items-center justify-between text-[10px] text-ink-faint">
          <span>{formatMins(totalMin * 60_000)} over {data.weeksOut * 7} days</span>
          <span className="flex items-center gap-1">
            <span>Less</span>
            {[1, 2, 3, 4].map((l) => (
              <span
                key={l}
                className={clsx(
                  'h-[8px] w-[8px] rounded-[2px] border',
                  LEVEL_BG[l as HeatmapCell['level']],
                )}
              />
            ))}
            <span>More</span>
          </span>
        </div>
      )}
    </div>
  );
}

function formatMins(ms: number): string {
  const m = ms / 60000;
  if (m < 1) return '0m';
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  return h < 10 ? `${h.toFixed(1)}h` : `${Math.round(h)}h`;
}
