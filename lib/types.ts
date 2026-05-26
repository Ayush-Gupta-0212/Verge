export type Priority = 'low' | 'medium' | 'high';

export interface Task {
  id: string;
  user_id: string | null;
  title: string;
  notes?: string | null;
  priority: Priority;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  spine_t: number;
  spine_radius: number;
  spine_angle: number;
  tags?: string[];          // free-form user tags (lowercased, deduped)
  rrule?: string | null;    // recurrence rule (see lib/rrule.ts), null = one-off
  snooze_until?: string | null; // ISO; if in the future, task is hidden from "open"
  position?: number | null; // manual sort order in Nexus stream list
  estimated_min?: number | null; // pre-task time estimate; compared vs actual focus minutes
}

export interface Subtask {
  id: string;
  task_id: string;
  user_id: string | null;
  title: string;
  completed_at: string | null;
  position: number;
  created_at?: string;
}

// LEGACY — weekly recurring template (pre Phase A). Not currently surfaced
// in the UI; kept in the schema for a future "recurring schedule" feature.
export interface ScheduleCell {
  id: string;
  user_id: string | null;
  day: number;
  slot: number;
  duration?: number;
  title: string;
  color: string;
  notes?: string | null;
  task_id?: string | null;
}

// Date-anchored calendar event. Lives in `schedule_events`.
export interface ScheduleEvent {
  id: string;
  user_id: string | null;
  date: string;             // YYYY-MM-DD in the user's local timezone
  start_minute: number;     // minutes from midnight, 0..1439
  duration_minutes: number; // 15..1440
  title: string;
  color: string;
  notes?: string | null;
  task_id?: string | null;
  created_at?: string;
  rrule?: string | null;    // recurrence rule on the original instance
  series_id?: string | null; // shared id across all instances of a series
}

export interface TimerSession {
  id: string;
  user_id: string | null;
  kind: 'stopwatch' | 'focus';
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  task_id: string | null;
  interruptions?: number;     // taps of the "distracted" button mid-session
}

export interface ConstellationStar {
  id: string;
  user_id?: string | null;
  task_id: string;
  position: [number, number, number];
  intensity: number;
  earned_at: string;
}

export interface Profile {
  id: string;
  display_name: string;
  avatar_url?: string | null;     // public URL of the user's portrait
  daily_goal_min?: number;        // default 120 (= 2h)
  weekly_goal_min?: number;       // default 1500 (= 25h)
  day_start_hour?: number;        // 0..23, default 9
  day_end_hour?: number;          // 1..24, default 21
  notify_focus_end?: boolean;
  notify_due_reminders?: boolean;
  // Quiet hours (Phase 4) — block notifications during a window. When
  // start > end, the window wraps midnight (22 → 7 = 10pm to 7am).
  quiet_hours_enabled?: boolean;
  quiet_hours_start?: number;     // 0..23
  quiet_hours_end?: number;       // 0..23
  // Opt-in audio feedback (Phase 3) — small chime on focus complete + tick
  // on subtask completion. Default false; toggled in Astral preferences.
  sounds_enabled?: boolean;
  // Pomodoro preferences (Phase 2). Drive the focus timer + break loop.
  focus_minutes?: number;         // default 25
  break_minutes?: number;         // default 5
  long_break_minutes?: number;    // default 15
  long_break_every?: number;      // default 4 (long break every 4th block)
  // Date (YYYY-MM-DD) of the Monday for which the user has spent their one
  // weekly streak-freeze. Null/undefined = freeze still available this week.
  streak_freeze_used_week?: string | null;
  // Visual accent (Phase 5) — swaps the amber CSS vars across the app.
  accent?: AccentVariant;
  // Optional public profile slug (Phase 5). When set + enabled, the user's
  // Astral page is mirrored read-only at /u/{slug}.
  public_slug?: string | null;
  public_enabled?: boolean;
  // In-app reduced-motion override (Phase 6) — when true, behaves as if
  // the OS-level prefers-reduced-motion is on (animations damped).
  reduced_motion?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type AccentVariant = 'amber' | 'violet' | 'aurora';

// New achievements row (Phase 2). Keys are stable strings registered in
// lib/achievements.ts; earned_at locks in when the badge was first awarded.
export interface Achievement {
  user_id: string | null;
  key: string;
  earned_at: string;
}

// Used everywhere `profile` could be null (seed mode, before mount, etc.).
export const DEFAULT_PREFERENCES = {
  daily_goal_min:  120,
  weekly_goal_min: 25 * 60,
  day_start_hour:  9,
  day_end_hour:    21,
  focus_minutes:        25,
  break_minutes:         5,
  long_break_minutes:   15,
  long_break_every:      4,
} as const;

export type Preferences = Partial<
  Pick<
    Profile,
    | 'daily_goal_min'
    | 'weekly_goal_min'
    | 'day_start_hour'
    | 'day_end_hour'
    | 'notify_focus_end'
    | 'notify_due_reminders'
    | 'quiet_hours_enabled'
    | 'quiet_hours_start'
    | 'quiet_hours_end'
    | 'sounds_enabled'
    | 'display_name'
    | 'avatar_url'
    | 'accent'
    | 'public_slug'
    | 'public_enabled'
    | 'reduced_motion'
    | 'focus_minutes'
    | 'break_minutes'
    | 'long_break_minutes'
    | 'long_break_every'
    | 'streak_freeze_used_week'
  >
>;

// Verge nav model: five primary views, plus Focus as an overlay.
export type View = 'flow' | 'chronos' | 'nexus' | 'vault' | 'astral';
