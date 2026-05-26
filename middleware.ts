import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Auth routing middleware.
//   • If Supabase isn't configured, every route is allowed (seed/offline mode).
//   • If configured: unauthenticated visitors are pushed to /login;
//     authenticated visitors to /login are pushed to /.
//   • Static assets and API routes pass through untouched.
export async function middleware(request: NextRequest) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (
    path.startsWith('/_next') ||
    path.startsWith('/api') ||
    path === '/favicon.ico' ||
    path === '/sw.js' ||
    path === '/manifest.webmanifest' ||
    // Next 15 metadata routes — generated icons, apple-icon, opengraph-image, etc.
    path === '/icon' ||
    path.startsWith('/icon-') ||
    path.startsWith('/apple-icon') ||
    path.startsWith('/opengraph-image') ||
    path.startsWith('/twitter-image') ||
    // Public profile pages — anyone can view an opted-in user's profile.
    path.startsWith('/u/') ||
    // Legal pages — always readable, no auth required.
    path === '/privacy' ||
    path === '/terms' ||
    // Account-deletion instructions — required public URL for Play Store +
    // similar app-store policies. Must reach without a session.
    path === '/account-deletion' ||
    // Password reset callback — the user lands here from an email link with
    // a token that Supabase converts into a temporary session client-side.
    // Middleware must not redirect them away before that runs.
    path === '/reset-password' ||
    // Android Digital Asset Links — verifier hits this without any auth
    // context; must always be reachable so the TWA install can verify.
    path.startsWith('/.well-known/') ||
    /\.[a-zA-Z0-9]+$/.test(path) // any static asset (.svg, .png, etc.)
  ) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet: CookieToSet[]) {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && path !== '/login') {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (user && path === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }
  return response;
}

export const config = {
  // Run on every page route except Next internals and obvious static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
