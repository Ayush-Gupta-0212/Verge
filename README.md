# Verge

> A focused, immersive workspace for tasks, time and deep work.

Verge is a single-canvas time-management space — a left-rail nav holds
five views (Flow, Chronos, Nexus, Vault, Astral), and a focus overlay can
take over the screen for guided deep work. Backed by Supabase (Postgres +
Auth + Storage + RLS) when configured; falls back to in-memory seed data
when not, so the scene is never empty.

## Stack

- **Next.js 15** (App Router, middleware-based auth routing) + **React 19**
- **React Three Fiber** v9 + **drei** v10 for the 3D layer
- Hand-rolled GLSL for the focus sphere (matte dark + amber fresnel rim)
- **Zustand** for global state (UI, tasks, schedule, timer, user)
- **Web Worker** so the focus timer keeps ticking when the tab is backgrounded
- **Service Worker** for offline shell + Web Push + notification-click routing
- **Supabase** with Row Level Security, Storage buckets for avatars, and
  trigger-driven profile auto-create + constellation-star awards
- **Tailwind CSS** with CSS-var-driven accent colours (amber / violet / aurora)

## Local development

```bash
cp .env.local.example .env.local   # optional — fill in Supabase keys
npm install
npm run dev
```

Visit <http://localhost:3000>.

Without Supabase env vars (the default `.env.local.example`), Verge runs
in **seed mode**: every store fills itself with example data, auth is
bypassed, the login page just lets you click in. Useful for exploring the
UI without setting up a backend.

With Supabase env vars wired (see below), the middleware enforces auth —
unauthenticated visitors are pushed to `/login`, signed-in visitors away
from it.

## Wiring Supabase (real auth + per-user data)

1. **Create a project** at <https://supabase.com>. Pick a region close to
   your users; the free tier is enough for a small launch.
2. **Run the schema.** SQL editor → New query → paste
   `lib/supabase/schema.sql` → Run. This is the single canonical schema
   file — every CREATE/ALTER is idempotent, so re-running it after a
   pull is the recommended way to stay in sync.
3. **Copy the keys.** Project settings → API:
   - `URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only — used
     by `/api/account/delete` to actually remove the auth.users row)
4. **(Optional, for dev)** Auth → Providers → Email → turn off "Confirm
   email" so signups land you straight into the app without an inbox
   round-trip.
5. **Configure redirects.** Auth → URL Configuration → add your production
   domain (or `http://localhost:3000` for dev) to the allowed list.
6. Restart `npm run dev` and create an account.

### Environment variables

| Variable                            | Required | Used by                              |
| ----------------------------------- | -------- | ------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`          | yes      | Browser + server Supabase clients     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`     | yes      | Browser + server Supabase clients     |
| `SUPABASE_SERVICE_ROLE_KEY`         | no\*     | `/api/account/delete` (full deletes)  |
| `NEXT_PUBLIC_SENTRY_DSN`            | no       | Browser error reporting               |
| `SENTRY_DSN`                        | no       | Server/route error reporting          |
| `NEXT_PUBLIC_APP_URL`               | no       | OG/share-card absolute URLs           |
| `NEXT_PUBLIC_APP_ENV`               | no       | Telemetry environment tag             |

\* Without the service-role key, deletion still wipes the user's data
rows but leaves the `auth.users` row in place; an operator has to clean
it up manually.

## Deploying to production

These steps assume Vercel; the same shape works on Fly, Railway, Render,
or self-hosted Node.

1. **Push to GitHub** (or whichever Git host the platform supports).
2. **Import the repo** into Vercel → Framework preset auto-detects as
   Next.js. No build-command overrides needed.
3. **Set the env vars** above in the project's "Environment Variables"
   panel. Mark `SUPABASE_SERVICE_ROLE_KEY` and `SENTRY_DSN` as
   **production-only** if you don't want them in preview deploys.
4. **Add your domain** in Supabase → Auth → URL Configuration so the
   magic-link / password-reset callback URLs work in production.
5. **Deploy.** The `prebuild` hook auto-bumps the service-worker cache
   version (see `scripts/bump-sw-version.mjs`), so returning users get
   the new bundle on first reload — no manual SW unregister required.
6. **Verify** by visiting `/privacy`, `/terms`, `/login`, signing up
   with a throwaway email, then deleting the account from Astral. If
   the auth row goes away in Supabase → Auth → Users, the service-role
   key is wired correctly.

### Security headers

`next.config.mjs` ships a strict CSP, `X-Frame-Options: DENY`,
`Strict-Transport-Security`, `Referrer-Policy`, and a `Permissions-Policy`
that disables camera / mic / geolocation / interest-cohort by default.
Test the result with <https://securityheaders.com> after deploy.

### Telemetry (optional)

Setting `NEXT_PUBLIC_SENTRY_DSN` and/or `SENTRY_DSN` enables a
zero-dependency reporter in `lib/telemetry.ts` that ships browser +
server errors via the Sentry envelope protocol. Works with Sentry,
Glitchtip, BugSink, or any DSN-compatible endpoint. Without those env
vars set, the reporter is a no-op and emits no network requests.

### Android app (Trusted Web Activity)

Verge is built as a real PWA, so the fastest path to an Android app is
a TWA wrapper around the deployed site. Two routes:

