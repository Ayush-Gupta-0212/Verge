import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { ConstellationStar, Preferences, Profile } from '@/lib/types';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { toastError, toastInfo, toastSuccess } from '@/stores/useToastStore';
import { ACHIEVEMENTS } from '@/lib/achievements';

export interface VergeUser {
  id: string;
  email: string;
}

interface UserState {
  user: VergeUser | null;
  session: Session | null;
  profile: Profile | null;
  stars: ConstellationStar[];
  // Set of achievement keys this user has earned. Loaded from Supabase on
  // sign-in; reconcileAchievements() inserts any newly-qualified rows.
  achievements: Set<string>;
  authReady: boolean;          // true once we've checked for a session at least once
  loading: boolean;

  // Initialisation — wires up the Supabase auth listener. Idempotent.
  init: () => void;

  // Auth actions
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithPassword: (email: string, password: string, displayName?: string) =>
    Promise<{ error: string | null; needsConfirmation: boolean }>;
  signInWithMagicLink: (email: string) => Promise<{ error: string | null }>;
  // Send a "reset your password" email. The link Supabase emails lands on
  // /reset-password (via emailRedirectTo) with a token Supabase auto-converts
  // into an active session — at which point updatePassword can finish the job.
  sendPasswordResetEmail: (email: string) => Promise<{ error: string | null }>;
  // Set a new password for the currently-signed-in session (typically the
  // throwaway session that landed via the reset-link callback).
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  // Re-send the email-confirmation message for an unconfirmed account.
  // Surfaces from the email-verification screen so the user isn't stranded.
  resendConfirmationEmail: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;

  // Profile + constellation
  fetchProfile: () => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  updatePreferences: (prefs: Preferences) => Promise<void>;
  uploadAvatar: (file: File) => Promise<{ url: string | null; error: string | null }>;
  removeAvatar: () => Promise<void>;
  loadConstellation: () => Promise<void>;
  awardStar: (taskId: string) => void;
  setUser: (u: VergeUser | null) => void;

  // Achievements lifecycle.
  loadAchievements: () => Promise<void>;
  // Compare the user's current stats against the registry; insert any newly
  // earned rows. Toasts the title of each new badge so the moment isn't
  // invisible.
  reconcileAchievements: (earnedKeys: string[]) => Promise<void>;

  // Phase 6 — trust surface.
  // Bundles every user-owned row into a JSON object the caller can save
  // locally. Includes profile, tasks, subtasks, schedule events, sessions,
  // stars, and achievements.
  exportAccountData: () => Promise<Record<string, unknown> | null>;
  // Best-effort cascade delete + sign-out. Returns true on success.
  // RLS + ON DELETE CASCADE handle the row-level cleanup; we also wipe
  // any localStorage state we own so nothing's left behind on the device.
  deleteAccount: () => Promise<boolean>;
}

// Deterministic placement on a unit sphere.
function fibSphere(index: number, total: number): [number, number, number] {
  const phi = Math.acos(1 - (2 * (index + 0.5)) / Math.max(total, 1));
  const theta = Math.PI * (1 + Math.sqrt(5)) * index;
  return [
    Math.sin(phi) * Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
  ];
}

let authSubscribed = false;

// Postgres "column doesn't exist" detection used by updatePreferences to
// gracefully fall back when the user's DB is missing Phase 1+ columns.
function isMissingProfileColumn(err: { code?: string | null; message: string }): boolean {
  if (err.code === 'PGRST204' || err.code === '42703') return true;
  return /column .* does not exist|could not find the .* column/i.test(err.message);
}

