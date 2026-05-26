// ----------------------------------------------------------------------------
// Verge — changelog registry.
//
// Every shipping version that introduces user-visible changes gets a row in
// CHANGELOG. ChangelogModal compares the current bundle's version against the
// last seen value in localStorage and pops a small dismissable card with the
// new bullets — once per (user × device × version).
//
// Authoring rules:
//   • Most-recent entry first.
//   • Keep each bullet to one line. The audience is users, not maintainers.
//   • Bump version below in lock-step with package.json on a release that
//     ships something the user would notice. Bug-only releases can skip.
//
// To find the current version at runtime we use the build-time env var
// NEXT_PUBLIC_APP_VERSION when present, falling back to a hard-coded
// constant here. (Vercel/Render typically inject git SHA or package
// version; locally it falls back to APP_VERSION below.)
// ----------------------------------------------------------------------------

export interface ChangelogEntry {
  version: string;     // semver, e.g. "0.2.0"
  date: string;        // ISO date, e.g. "2026-05-19"
  title: string;       // short headline, ≤ 40 chars
  bullets: string[];   // 2–4 bullets, one-liners
}

export const APP_VERSION = '0.2.0';

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.2.0',
    date: '2026-05-19',
    title: 'Onboarding, exports, real account delete',
    bullets: [
      'New welcome tour + starter tasks for fresh sign-ups.',
      'Download the Week and Month views as a PNG from Chronos.',
      'Account deletion now fully wipes data + auth (no orphans).',
      'Privacy + Terms pages, security headers, telemetry shim.',
    ],
  },
];

export function getCurrentAppVersion(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION || APP_VERSION;
}
