// Verge — achievement registry.
//
// Each badge is a stable `key`, a human label/copy, an icon hint, and an
// `earned(stats)` predicate. Stats come from a single `buildStats()` pass
// over tasks + sessions + streak so checking all badges is O(N + B).

import type { Task, TimerSession } from '@/lib/types';
import { computeStreak } from '@/lib/insights';

export type AchievementIcon =
  | 'spark'      // First Light — first focus session
  | 'check'      // Crystallised — first task completed
  | 'wave'       // Tidemark — N tasks completed
  | 'depth'      // Deep Diver — N hours focused
  | 'crystal'    // Crystal Field — N tasks completed (large)
  | 'thread'     // Threadkeeper — week-long streak
  | 'galaxy'     // Galaxy — month-long streak
  | 'dawn';      // Dawn Patrol — focus before 7am
                 // (room to add more — keep keys stable forever)

export interface Achievement {
  key: string;
  title: string;
  description: string;       // shown in tooltip / locked state
  icon: AchievementIcon;
  earned: (s: Stats) => boolean;
}

export interface Stats {
  tasksCompleted: number;
  focusSessions: number;
  focusMinutes: number;
  streakCurrent: number;
  streakLongest: number;
  earlyBirdSessions: number; // sessions started before 07:00
}

export function buildStats(
  tasks: Task[],
  history: TimerSession[],
  now: Date | null,
): Stats {
  const completed = tasks.filter((t) => t.completed_at).length;
  const focusOnly = history.filter((s) => s.kind === 'focus' && s.duration_ms >= 60_000);
  const minutes   = focusOnly.reduce((a, s) => a + s.duration_ms, 0) / 60_000;
  const streak    = computeStreak(history, now);
  const earlyBird = focusOnly.filter((s) => new Date(s.started_at).getHours() < 7).length;

  return {
    tasksCompleted: completed,
    focusSessions: focusOnly.length,
    focusMinutes:  minutes,
    streakCurrent: streak.current,
    streakLongest: streak.longest,
    earlyBirdSessions: earlyBird,
  };
}

// Ordered registry — display order on the Astral gallery follows this list.
// Keep keys stable forever; they're persisted to the DB.
export const ACHIEVEMENTS: Achievement[] = [
  {
    key: 'first_light',
    title: 'First Light',
    description: 'Complete your first focus session.',
    icon: 'spark',
    earned: (s) => s.focusSessions >= 1,
  },
  {
    key: 'crystallised',
    title: 'Crystallised',
    description: 'Complete your first task.',
    icon: 'check',
    earned: (s) => s.tasksCompleted >= 1,
  },
  {
    key: 'tidemark_10',
    title: 'Tidemark',
    description: 'Complete 10 tasks.',
    icon: 'wave',
    earned: (s) => s.tasksCompleted >= 10,
  },
  {
    key: 'crystal_field_50',
    title: 'Crystal Field',
    description: 'Complete 50 tasks.',
    icon: 'crystal',
    earned: (s) => s.tasksCompleted >= 50,
  },
  {
    key: 'crystal_field_100',
    title: 'Constellation',
    description: 'Complete 100 tasks.',
    icon: 'crystal',
    earned: (s) => s.tasksCompleted >= 100,
  },
  {
    key: 'deep_diver_10h',
    title: 'Deep Diver',
    description: 'Log 10 hours of focused work.',
    icon: 'depth',
    earned: (s) => s.focusMinutes >= 10 * 60,
  },
  {
    key: 'deep_diver_25h',
    title: 'Deep Voyager',
    description: 'Log 25 hours of focused work.',
    icon: 'depth',
    earned: (s) => s.focusMinutes >= 25 * 60,
  },
  {
    key: 'threadkeeper',
    title: 'Threadkeeper',
    description: 'Hold a 7-day focus streak.',
    icon: 'thread',
    earned: (s) => s.streakLongest >= 7,
  },
  {
    key: 'galaxy',
    title: 'Galaxy',
    description: 'Hold a 30-day focus streak.',
    icon: 'galaxy',
    earned: (s) => s.streakLongest >= 30,
  },
  {
    key: 'dawn_patrol',
    title: 'Dawn Patrol',
    description: 'Log a focus session before 7am.',
    icon: 'dawn',
    earned: (s) => s.earlyBirdSessions >= 1,
  },
];

// Returns the keys of all currently-earned badges given the stats. Used to
// reconcile the local set with what the user has on their profile.
export function earnedKeys(stats: Stats): string[] {
  return ACHIEVEMENTS.filter((a) => a.earned(stats)).map((a) => a.key);
}
