// ----------------------------------------------------------------------------
// First-run seed — give brand-new users something to interact with.
//
// On the user's very first sign-in (no tasks, no events, no focus history)
// we plant a handful of starter tasks and one example event today so the
// dashboard isn't an intimidating void. Each item is tagged "starter" so
// they're trivially identifiable if the user wants to nuke them later.
//
// Idempotency:
//   • Bails out unless tasks + events + history are all empty (so a returning
//     user who deleted everything doesn't get re-seeded against their will).
//   • A localStorage flag (verge:seeded-v1:<userId>) means we never re-seed
//     a given user on a given device even if they briefly hit zero again.
// ----------------------------------------------------------------------------

import { useTaskStore } from '@/stores/useTaskStore';
import { useScheduleStore } from '@/stores/useScheduleStore';
import { useTimerStore } from '@/stores/useTimerStore';
import { useUserStore } from '@/stores/useUserStore';
import { dateToYMD } from '@/lib/dates';
import type { Priority } from '@/lib/types';

interface SeedTask {
  title: string;
  notes: string;
  priority: Priority;
  estimated_min?: number;
}

const SEED_TASKS: SeedTask[] = [
  {
    title: 'Try a focus session',
    notes:
      'Hit "Initiate Focus" on this task in Nexus to start a guided Pomodoro. The 3D sphere will breathe with you.',
    priority: 'high',
    estimated_min: 25,
  },
  {
    title: 'Set your daily focus goal',
    notes:
      'Astral → Preferences. The number you pick drives the progress ring on Flow and unlocks streak forgiveness.',
    priority: 'medium',
    estimated_min: 5,
  },
  {
    title: 'Add a real task or two',
    notes:
      'In Nexus, type a title in the box up top. The starter tasks (tagged "starter") can be deleted any time.',
    priority: 'medium',
    estimated_min: 5,
  },
];

const STORAGE_PREFIX = 'verge:seeded-v1:';

function alreadySeeded(userId: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + userId) === '1';
  } catch {
    return false;
  }
}

function markSeeded(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + userId, '1');
  } catch {
    /* ignore */
  }
}

/**
 * Seed if-and-only-if the user is genuinely fresh. Safe to call repeatedly —
 * the guards short-circuit returning users.
 */
export async function maybeSeedFirstRun(): Promise<void> {
  // Server-side / no DOM → no-op.
  if (typeof window === 'undefined') return;

  const userState = useUserStore.getState();
  const user = userState.user;
  if (!user) return; // signed out — nothing to seed against

  if (alreadySeeded(user.id)) return;

  const tasks = useTaskStore.getState().tasks;
  const events = useScheduleStore.getState().events;
  const history = useTimerStore.getState().history;

  // Only seed if the workspace is genuinely empty across the board.
  if (tasks.length > 0 || events.length > 0 || history.length > 0) {
    markSeeded(user.id); // they have data → don't re-check next sign-in
    return;
  }

  // Plant the starter tasks. We persist via useTaskStore.add so the cloud
  // write path is exactly the same as a real user task.
  const addTask = useTaskStore.getState().add;
  for (const t of SEED_TASKS) {
    await addTask({
      title: t.title,
      notes: t.notes,
      priority: t.priority,
      estimated_min: t.estimated_min,
      tags: ['starter'],
    });
  }

  // Plant one example event today at 10:00 for 60 minutes — gives Chronos
  // something to render on first visit. Skip silently if the schedule store
  // doesn't accept the write (e.g. RLS hiccup on a cold profile).
  try {
    const now = new Date();
    const today = dateToYMD(now);
    const upsert = useScheduleStore.getState().upsert;
    await upsert({
      id: undefined,
      user_id: user.id,
      date: today,
      start_minute: 10 * 60,
      duration_minutes: 60,
      title: 'Deep work block',
      color: '#ff8a3d',
      notes: 'Example event. Drag it, edit it, or delete it from Chronos.',
      task_id: null,
    });
  } catch {
    // Non-fatal — the user still has the starter tasks.
  }

  markSeeded(user.id);
}
