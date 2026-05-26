import { create } from 'zustand';
import type { View } from '@/lib/types';

interface UIState {
  view: View;
  focusMode: boolean;
  selectedTaskId: string | null;
  // Shared search query — set by the top bar, consumed by any view that
  // wants to filter its content (currently Chronos).
  search: string;
  scroll: number;
  scrollVelocity: number;
  pointer: { x: number; y: number };
  setView: (v: View) => void;
  toggleFocus: () => void;
  setFocus: (b: boolean) => void;
  selectTask: (id: string | null) => void;
  setSearch: (q: string) => void;
  bumpScroll: (delta: number) => void;
  tickScroll: (dt: number) => void;
  setPointer: (x: number, y: number) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  // Flow is the welcome dashboard (greeting, today's tiles, quick CTA into
  // focus) — the natural landing for a fresh sign-in. Nexus was the
  // original default back when the 3D TimeSpine was the headline feature,
  // but Flow has been the better first-screen since the dashboard landed.
  view: 'flow',
  focusMode: false,
  selectedTaskId: null,
  search: '',
  scroll: 0.5,
  scrollVelocity: 0,
  pointer: { x: 0, y: 0 },
  setView: (v) => set({ view: v, search: '' }),    // clear search on view change
  toggleFocus: () => set((s) => ({ focusMode: !s.focusMode })),
  setFocus: (b) => set({ focusMode: b }),
  selectTask: (id) => set({ selectedTaskId: id }),
  setSearch: (q) => set({ search: q }),
  bumpScroll: (delta) =>
    set((s) => ({ scrollVelocity: s.scrollVelocity + delta })),
  tickScroll: (dt) => {
    const { scroll, scrollVelocity } = get();
    const damping = Math.exp(-dt * 3.2);
    const newVel = scrollVelocity * damping;
    const spring = (0.5 - scroll) * dt * 0.4;
    const next = Math.max(0, Math.min(1, scroll + newVel + spring));
    set({ scroll: next, scrollVelocity: newVel });
  },
  setPointer: (x, y) => {
    const { pointer } = get();
    set({
      pointer: {
        x: pointer.x + (x - pointer.x) * 0.18,
        y: pointer.y + (y - pointer.y) * 0.18,
      },
    });
  },
}));
