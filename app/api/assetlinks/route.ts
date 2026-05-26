import { NextResponse } from 'next/server';

// ----------------------------------------------------------------------------
// /api/assetlinks
//
// Returns the Android Digital Asset Links JSON that Chrome/Android uses to
// verify the TWA's package name + signing key actually belong to this domain.
// Mounted at the canonical /.well-known/assetlinks.json path via a rewrite
// in next.config.mjs (Next's file-system router doesn't love a literal
// `.well-known` folder on Windows).
//
// Config:
//   TWA_PACKAGE_NAME           Android package id, e.g. "app.verge.twa"
//   TWA_SHA256_FINGERPRINTS    Comma-separated SHA-256 fingerprints of every
//                              signing cert that should be trusted (debug +
//                              prod, or just prod after you switch). Each
//                              fingerprint is the colon-separated 32-byte hex
//                              you get from:
//                                keytool -list -v -keystore <keystore.jks> \
//                                  -alias <alias>
//                              or from Play Console → Setup → App integrity →
//                              App signing key certificate.
//
// Returns `[]` (empty list) when either env var is missing — Android will
// then refuse to trust the wrapper, which is the correct behaviour for a
// half-configured deploy. Set both vars on Vercel, redeploy, then verify by
// curling https://your-domain/.well-known/assetlinks.json.
// ----------------------------------------------------------------------------

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AssetLinkStatement {
  relation: string[];
  target: {
    namespace: 'android_app';
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}

function parseFingerprints(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[A-F0-9]{2}(:[A-F0-9]{2}){31}$/i.test(s));
}

export async function GET() {
  const packageName = process.env.TWA_PACKAGE_NAME?.trim();
  const fingerprints = parseFingerprints(process.env.TWA_SHA256_FINGERPRINTS);

  const statements: AssetLinkStatement[] =
    packageName && fingerprints.length > 0
      ? [
          {
            // `handle_all_urls` lets the TWA open all in-scope URLs without
            // showing the browser's URL bar. Without it, Chrome falls back
            // to "Custom Tab" mode and the user sees an address strip.
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: packageName,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [];

  return NextResponse.json(statements, {
    headers: {
      // Android fetches this once and re-checks rarely; let the CDN cache
      // it for an hour so the verifier isn't hitting the function on every
      // app launch.
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Content-Type': 'application/json',
    },
  });
}
