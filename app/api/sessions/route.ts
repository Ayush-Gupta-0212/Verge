import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';

export const runtime = 'edge';

export async function POST(req: Request) {
  const supabase = await getSupabaseServer();
  if (!supabase) return NextResponse.json({ error: 'supabase not configured' }, { status: 503 });
  const body = await req.json();
  const { data, error } = await supabase
    .from('timer_sessions')
    .insert(body)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ session: data });
}
