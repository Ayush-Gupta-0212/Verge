import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy — Verge',
  description: 'How Verge handles your data.',
};

const UPDATED = 'May 2026';

// Plain-English first-pass privacy policy. The author should review this with
// a lawyer before deploying to anyone outside their household, but it covers
// the actual data flows accurately so it's a solid starting point.
export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <article>
        <header>
          <Link href="/" className="back-link">← Back to Verge</Link>
          <h1>Privacy Policy</h1>
          <p className="updated">Last updated · {UPDATED}</p>
        </header>

        <section>
          <h2>The short version</h2>
          <p>
            Verge is a workspace for tasks, time, and focused work. We store the
            data you create — tasks, schedule entries, timer sessions,
            achievements, and your account profile — so it's there when you
            sign back in. We don't sell that data, we don't share it with
            advertisers, and we don't build cross-site profiles. If you ever
            want it back or want it gone, you can do both yourself from inside
            the app.
          </p>
        </section>

        <section>
          <h2>What we store</h2>
          <ul>
            <li>
              <strong>Account.</strong> Email address and an encrypted password
              hash (handled by Supabase Auth). Optional display name and avatar
              you choose to upload.
            </li>
            <li>
              <strong>Your work.</strong> Tasks, subtasks, schedule events,
              focus / timer sessions, achievements, and the constellation
              stars awarded by completing tasks.
            </li>
            <li>
              <strong>Preferences.</strong> Daily goal, focus and break length,
              quiet hours, sounds, reduced-motion choice, accent colour.
            </li>
            <li>
              <strong>Web push subscription</strong> (only if you opted in). A
              browser-provided endpoint we POST to when a notification fires.
            </li>
            <li>
              <strong>Crash reports</strong> (only if telemetry is configured).
              Stack traces and the URL that crashed, attributed to your user
              ID. No DOM contents, no form values.
            </li>
          </ul>
        </section>

        <section>
          <h2>What we don't do</h2>
          <ul>
            <li>No third-party advertising. No ad pixels.</li>
            <li>No cross-site tracking. No fingerprinting.</li>
            <li>No selling, renting, or trading your data.</li>
            <li>
              No reading the contents of your tasks for any purpose other than
              displaying them back to you.
            </li>
          </ul>
        </section>

        <section>
          <h2>Where it lives</h2>
          <p>
            Your data is stored in a Postgres database operated by Supabase.
            Row Level Security means the database itself rejects queries for
            rows that don't belong to your user ID — even a compromised app
            server can't read another user's data. Avatars are stored in a
            Supabase Storage bucket; the URL is public but only the owner
            (you) can upload, replace, or delete.
          </p>
        </section>

        <section>
          <h2>Your controls</h2>
          <ul>
            <li>
              <strong>Export.</strong> Astral → Data &amp; account → "Export my
              data". You get a JSON file with every row tied to your account.
            </li>
            <li>
              <strong>Delete.</strong> Same screen → "Delete account". We scrub
              every row you own and remove your authentication credentials.
              This is permanent. Full instructions at{' '}
              <Link href="/account-deletion">/account-deletion</Link>.
            </li>
            <li>
              <strong>Public profile.</strong> Off by default. If you opt in,
              one URL (<code>/u/&lt;your-slug&gt;</code>) shows your headline
              stats. Disable it any time.
            </li>
            <li>
              <strong>Notifications.</strong> Browser push is off by default
              and requires explicit permission. Quiet hours and per-trigger
              toggles are in Astral.
            </li>
          </ul>
        </section>

        <section>
          <h2>Cookies</h2>
          <p>
            We set one cookie: the Supabase session cookie that keeps you
            signed in. It's required for the app to work. No analytics
            cookies, no marketing cookies.
          </p>
        </section>

        <section>
          <h2>Children</h2>
          <p>
            Verge is not directed at children under 13. If you are a parent
            or guardian and believe your child has signed up, contact us and
            we'll remove the account.
          </p>
        </section>

        <section>
          <h2>Changes</h2>
          <p>
            If this policy changes materially, the in-app changelog will note
            it and the "Last updated" date above will move forward.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            Questions about this policy, or about how your data is handled?
            Reach the operator at <a href="mailto:hello@verge.app">hello@verge.app</a>.
            (Replace this address with your real contact before you ship.)
          </p>
        </section>
      </article>
    </main>
  );
}
