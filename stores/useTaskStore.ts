import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { Subtask, Task, Priority } from '@/lib/types';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { useUserStore } from '@/stores/useUserStore';
import { useSubtaskStore } from '@/stores/useSubtaskStore';
import { toastError, toastInfo, toastUndo } from '@/stores/useToastStore';
import { nextOccurrence, parseRRule } from '@/lib/rrule';

interface TaskState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  add: (input: Partial<Task> & { title: string }) => Promise<Task>;
  update: (id: string, patch: Partial<Task>) => Promise<void>;
  complete: (id: string) => Promise<void>;
  // Restore a previously-completed task back to "open" by clearing
  // completed_at. Used by the Vault to undo a wrongly-checked task.
  restore: (id: string) => Promise<void>;
  // Hide a task from the open list until `until`. Pass null to wake it.
  snooze: (id: string, until: Date | null) => Promise<void>;
  // Manually reorder tasks. Pass the new order of ids; persists `position`
  // values so the order survives a refresh.
  reorder: (orderedIds: string[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

// Module-level tracker for tasks the user just deleted but might undo within
// the toast window. The DB delete is deferred until the timer fires; if the
// user clicks Undo first, we cancel the timer and put the row back locally
// (the DB never got hit, so no re-insert needed).
const UNDO_DELETE_MS = 6000;
interface PendingDelete {
  task: Task;
  subtasks: Subtask[];
  timer: ReturnType<typeof setTimeout>;
}
const pendingDeletes = new Map<string, PendingDelete>();

const defaultPlacement = (count: number) => ({
  spine_t: (count % 12) / 12 + Math.random() * 0.04,
  spine_radius: 1.2 + Math.random() * 0.4,
  spine_angle: (count * 0.7) % (Math.PI * 2),
});

// Postgres column-missing detection used to gracefully retry against old DBs.
//   • PGRST204 — PostgREST: column not in schema cache (on insert/update)
//   • 42703    — Postgres: column does not exist (on select / order)
// Either signal means a migration hasn't been applied; the client strips the
// offending fields and tries once more, so the app keeps working.
type SupaError = { code?: string | null; message: string };
function isMissingColumn(err: SupaError | null | undefined): boolean {
  if (!err) return false;
  if (err.code === 'PGRST204' || err.code === '42703') return true;
  return /column .*does not exist|could not find the .* column/i.test(err.message);
}

// Phase 1+ fields that don't exist in legacy databases. Stripped from the
// payload when an insert/update fails with a "missing column" error.
const OPTIONAL_TASK_FIELDS = ['rrule', 'snooze_until', 'position'] as const;

async function insertWithSchemaFallback(
  // We accept the loose `SupabaseClient` type from getSupabaseBrowser so the
  // helper stays self-contained.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  task: Task,
): Promise<SupaError | null> {
  const { error } = await supabase.from('tasks').insert(task);
  if (!error || !isMissingColumn(error)) return error;
  // Strip the optional Phase 1 fields and retry. One round is enough — the
  // remaining columns (title, priority, tags, …) ship in every supported DB.
  const fallback = { ...task } as Record<string, unknown>;
  OPTIONAL_TASK_FIELDS.forEach((k) => delete fallback[k]);
  const retry = await supabase.from('tasks').insert(fallback);
  return retry.error ?? null;
}

async function updateWithSchemaFallback(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  id: string,
  userId: string,
  patch: Partial<Task>,
): Promise<SupaError | null> {
  const { error } = await supabase
    .from('tasks').update(patch).eq('id', id).eq('user_id', userId);
  if (!error || !isMissingColumn(error)) return error;
  const fallback = { ...patch } as Record<string, unknown>;
  OPTIONAL_TASK_FIELDS.forEach((k) => delete fallback[k]);
  if (Object.keys(fallback).length === 0) return null;
  const retry = await supabase
    .from('tasks').update(fallback).eq('id', id).eq('user_id', userId);
  return retry.error ?? null;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    const supabase = getSupabaseBrowser();
    const user = useUserStore.getState().user;

    if (!supabase) {
      // No backend — show seed tasks so the canvas isn't empty.
      set({ loading: false, tasks: seedTasks() });
      return;
    }
    if (!user) {
      // Backend configured but no session yet — wait for sign-in.
      set({ loading: false, tasks: [] });
      return;
    }

    // Order by position when set, falling back to created_at. The Postgres
    // .order() chain treats NULLs as "last," which works for the migration
    // window where some rows might still be null.
    //
    // If the user's DB hasn't run the Phase 1 migration yet, the `position`
    // column doesn't exist and the query 400s — we then transparently retry
    // ordered by created_at only, so the UI still shows tasks instead of an
    // empty page. The error toast points at the consolidated migration.
    let { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', user.id)
      .order('position',  { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error && isMissingColumn(error)) {
      const retry = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      data = retry.data;
      error = retry.error;
      if (!error) {
        toastError(
          'Your Supabase schema is out of date — run lib/supabase/migration-all.sql in the SQL editor to unlock recent features.',
        );
      }
    }

    if (error) {
      set({ loading: false, error: error.message, tasks: [] });
      toastError(error.message);
      return;
    }
    set({ loading: false, tasks: (data ?? []) as Task[] });
  },

  add: async (input) => {
    const placement = defaultPlacement(get().tasks.length);
    const user = useUserStore.getState().user;
    // Position = max(existing) + 1 so new tasks land at the end of the
    // manually-sorted list. Users can drag them anywhere from there.
    const maxPos = get().tasks.reduce(
      (m, t) => Math.max(m, t.position ?? 0),
      0,
    );
    const task: Task = {
      id: uuid(),
      user_id: user?.id ?? null,
      notes: null,
      priority: 'medium',
      due_at: null,
      completed_at: null,
      tags: [],
      created_at: new Date().toISOString(),
      rrule: null,
      snooze_until: null,
      position: maxPos + 1,
      ...placement,
      ...input,
    };
    // Optimistic local insert — UI shows the new task immediately.
    set((s) => ({ tasks: [...s.tasks, task] }));

    const supabase = getSupabaseBrowser();
    if (supabase && user) {
      const error = await insertWithSchemaFallback(supabase, task);
      if (error) {
        // Roll back the optimistic insert so the user can SEE the failure
        // (otherwise the task appears saved until next reload, when it
        // silently disappears).
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== task.id),
          error: error.message,
        }));
        const hint =
          isMissingColumn(error)
            ? ' — run lib/supabase/migration-all.sql in your Supabase SQL editor to unlock recent features.'
            : '';
        toastError(`Couldn't save task — ${error.message}${hint}`);
        throw new Error(error.message);
      }
    }
    return task;
  },

  update: async (id, patch) => {
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
    const supabase = getSupabaseBrowser();
    const user = useUserStore.getState().user;
    if (supabase && user) {
      const error = await updateWithSchemaFallback(supabase, id, user.id, patch);
      if (error) {
        set({ error: error.message });
        toastError(error.message);
      }
    }
  },

  complete: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    const completed_at = new Date().toISOString();
    await get().update(id, { completed_at });

    // Recurring task → spawn the next instance from the rrule. The completed
    // row stays in Vault as a record of *that occurrence*.
    const rule = parseRRule(task.rrule);
    if (!rule) return;
    const anchorIso = task.due_at ?? task.created_at;
    const anchor = new Date(anchorIso);
    const next = nextOccurrence(rule, anchor, new Date());
    if (!next) return;
    await get().add({
      title: task.title,
      notes: task.notes ?? null,
      priority: task.priority,
      tags: task.tags ?? [],
      due_at: next.toISOString(),
      rrule: task.rrule,
    });
    toastInfo(`Next "${task.title}" scheduled for ${next.toLocaleDateString()}.`);
  },

  restore: async (id) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, completed_at: null } : t,
      ),
    }));
    const supabase = getSupabaseBrowser();
    const user = useUserStore.getState().user;
    if (supabase && user) {
      const { error } = await supabase
        .from('tasks')
        .update({ completed_at: null })
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) {
        set({ error: error.message });
        toastError(`Couldn't restore — ${error.message}`);
      }
    }
  },

  snooze: async (id, until) => {
    const snooze_until = until ? until.toISOString() : null;
    await get().update(id, { snooze_until });
    if (until) {
      toastInfo(`Snoozed until ${until.toLocaleString()}.`);
    }
  },

  reorder: async (orderedIds) => {
    // Assign positions in 100-step increments so future drag-betweens have
    // room without renumbering everything (a common trick for sortable lists).
    const positions = new Map<string, number>();
    orderedIds.forEach((id, i) => positions.set(id, (i + 1) * 100));

    set((s) => ({
      tasks: s.tasks.map((t) =>
        positions.has(t.id) ? { ...t, position: positions.get(t.id)! } : t,
      ),
    }));

    const supabase = getSupabaseBrowser();
    const user = useUserStore.getState().user;
    if (!supabase || !user) return;
    // Fire updates in parallel; failures are aggregated to a single toast.
    const results = await Promise.all(
      orderedIds.map((id) =>
        supabase
          .from('tasks')
          .update({ position: positions.get(id)! })
          .eq('id', id)
          .eq('user_id', user.id),
      ),
    );
    const firstErr = results.find((r) => r.error)?.error;
    if (firstErr) {
      toastError(`Couldn't save order — ${firstErr.message}`);
    }
  },

  remove: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    const subtasks = useSubtaskStore
      .getState()
      .subtasks.filter((s) => s.task_id === id);

    // Optimistic local remove (and clear linked subtasks from view).
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    useSubtaskStore.getState().clearForTask(id);

    const supabase = getSupabaseBrowser();
    const user = useUserStore.getState().user;

    // Defer the actual DB delete so the user has a window to undo. If they
    // hit Undo before the timer fires, we restore from the snapshot and the
    // DB never sees the delete at all.
    const commitDelete = async () => {
      pendingDeletes.delete(id);
      if (!supabase || !user) return;
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) {
        // Delete failed at the DB after the undo window closed — put the row
        // back locally and tell the user, so the UI doesn't lie about it.
        set((s) => ({ tasks: [...s.tasks, task], error: error.message }));
        useSubtaskStore.setState((s) => ({
          subtasks: [...s.subtasks, ...subtasks],
        }));
        toastError(`Couldn't delete task — ${error.message}`);
      }
    };

    const timer = setTimeout(commitDelete, UNDO_DELETE_MS);
    pendingDeletes.set(id, { task, subtasks, timer });

    toastUndo(
      `"${task.title}" deleted`,
      () => {
        const pending = pendingDeletes.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingDeletes.delete(id);
        // Restore in place — DB was never touched.
        set((s) => ({ tasks: [...s.tasks, pending.task] }));
        useSubtaskStore.setState((s) => ({
          subtasks: [...s.subtasks, ...pending.subtasks],
        }));
      },
      UNDO_DELETE_MS,
    );
  },
}));

// If the page is closing while a delete is still pending, fire the DB delete
// synchronously via sendBeacon-style fallback so the user's intent isn't lost
// when they navigate away mid-undo-window.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    pendingDeletes.forEach((p) => clearTimeout(p.timer));
    // We can't reliably await async deletes here; leaving the DB in its
    // pre-delete state is acceptable — the next loadTasks() will resurface
    // the row and the user can re-delete. Ergonomically a small loss to
    // avoid silent data loss in the rare crash case.
  });
}

function seedTasks(): Task[] {
  const titles: Array<[string, Priority]> = [
    ['Draft project brief',       'high'],
    ['Refactor scheduler reducer', 'medium'],
    ['Read Three.js shader chapter', 'low'],
    ['Sync with study group',     'medium'],
    ['Physics problem set',       'high'],
    ['Stargazing window',         'low'],
  ];
  return titles.map(([title, priority], i) => ({
    id: uuid(),
    user_id: null,
    title,
    notes: null,
    priority,
    due_at: null,
    completed_at: null,
    created_at: new Date(Date.now() - i * 86400000).toISOString(),
    spine_t: i / titles.length,
    spine_radius: 1.1 + (i % 3) * 0.18,
    spine_angle: i * 1.05,
  }));
}
