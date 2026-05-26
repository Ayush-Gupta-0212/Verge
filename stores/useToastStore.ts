import { create } from 'zustand';
import { v4 as uuid } from 'uuid';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: number;
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  push: (t: {
    kind: ToastKind;
    message: string;
    ttlMs?: number;
    action?: ToastAction;
  }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DEFAULT_TTL = 4000;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: ({ kind, message, ttlMs = DEFAULT_TTL, action }) => {
    const id = uuid();
    set((s) => ({
      toasts: [...s.toasts, { id, kind, message, createdAt: Date.now(), action }],
    }));
    if (ttlMs > 0 && typeof window !== 'undefined') {
      setTimeout(() => get().dismiss(id), ttlMs);
    }
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

// Module-level helpers so non-React code (stores) can dispatch toasts.
export function toastError(message: string): void {
  useToastStore.getState().push({ kind: 'error', message });
}
export function toastSuccess(message: string): void {
  useToastStore.getState().push({ kind: 'success', message });
}
export function toastInfo(message: string): void {
  useToastStore.getState().push({ kind: 'info', message });
}

// Undo-style toast — info-toned, longer-lived, with an action button. The
// onClick is called once on tap and the toast auto-dismisses afterwards.
// Default 6s TTL gives the user time to react without lingering forever.
export function toastUndo(
  message: string,
  onUndo: () => void,
  ttlMs = 6000,
): string {
  const store = useToastStore.getState();
  let id = '';
  id = store.push({
    kind: 'info',
    message,
    ttlMs,
    action: {
      label: 'Undo',
      onClick: () => {
        onUndo();
        useToastStore.getState().dismiss(id);
      },
    },
  });
  return id;
}
