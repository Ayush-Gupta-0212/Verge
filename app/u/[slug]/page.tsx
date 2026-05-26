import { notFound } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import type { Metadata } from 'next';

// Public profile — read-only Astral-style card for a user who's opted in.
// No client-side interactivity, no Verge app shell — just a single page
// showcasing the user's headline numbers, with the share-week image as the
// og:image / twitter:image so links unfurl nicely.

export const revalidate = 60; // 1-minute ISR — public, low-write-rate data

interface PageProps {
  params: Promise<{ slug: string }>;
}

interface PublicProfile {
  display_name: string;
  avatar_url: string | null;
  accent: 'amber' | 'violet' | 'aurora';
  focus_hours: number;
  done_count: number;
  streak: number;
}

async function loadPublicProfile(slug: string): Promise<PublicProfile | null> {
  const supabase = await getSupabaseServer();
  if (!supabase) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, accent, public_enabled')
    .eq('public_slug', slug)
    .eq('public_enabled', true)
    .maybeSingle();
  if (!profile) return null;

  // Compute headline stats from the past 30 days of focus sessions + tasks.
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const [{ data: history }, { data: tasks }] = await Promise.all([
    supabase
      .from('timer_sessions')
      .select('duration_ms,started_at,kind')
      .eq('user_id', profile.id)
      .gte('started_at', since30),
    supabase
      .from('tasks')
      .select('completed_at')
      .eq('user_id', profile.id)
      .gte('completed_at', since30),
  ]);

  // Streak: walk back from today through unique focus days
  const focusDays = new Set<string>();
  (history ?? [])
    .filter((s) => s.kind === 'focus' && s.duration_ms >= 60_000)
    .forEach((s) => focusDays.add(s.started_at.slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!focusDays.has(cursor.toISOString().slice(0, 10))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (focusDays.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const focusMs = (history ?? [])
    .filter((s) => s.kind === 'focus')
    .reduce((a, s) => a + s.duration_ms, 0);

  return {
    display_name: profile.display_name ?? 'Stargazer',
    avatar_url:   profile.avatar_url   ?? null,
    accent:       (profile.accent ?? 'amber') as PublicProfile['accent'],
    focus_hours:  Number((focusMs / 3_600_000).toFixed(1)),
    done_count:   (tasks ?? []).filter((t) => t.completed_at).length,
    streak,
  };
}

const ACCENT_HEX: Record<PublicProfile['accent'], string> = {
  amber:  '#ff8a3d',
  violet: '#b77aff',
  aurora: '#5ae6b4',
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const profile = await loadPublicProfile(slug);
  if (!profile) return { title: 'Verge' };

  const ogUrl = `/api/share-week?${new URLSearchParams({
    name:   profile.display_name,
    hours:  String(profile.focus_hours),
    done:   String(profile.done_count),
    streak: String(profile.streak),
    accent: ACCENT_HEX[profile.accent].slice(1),
  })}`;

  return {
    title: `${profile.display_name} on Verge`,
    description: `${profile.focus_hours}h focused · ${profile.done_count} tasks crystallised · ${profile.streak}-day streak`,
    openGraph: { images: [ogUrl] },
    twitter:   { card: 'summary_large_image', images: [ogUrl] },
  };
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const profile = await loadPublicProfile(slug);
  if (!profile) notFound();

  const accent = ACCENT_HEX[profile.accent];

  return (
    <main
      data-accent={profile.accent}
      className="flex min-h-screen items-center justify-center bg-bg px-6 py-12"
      style={{
        backgroundImage: `radial-gradient(circle at 50% 110%, ${accent}26, transparent 55%)`,
      }}
    >
      <div className="card w-[min(96vw,560px)] p-8 md:p-12">
        <div className="flex flex-col items-center text-center">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt=""
              className="h-24 w-24 rounded-full object-cover ring-2 ring-amber/50"
            />
          ) : (
            <div
              className="h-24 w-24 rounded-full ring-2 ring-amber/40"
              style={{
                background: `radial-gradient(circle at 30% 25%, ${accent}, ${accent}33)`,
              }}
            />
          )}
          <h1 className="mt-5 font-display text-3xl font-light text-ink">
            {profile.display_name}
          </h1>
          <div className="mt-1 text-xs text-ink-faint tracking-[0.16em] uppercase">
            on Verge — last 30 days
          </div>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-4">
          <Stat value={`${profile.focus_hours}h`} label="Focused" accent={accent} />
          <Stat value={profile.done_count.toString()} label="Cleared" accent={accent} />
          <Stat value={`${profile.streak}`}        label="Streak" accent={accent} />
        </div>

        <div className="mt-10 flex items-center justify-center gap-2 text-xs text-ink-faint">
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-md font-bold"
            style={{ background: accent, color: '#0a0807' }}
          >
            V
          </span>
          <span className="tracking-[0.18em] uppercase">verge — time, distilled.</span>
        </div>

        <div className="mt-6 flex items-center justify-center gap-3 text-[10px] uppercase tracking-[0.16em] text-ink-faint">
          <a href="/" className="hover:text-amber transition-colors">Sign in</a>
          <span aria-hidden className="opacity-40">·</span>
          <a href="/privacy" className="hover:text-amber transition-colors">Privacy</a>
          <span aria-hidden className="opacity-40">·</span>
          <a href="/terms" className="hover:text-amber transition-colors">Terms</a>
        </div>
      </div>
    </main>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-line bg-bg/60 px-2 py-4">
      <span className="font-display text-3xl tabular-nums" style={{ color: accent }}>
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">{label}</span>
    </div>
  );
}
