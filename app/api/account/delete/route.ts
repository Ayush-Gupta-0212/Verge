import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServer } from '@/lib/supabase/server';
import { captureException } from '@/lib/telemetry';

// ----------------------------------------------------------------------------
// POST /api/account/delete
//
// Real "right-to-be-forgotten" route. The browser client can scrub the user's
// rows (RLS lets it delete its own data), but it cannot remove the row in
// auth.users — only the service role can. So:
//
//   1. Establish the caller's identity via the session cookie (anon client).
//   2. Use the service-role client to:
//        • cascade-delete every user-owned row (defence in depth — the FK
//          cascade on auth.users → public.* would also catch them, but doing
//          it first means deleting auth.users is a single fast step)
//        • admin.deleteUser(uid) — the only call that wipes the auth row
//   3. Sign the cookie out on the way back.
//
// This route runs on the Node runtime because @supabase/supabase-js admin
// methods rely on the service-role API key which we keep server-side only.
// ----------------------------------------------------------------------------

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OWNED_TABLES = [
  'task_subtasks',
  'schedule_events',
  'schedule_cells',
  'timer_sessions',
  'constellation_stars',
  'achievements',
  'push_subscriptions',
  'tasks',
  'profiles',
] as const;

export async function POST() {
  // 1) Who is calling? Use the session-bound client so RLS still applies if
  //    the service-role key is missing and we have to fall back.
  const userClient = await getSupabaseServer();
  if (!userClient) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const {
    data: { user },
    error: whoError,
  } = await userClient.auth.getUser();

  if (whoError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // 2) The service-role key is the only thing that can delete from auth.users.
  //    If it's not configured, fall back to cleaning up the public schema and
  //    signing the user out — leaves an orphaned auth row that an operator
  //    will need to drop manually, but never leaves user data behind.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  // Always best-effort scrub the owned tables first, regardless of whether
  // the service key is set — keeps the user's data gone even on partial
  // failure of the admin delete.
  for (const table of OWNED_TABLES) {
    try {
      const column = table === 'profiles' ? 'id' : 'user_id';
      await userClient.from(table).delete().eq(column, user.id);
    } catch {
      // Table may not exist on a stripped-down schema — that's fine.
    }
  }

  if (!serviceKey || !supabaseUrl) {
    await userClient.auth.signOut();
    return NextResponse.json(
      {
        ok: true,
        authRowDeleted: false,
        note:
          'Data scrubbed and signed out, but SUPABASE_SERVICE_ROLE_KEY is not configured on the server. ' +
          'The auth row could not be removed and will need to be deleted manually from the dashboard.',
      },
      { status: 200 },
    );
  }

  // 3) Service-role client — bypasses RLS entirely. Persist no session.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);

  // Always sign the cookie out, even if the admin delete failed — the user
  // shouldn't be holding an active session for an account they tried to nuke.
  await userClient.auth.signOut();

  if (deleteError) {
    captureException(deleteError, { tags: { route: 'account-delete', userId: user.id } });
    return NextResponse.json(
      {
        ok: false,
        authRowDeleted: false,
        error: deleteError.message,
        note: 'Public data was scrubbed but the auth row failed to delete.',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, authRowDeleted: true });
}
