import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { Subtask } from '@/lib/types';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { useUserStore } from '@/stores/useUserStore';
import { toastError } from '@/stores/useToastStore';

// Subtask checklist store — items belong to a parent task. We hold the full
// list for the user in memory; consumers filter by task_id at read time.

interface SubtaskState {
  subtasks: Subtask[];
  loading: boolean;
  load: () => Promise<void>;
  add: (taskId: string, title: string) => Promise<Subtask | null>;
  toggle: (id: string) => Promise<void>;
  update: (id: string, patch: Partial<Subtask>) => Promise<void>;
  // Reorder a parent task's subtasks. Pass the new ordered ids; persists
  // 100-step `position` values so future drag-betweens have headroom.
  reorder: (taskId: string, orderedIds: string[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  // Used when the parent task is deleted — keeps local state in sync without
  // waiting for the DB cascade to roundtrip.
  clearForTask: (taskId: string) => void;
}

export const useSubtaskStore = create<SubtaskState>((set, get) => ({
  subtasks: [],
  loading: false,

  load: async () => {
    set({ loading: true });
    const supabase = getSupabaseBrowser();
    const user = useUserStore.getState().user;

    if (!supabase || !user) {
      set({ subtasks: [], loading: false });
      return;
    }

    const { data, error } = await supabase
      .from('task_subtasks')
      .select('*')
      .eq('user_id', user.id)
      .order('position',   { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('[verge] load subtasks:', error.message);
      set({ subtasks: [], loading: false });
      return;
    }
    set({ subtasks: (data ?? []) as Subtask[], loading: false });
  },

  add: async (taskId, title) => {
    const trimmed = title.trim();
    if (!trimmed) return null;

    const user = useUserStore.getState().user;
    const existing = get().subtasks.filter((s) => s.task_id === taskId);
    const maxPos = existing.length
      ? Math.max(...existing.map((s) => s.position))
      : -1;

    const sub: Subtask = {
      id: uuid(),
      task_id: taskId,
      user_id: user?.id ?? null,
      title: trimmed,
      completed_at: null,
      position: maxPos + 1,
      created_at: new Date().toISOString(),
    };
    set((s) => ({ subtasks: [...s.subtasks, sub] }));

    const supabase = getSupabaseBrowser();
    if (supabase && user) {
      const { error } = await supabase.from('task_subtasks').insert(sub);
      if (error) {
        console.warn('[verge] add subtask:', error.message);
        toastError(`Couldn't add subtask — ${error.message}`);
      }
    }
    return sub;
  },

  toggle: async (id) => {
    const sub = get().subtasks.find((s) => s.id === id);
    if (!sub) return;
    const next = sub.completed_at ? null : new Date().toISOString();
    await get().update(id, { completed_at: next });
  },

  update: async (id, patch) => {
    set((s) => ({
      subtasks: s.subtasks.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }));
    const supabase = getSupabaseBrowser();
    const user = useUserStore.getState().user;
    if (supabase && user) {
      const { error } = await supabase
        .from('task_subtasks')
        .update(patch)
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) {
        console.warn('[verge] update subtask:', error.message);
        toastError(`Couldn't update subtask — ${error.message}`);
      }
    }
  },

  reorder: async (taskId, orderedIds) => {
    const positions = new Map<string, number>();
    orderedIds.forEach((id, i) => positions.set(id, (i + 1) * 100));

    set((s) => ({
      subtasks: s.subtasks.map((x) =>
        x.task_id === taskId && positions.has(x.id)
          ? { ...x, position: positions.get(x.id)! }
          : x,
      ),
    }));

    const supabase = getSupabaseBrowser();
    const user = useUserStore.getState().user;
    if (!supabase || !user) return;
    const results = await Promise.all(
      orderedIds.map((id) =>
        supabase
          .from('task_subtasks')
          .update({ position: positions.get(id)! })
          .eq('id', id)
          .eq('user_id', user.id),
      ),
    );
    const firstErr = results.find((r) => r.error)?.error;
    if (firstErr) {
      toastError(`Couldn't save subtask order — ${firstErr.message}`);
    }
  },

  remove: async (id) => {
    set((s) => ({ subtasks: s.subtasks.filter((x) => x.id !== id) }));
    const supabase = getSupabaseBrowser();
    const user = useUserStore.getState().user;
    if (supabase && user) {
      const { error } = await supabase
        .from('task_subtasks')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) {
        console.warn('[verge] remove subtask:', error.message);
        toastError(`Couldn't delete subtask — ${error.message}`);
      }
    }
  },

  clearForTask: (taskId) => {
    set((s) => ({
      subtasks: s.subtasks.filter((x) => x.task_id !== taskId),
    }));
  },
}));

// Convenience selectors for consumers.
export function subtasksForTask(all: Subtask[], taskId: string): Subtask[] {
  return all
    .filter((s) => s.task_id === taskId)
    .sort(
      (a, b) =>
        a.position - b.position ||
        (a.created_at ?? '').localeCompare(b.created_at ?? ''),
    );
}

export function subtaskProgress(all: Subtask[], taskId: string) {
  const items = subtasksForTask(all, taskId);
  const total = items.length;
  const done = items.filter((s) => s.completed_at).length;
  return { total, done };
}
