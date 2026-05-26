// ----------------------------------------------------------------------------
// Verge — Next.js config
//
// What's in here that wasn't before (Phase 7 deploy hardening):
//   • Strict security headers on every response (HSTS, CSP, frame-deny, …)
//   • images.remotePatterns whitelisting Supabase Storage so <Image src=…>
//     works for user avatars
//   • Strip `console.*` calls from the production bundle (errors kept)
//   • poweredByHeader off, gzip on, ETags on
// ----------------------------------------------------------------------------

import { URL } from 'node:url';

// Derive the Supabase project hostname from the env var so the image
// allowlist always tracks whatever project this deploy points at. Falls
// back to a permissive *.supabase.co pattern if the var isn't set at
// build time (e.g. CI without env wired).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseHost = (() => {
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).hostname;
  } catch {
    return null;
  }
})();

const remotePatterns = [
  // Permissive fallback covers preview deploys + dev where the env isn't set.
  { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
];
if (supabaseHost && !supabaseHost.endsWith('.supabase.co')) {
  remotePatterns.push({
    protocol: 'https',
    hostname: supabaseHost,
    pathname: '/storage/v1/object/public/**',
  });
}

// Strict-but-workable CSP. `unsafe-inline` on style-src is needed because
// Next inlines critical CSS; `unsafe-eval` on script-src is needed by the
// R3F shader compiler (and tolerated only in development). The connect-src
// list includes Supabase + Sentry endpoints (if configured).
const cspDirectives = (isDev) => {
  const supabaseConnect = supabaseHost ? `https://${supabaseHost} wss://${supabaseHost}` : '';
  const sentryConnect =
    process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN
      ? 'https://*.ingest.sentry.io https://*.ingest.us.sentry.io'
      : '';

  return [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `img-src 'self' data: blob: https://*.supabase.co`,
    `media-src 'self' blob:`,
    `worker-src 'self' blob:`,
    `connect-src 'self' ${supabaseConnect} ${sentryConnect}`.trim(),
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    isDev ? '' : `upgrade-insecure-requests`,
  ]
    .filter(Boolean)
    .join('; ');
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,

  images: {
    remotePatterns,
    // Squeeze bandwidth — Supabase Storage doesn't transform images for us.
    formats: ['image/avif', 'image/webp'],
  },

  // Drop chatty client logs from production builds. Errors + warnings stay.
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? { exclude: ['error', 'warn'] }
        : false,
  },

  webpack: (config) => {
    config.module.rules.push({
      test: /\.(glsl|vs|fs|vert|frag)$/,
      exclude: /node_modules/,
      use: ['raw-loader'],
    });
    return config;
  },

  transpilePackages: ['three'],

  // Android Digital Asset Links must live at the canonical /.well-known
  // path. Next's file-system router can't host that prefix cleanly on
  // Windows, so we rewrite it into a normal /api route that builds the
  // JSON from env vars.
  async rewrites() {
    return [
      { source: '/.well-known/assetlinks.json', destination: '/api/assetlinks' },
    ];
  },

  async headers() {
    const isDev = process.env.NODE_ENV !== 'production';
    const baseSecurity = [
      // Lock the page out of being framed by anything else (clickjack).
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      {
        key: 'Permissions-Policy',
        value:
          'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()',
      },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
      { key: 'Content-Security-Policy', value: cspDirectives(isDev) },
    ];

    // HSTS only in production — wouldn't want a dev localhost pin.
    if (!isDev) {
      baseSecurity.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      });
    }

    return [
      {
        source: '/:path*',
        headers: baseSecurity,
      },
      {
        // Service worker must be re-fetched on every navigation so users
        // get the latest cache version after a deploy.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        // Long-cache hashed static assets.
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