// Parses the column name out of either Postgres or PostgREST error messages.
// Returns null if it can't determine the column.
function parseMissingColumn(message: string): string | null {
  // PostgREST: "Could not find the 'sounds_enabled' column of 'profiles' in the schema cache"
  let m = message.match(/Could not find the '([^']+)' column/i);
  if (m) return m[1];
  // Postgres: "column profiles.foo does not exist"  or  "column \"foo\" does not exist"
  m = message.match(/column\s+(?:[a-zA-Z_][\w.]*\.)?["']?([a-zA-Z_][\w]*)["']?\s+does not exist/i);
  return m ? m[1] : null;
}

// Show the "your schema is outdated" toast at most once per session.
let schemaDriftWarned = false;
function warnSchemaDriftOnce(): void {
  if (schemaDriftWarned) return;
  schemaDriftWarned = true;
  toastError(
    'Some preferences need a schema update — run lib/supabase/migration-all.sql in your Supabase SQL editor to unlock them.',
  );
}

export const useUserStore = create<UserState>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  stars: [],
  achievements: new Set<string>(),
  authReady: false,
  loading: false,

  init: () => {
    if (authSubscribed) return;
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      // Seed / offline mode — no auth, still mark ready.
      set({ authReady: true });
      authSubscribed = true;
      return;
    }
    authSubscribed = true;

    // INITIAL_SESSION fires immediately with the current state.
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        set({
          session,
          user: { id: session.user.id, email: session.user.email ?? '' },
          authReady: true,
        });
        get().fetchProfile();
      } else {
        set({
          session: null,
          user: null,
          profile: null,
          stars: [],
          authReady: true,
        });
      }
    });
  },

  signInWithPassword: async (email, password) => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return { error: 'Supabase is not configured.' };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  },

  signUpWithPassword: async (email, password, displayName) => {
    const supabase = getSupabaseBrowser();
    if (!supabase)
      return { error: 'Supabase is not configured.', needsConfirmation: false };
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo:
          typeof window !== 'undefined' ? window.location.origin : undefined,
        data: displayName ? { display_name: displayName } : undefined,
      },
    });
    if (error) return { error: error.message, needsConfirmation: false };
    return { error: null, needsConfirmation: !data.session };
  },

  signInWithMagicLink: async (email) => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return { error: 'Supabase is not configured.' };
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    });
    return { error: error?.message ?? null };
  },

  sendPasswordResetEmail: async (email) => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return { error: 'Supabase is not configured.' };
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo:
        typeof window !== 'undefined'
          ? `${window.location.origin}/reset-password`
          : undefined,
    });
    return { error: error?.message ?? null };
  },

  updatePassword: async (newPassword) => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return { error: 'Supabase is not configured.' };
    if (!newPassword || newPassword.length < 6) {
      return { error: 'Password must be at least 6 characters.' };
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  },

  resendConfirmationEmail: async (email) => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return { error: 'Supabase is not configured.' };
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo:
          typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    });
    return { error: error?.message ?? null };
  },

  signOut: async () => {
    const supabase = getSupabaseBrowser();
    if (supabase) await supabase.auth.signOut();
    set({ session: null, user: null, profile: null, stars: [] });
  },

  fetchProfile: async () => {
    const supabase = getSupabaseBrowser();
    const user = get().user;
    if (!supabase || !user) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    if (error) {
      console.warn('[verge] profile fetch:', error.message);
      return;
    }
    if (data) {
      set({ profile: data as Profile });
    } else {
      // Schema's signup trigger may not be installed — backfill a row so the
      // UI has a name to show.
      const display_name = user.email.split('@')[0] || 'Stargazer';
      const { error: upsertErr } = await supabase
        .from('profiles')
        .upsert({ id: user.id, display_name });
      if (!upsertErr) set({ profile: { id: user.id, display_name } });
    }
  },

  updateDisplayName: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await get().updatePreferences({ display_name: trimmed });
  },

  // Patch any preference (goals, day window, notification flags, display name).
  // Optimistic — local state updates immediately, Supabase write follows.
  //
  // Schema fallback: if the user's DB is missing one of the optional columns
  // (Phase 1+ migrations not applied yet), Postgres returns PGRST204/42703.
  // We then drop the columns Postgres complained about (parsed from the
  // error message) and retry once. The optimistic local update stays — the
  // user's toggle visually works — and a single warning toast points at the
  // migration. This stops the error-spam loop the streak-freeze effect was
  // triggering when its column didn't exist.
  updatePreferences: async (prefs) => {
    const supabase = getSupabaseBrowser();
    const user = get().user;
    set((s) => ({
      profile: s.profile ? ({ ...s.profile, ...prefs } as Profile) : s.profile,
    }));
    if (!supabase || !user) return;

    const trySave = async (
      payload: Record<string, unknown>,
    ): Promise<{ error: { message: string; code?: string | null } | null }> => {
      return supabase.from('profiles').update(payload).eq('id', user.id);
    };

    let payload: Record<string, unknown> = { ...prefs };
    let attempt = 0;
    // At most a few rounds — each drops the column Postgres complained about
    // and retries. Bails out if nothing remains to write.
    while (attempt < 6) {
      attempt++;
      if (Object.keys(payload).length === 0) return;
      const { error } = await trySave(payload);
      if (!error) return;

      if (!isMissingProfileColumn(error)) {
        console.warn('[verge] updatePreferences:', error.message);
        toastError(`Couldn't save settings — ${error.message}`);
        return;
      }
      const missing = parseMissingColumn(error.message);
      if (!missing || !(missing in payload)) {
        // Couldn't isolate which column — warn once + give up so we don't
        // loop forever.
        warnSchemaDriftOnce();
        return;
      }
      delete payload[missing];
      // Loop back and retry without the missing column.
    }
    warnSchemaDriftOnce();
  },

  // Upload (or replace) the user's display photo. Stored at
  //   avatars/<user_id>/avatar.<ext>
  // Returns the public URL on success, error message on failure. The cache-
  // busting `?t=…` suffix forces <img> to re-fetch after a replace.
  uploadAvatar: async (file) => {
    const supabase = getSupabaseBrowser();
    const user = get().user;
    if (!supabase || !user) {
      return { url: null, error: 'Not signed in.' };
    }
    if (!file.type.startsWith('image/')) {
      const msg = 'Please choose an image file.';
      toastError(msg);
      return { url: null, error: msg };
    }
    const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_BYTES) {
      const msg = 'Image is too large (max 5 MB).';
      toastError(msg);
      return { url: null, error: msg };
    }

    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${user.id}/avatar.${ext || 'png'}`;

    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) {
      const hint =
        /not.?found|bucket/i.test(upErr.message)
          ? ' — run lib/supabase/migration-avatars.sql in the SQL editor first.'
          : '';
      const msg = `${upErr.message}${hint}`;
      toastError(`Couldn't upload photo — ${msg}`);
      return { url: null, error: msg };
    }

    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
    const url = `${pub.publicUrl}?t=${Date.now()}`;
    await get().updatePreferences({ avatar_url: url });
    return { url, error: null };
  },

  removeAvatar: async () => {
    const supabase = getSupabaseBrowser();
    const user = get().user;
    if (!supabase || !user) return;
    // Best-effort wipe — the file might not exist if the row was edited
    // manually. We still clear the URL on the profile either way.
    const exts = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
    await Promise.all(
      exts.map((e) =>
        supabase.storage.from('avatars').remove([`${user.id}/avatar.${e}`]),
      ),
    );
    await get().updatePreferences({ avatar_url: null });
  },

  loadConstellation: async () => {
    set({ loading: true });
    const supabase = getSupabaseBrowser();
    const user = get().user;

    if (!supabase) {
      // Seed mode — generate a starter constellation so the view isn't empty.
      const seed: ConstellationStar[] = Array.from({ length: 24 }).map((_, i) => ({
        id: `seed-${i}`,
        task_id: `seed-task-${i}`,
        position: fibSphere(i, 48),
        intensity: 0.4 + Math.random() * 0.5,
        earned_at: new Date(Date.now() - i * 3600000).toISOString(),
      }));
      set({ loading: false, stars: seed });
      return;
    }

    if (!user) {
      set({ loading: false, stars: [] });
      return;
    }

    const { data } = await supabase
      .from('constellation_stars')
      .select('*')
      .eq('user_id', user.id);
    set({ loading: false, stars: (data ?? []) as ConstellationStar[] });
  },

  awardStar: (taskId) => {
    const { stars, user } = get();
    // Use a deterministic id matching the DB trigger so the optimistic insert
    // is idempotent with whatever the server writes.
    const star: ConstellationStar = {
      id: `star-${taskId}`,
      user_id: user?.id ?? null,
      task_id: taskId,
      position: fibSphere(stars.length, Math.max(stars.length + 1, 32)),
      intensity: 0.7 + Math.random() * 0.3,
      earned_at: new Date().toISOString(),
    };
    // Skip if we already have this one (avoid double-award on re-complete).
    if (stars.some((s) => s.id === star.id)) return;
    set({ stars: [...stars, star] });
    const supabase = getSupabaseBrowser();
    if (supabase && user) {
      supabase.from('constellation_stars').upsert(star);
    }
  },

  setUser: (u) => set({ user: u }),

  loadAchievements: async () => {
    const supabase = getSupabaseBrowser();
    const user = get().user;
    if (!supabase || !user) {
      set({ achievements: new Set() });
      return;
    }
    const { data, error } = await supabase
      .from('achievements')
      .select('key')
      .eq('user_id', user.id);
    if (error) {
      // Table missing → user hasn't run migration-phase2.sql yet. Don't
      // crash; just leave the set empty so the UI can degrade gracefully.
      return;
    }
    set({
      achievements: new Set((data ?? []).map((r: { key: string }) => r.key)),
    });
  },

  reconcileAchievements: async (earnedKeys) => {
    const have = get().achievements;
    const fresh = earnedKeys.filter((k) => !have.has(k));
    if (fresh.length === 0) return;

    // Optimistic — show the badge immediately + toast each new title.
    const merged = new Set(have);
    fresh.forEach((k) => merged.add(k));
    set({ achievements: merged });

    fresh.forEach((k) => {
      const a = ACHIEVEMENTS.find((x) => x.key === k);
      if (a) toastInfo(`Badge unlocked — ${a.title}.`);
    });

    const supabase = getSupabaseBrowser();
    const user = get().user;
    if (!supabase || !user) return;
    const rows = fresh.map((key) => ({ user_id: user.id, key }));
    const { error } = await supabase
      .from('achievements')
      .upsert(rows, { onConflict: 'user_id,key' });
    if (error) {
      // Don't roll back the local set — the user has visually earned it.
      // The next loadAchievements will re-sync if needed.
      console.warn('[verge] reconcileAchievements:', error.message);
    }
  },

  exportAccountData: async () => {
    const supabase = getSupabaseBrowser();
    const user = get().user;
    if (!supabase || !user) return null;

    // Pull every table the user owns. Failures are swallowed per-table —
    // a missing column on an old schema shouldn't tank the whole export.
    const safe = async (q: PromiseLike<{ data: unknown[] | null; error: unknown }>) => {
      try {
        const { data, error } = await q;
        return error ? [] : (data ?? []);
      } catch {
        return [];
      }
    };

    const [profile, tasks, subtasks, events, sessions, stars, achievements] =
      await Promise.all([
        safe(supabase.from('profiles').select('*').eq('id', user.id)),
        safe(supabase.from('tasks').select('*').eq('user_id', user.id)),
        safe(supabase.from('task_subtasks').select('*').eq('user_id', user.id)),
        safe(supabase.from('schedule_events').select('*').eq('user_id', user.id)),
        safe(supabase.from('timer_sessions').select('*').eq('user_id', user.id)),
        safe(supabase.from('constellation_stars').select('*').eq('user_id', user.id)),
        safe(supabase.from('achievements').select('*').eq('user_id', user.id)),
      ]);

    return {
      schema_version: 'verge-export-1',
      exported_at:    new Date().toISOString(),
      user: { id: user.id, email: user.email },
      profile:        Array.isArray(profile) ? profile[0] ?? null : null,
      tasks,
      subtasks,
      schedule_events: events,
      timer_sessions:  sessions,
      constellation_stars: stars,
      achievements,
    };
  },

  deleteAccount: async () => {
    const supabase = getSupabaseBrowser();
    const user = get().user;
    if (!supabase || !user) return false;

    // Real deletion now happens on the server via /api/account/delete, which
    // uses the service-role key to actually wipe the auth.users row in
    // addition to the cascade of public rows. The browser client cannot do
    // that step — it has no access to admin.deleteUser.
    let serverOk = false;
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        authRowDeleted?: boolean;
      };
      serverOk = res.ok && body.ok === true;
    } catch {
      // Network failure — fall through to local cleanup so the device at
      // least forgets the session.
    }

    // Wipe device-local state Verge owns. Always run, even on partial
    // server failure — the user asked to be forgotten on this device.
    if (typeof window !== 'undefined') {
      try {
        const keys: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith('verge:')) keys.push(k);
        }
        keys.forEach((k) => window.localStorage.removeItem(k));
      } catch { /* ignore */ }
    }

    // The server already signed us out via the cookie, but the browser
    // client keeps its own in-memory copy — clear that too.
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore — cookie may already be gone */
    }

    set({ user: null, session: null, profile: null, stars: [], achievements: new Set() });
    return serverOk;
  },
}));
