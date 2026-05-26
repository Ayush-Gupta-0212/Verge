'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  formatRRule,
  parseRRule,
  summarizeRRule,
  WEEKDAYS,
  type RRule,
  type Weekday,
} from '@/lib/rrule';

// Compact recurrence picker — opens a popover with simple presets and a
// custom mode for "every N days/weeks/months." Used by the task DetailCard
// and the Chronos event modal.
//
// Props:
//   value:       the current rrule string (or null for one-off)
//   onChange:    called with the new rrule string OR null to clear
//   anchorDate:  used by the parent to compute next occurrences after a
//                pick — passed in so the popover can describe what "weekly"
//                will mean ("Weekly on Mon" if anchor is a Monday).

const PRESETS: Array<{ id: string; label: string; build: (anchor: Date) => RRule | null }> = [
  { id: 'none',    label: "Doesn't repeat", build: () => null },
  { id: 'daily',   label: 'Daily',          build: () => ({ freq: 'daily',   interval: 1 }) },
  {
    id: 'weekdays',
    label: 'Weekdays',
    build: () => ({ freq: 'weekly', interval: 1, byweekday: ['MO','TU','WE','TH','FR'] }),
  },
  {
    id: 'weekly',
    label: 'Weekly',
    build: (anchor) => ({
      freq: 'weekly',
      interval: 1,
      byweekday: [jsWeekday(anchor)],
    }),
  },
  { id: 'monthly', label: 'Monthly',        build: () => ({ freq: 'monthly', interval: 1 }) },
];

const WEEKDAY_LABELS: Record<Weekday, string> = {
  MO: 'M', TU: 'T', WE: 'W', TH: 'T', FR: 'F', SA: 'S', SU: 'S',
};

function jsWeekday(d: Date): Weekday {
  const map: Weekday[] = ['SU','MO','TU','WE','TH','FR','SA'];
  return map[d.getDay()];
}

export default function RepeatPicker({
  value, onChange, anchorDate, label = 'Repeat',
}: {
  value: string | null | undefined;
  onChange: (rrule: string | null) => void;
  anchorDate: Date;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  const current = parseRRule(value);
  const summary = current ? summarizeRRule(current) : 'One-off';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setCustomOpen(false);
      }
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [open]);

  const apply = (rule: RRule | null) => {
    onChange(rule ? formatRRule(rule) : null);
    setOpen(false);
    setCustomOpen(false);
  };

  return (
    <div ref={popRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
          current
            ? 'border-amber/40 bg-amber/[0.08] text-amber'
            : 'border-line bg-bg/40 text-ink-mute hover:border-amber/30 hover:text-ink',
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none">
          <path d="M3 5h8l-2-2M13 11H5l2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {summary}
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-30 w-64 overflow-hidden rounded-xl border border-line bg-bg-deep/95 p-1.5 shadow-xl backdrop-blur-md">
          {!customOpen ? (
            <>
              {PRESETS.map((p) => {
                const built = p.build(anchorDate);
                const active =
                  (!built && !current) ||
                  (built && current && JSON.stringify(built) === JSON.stringify(current));
                return (
                  <button
                    key={p.id}
                    onClick={() => apply(built)}
                    className={clsx(
                      'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                      active
                        ? 'bg-amber/[0.10] text-amber'
                        : 'text-ink-mute hover:bg-white/[0.03] hover:text-ink',
                    )}
                  >
                    <span>{p.label}</span>
                    {active && (
                      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                        <path d="M2.5 6.5l2 2 4-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                );
              })}
              <button
                onClick={() => setCustomOpen(true)}
                className="mt-1 flex w-full items-center justify-between border-t border-line/40 px-3 py-2 text-left text-sm text-ink-mute transition-colors hover:bg-white/[0.03] hover:text-ink"
              >
                <span>Custom…</span>
                <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                  <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          ) : (
            <CustomEditor
              initial={current ?? { freq: 'weekly', interval: 1, byweekday: [jsWeekday(anchorDate)] }}
              onCancel={() => setCustomOpen(false)}
              onApply={apply}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────── custom editor */

function CustomEditor({
  initial, onCancel, onApply,
}: {
  initial: RRule;
  onCancel: () => void;
  onApply: (r: RRule) => void;
}) {
  const [freq, setFreq]               = useState(initial.freq);
  const [intervalN, setIntervalN]     = useState(initial.interval || 1);
  const [days, setDays]               = useState<Weekday[]>(initial.byweekday ?? []);

  const toggleDay = (d: Weekday) => {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  };

  const submit = () => {
    const rule: RRule = {
      freq,
      interval: Math.max(1, Math.min(99, intervalN || 1)),
    };
    if (freq === 'weekly' && days.length > 0) {
      rule.byweekday = WEEKDAYS.filter((w) => days.includes(w));
    }
    onApply(rule);
  };

  return (
    <div className="space-y-3 px-2 py-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-ink-mute">Every</span>
        <input
          type="number"
          min={1}
          max={99}
          value={intervalN}
          onChange={(e) => setIntervalN(parseInt(e.target.value, 10) || 1)}
          className="w-14 rounded-md border border-line bg-bg/60 px-2 py-1 text-center tabular-nums text-ink focus:border-amber/40 focus:outline-none"
        />
        <select
          value={freq}
          onChange={(e) => setFreq(e.target.value as RRule['freq'])}
          className="flex-1 rounded-md border border-line bg-bg/60 px-2 py-1 text-ink focus:border-amber/40 focus:outline-none"
        >
          <option value="daily">day{intervalN !== 1 ? 's' : ''}</option>
          <option value="weekly">week{intervalN !== 1 ? 's' : ''}</option>
          <option value="monthly">month{intervalN !== 1 ? 's' : ''}</option>
        </select>
      </div>

      {freq === 'weekly' && (
        <div className="flex items-center justify-between gap-1">
          {WEEKDAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={clsx(
                'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                days.includes(d)
                  ? 'bg-amber text-black shadow-[0_0_10px_rgba(255,138,61,0.4)]'
                  : 'border border-line text-ink-mute hover:border-amber/30 hover:text-ink',
              )}
              title={d}
            >
              {WEEKDAY_LABELS[d]}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-line/40 pt-2">
        <button
          onClick={onCancel}
          className="rounded-md px-2.5 py-1 text-xs text-ink-faint transition-colors hover:text-ink"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          className="rounded-md bg-amber/[0.10] px-3 py-1 text-xs font-semibold text-amber transition-colors hover:bg-amber/[0.18]"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