- **[PWABuilder](https://www.pwabuilder.com/)** (web UI): paste your
  deployed URL → "Package for Android" → download the signed `.aab`.
- **[Bubblewrap CLI](https://github.com/GoogleChromeLabs/bubblewrap)**:
  `npx @bubblewrap/cli init --manifest=https://your-domain/manifest.webmanifest`
  → opens an Android Studio project you can customize.

Either tool will give you the **package name** (e.g. `app.verge.twa`) and
the **SHA-256 fingerprint** of the signing key. Put both into Vercel's
environment variables as `TWA_PACKAGE_NAME` and `TWA_SHA256_FINGERPRINTS`
(comma-separated if you have multiple — debug + prod), then redeploy.

The site already exposes `/.well-known/assetlinks.json` (via a rewrite to
`/api/assetlinks`) which Android's verifier uses to confirm the app + site
pair. Once the fingerprints match, Chrome inside the TWA drops the URL bar
and the app looks fully native.

`app/manifest.ts` is already tuned for app-store quality: stable `id`,
192 + 512 icons (regular + maskable), `prefer_related_applications: false`,
and three launcher shortcuts (Focus / Tasks / Calendar). Before submitting
to the Play Store, drop two screenshots in `/public/screenshots/` and
uncomment the `screenshots` block at the bottom of the manifest.

## Repo layout

```
app/
  layout.tsx              Root + Inter font + theme-colour viewport
  page.tsx                Home — renders <Canvas/> + <HUD/>
  login/page.tsx          Login portal (email+password, magic link)
  privacy/page.tsx        Privacy policy
  terms/page.tsx          Terms of use
  u/[slug]/page.tsx       Public profile (opt-in)
  api/
    tasks/route.ts        Read/insert tasks (cookie-auth Supabase)
    sessions/route.ts     Read/insert timer sessions
    account/delete/route  Real cascade-delete using service-role key
    share-week/route.tsx  Image-response card (1080×1920) for sharing
middleware.ts             Auth routing + public-path allowlist

components/
  verge/                  R3F (Canvas, FocusSphere, TimeSpine, Login)
  ui/                     HTML overlays positioned over the Canvas
  shaders/fluidSphere.ts  Matte dark + amber fresnel rim shader

lib/
  types.ts                Shared types
  insights.ts             Streak, focus heatmap, tag-rollup, estimates
  rrule.ts                Lightweight recurrence (daily/weekly/monthly)
  achievements.ts         Badge registry + earned predicates
  fuzzy.ts                Command-palette ranking
  telemetry.ts            Sentry-envelope reporter (env-gated)
  notifications.ts        Quiet-hours-aware Notification API wrapper
  workers/
    timer.worker.ts       Wall-clock-anchored focus timer
    useTimerWorker.ts     React hook wiring worker → store
  supabase/
    schema.sql            Canonical Postgres schema (idempotent)
    client.ts             Browser client (singleton, nullable)
    server.ts             Server client for route handlers + middleware

stores/
  useUserStore.ts         Auth, profile, constellation, achievements
  useTaskStore.ts         Tasks (load/add/update/complete/remove)
  useSubtaskStore.ts      Subtasks under each task
  useScheduleStore.ts     Schedule events (load/upsert/move/clear)
  useTimerStore.ts        Timer state (worker is authority for elapsed)
  useUIStore.ts           View, focus mode, search, scroll, pointer
  useToastStore.ts        Toast + undo helper

scripts/
  bump-sw-version.mjs     Stamps a fresh cache name into public/sw.js
                          before every build (wired as `prebuild`)
public/
  sw.js                   Service worker (cache, push, click router)
  logo.png / logo-256.png Brand mark
```

## Views

| View       | What it is                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------ |
| **Flow**   | Welcome dashboard — greeting, today's metric tiles, quick CTA into focus                   |
| **Chronos**| Week / Month tabbed timetable. Drag-drop, click-to-edit, subtask progress chip per event   |
| **Nexus**  | Daily resonance + active streams (left), 3D TimeSpine (centre), selected task + focus CTA  |
| **Vault**  | Crystallised tasks + lifetime focus stats                                                   |
| **Astral** | Profile, accent picker, public-profile toggle, achievements, rich analytics, data controls  |
| **Focus**  | Fullscreen immersion overlay — guided breathing on the dark sphere, Pomodoro break loop    |

## Keyboard

| Shortcut         | Action                                          |
| ---------------- | ----------------------------------------------- |
| `Cmd/Ctrl + K`   | Open command palette                            |
| `Esc`            | Exit focus mode / close palette                 |
| `?`              | Open shortcuts overlay                          |
| `Tab`            | Cycle focusable HUD controls                    |
| `1 – 5`          | Jump between Flow / Chronos / Nexus / Vault / Astral |

## Notes

- The R3F canvas is `alpha: true` and transparent — the CSS plus-mark
  grid + amber ground glow on `body` provides the ambient backdrop.
- Reduced motion: respects `prefers-reduced-motion` from the OS plus an
  in-app override toggle in Astral (driven by `<html data-reduced-motion>`).
- Supabase writes are best-effort from the client — local state is the
  source of truth for instant UI. Cloud is the durable backup, RLS keeps
  rows owner-only on the database side.
