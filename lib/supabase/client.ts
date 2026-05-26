'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

// Returns a singleton browser client, or null if env vars are missing.
// Stores fall back to in-memory seed data when this returns null, so the
// scene still runs locally without any backend configured.
let cached: SupabaseClient | null | undefined;

export function getSupabaseBrowser(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    cached = null;
    if (typeof window !== 'undefined') {
      console.info(
        '[verge] Supabase env not configured — running in offline seed mode.',
      );
    }
    return null;
  }
  cached = createBrowserClient(url, key);
  return cached;
}
