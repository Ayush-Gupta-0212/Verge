import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Delete your Verge account — Verge',
  description:
    'How to permanently delete your Verge account and all associated data.',
};

const UPDATED = 'May 2026';

// Public account-deletion instructions page.
// Required by Google Play (and similar app-store policies): a URL accessible
// without authentication that explains the deletion procedure, what data is
// removed, and what's retained. Linked from the manifest, the privacy
// policy, and the Play Store listing.
export default function AccountDeletionPage() {
  return (
    <main className="legal-page">
      <article>
        <header>
          <Link href="/" className="back-link">← Back to Verge</Link>
          <h1>Delete your Verge account</h1>
          <p className="updated">Last updated · {UPDATED}</p>
        </header>

        <section>
          <h2>About Verge</h2>
          <p>
            Verge is a focused workspace for tasks, time, and deep work,
            published by the Verge team. This page explains how to permanently
            delete your Verge account and every piece of data tied to it.
          </p>
        </section>

        <section>
          <h2>How to delete your account (recommended)</h2>
          <p>
            Account deletion is built into the app and takes about ten seconds.
            You stay in control — no support ticket required.
          </p>
          <ol>
            <li>
              Sign in at <a href="/login">/login</a> with the email and password
              for the account you want to delete.
            </li>
            <li>
              Open the <strong>Astral</strong> view (rightmost icon in the left
              sidebar on desktop, or the rightmost tab in the bottom bar on
              mobile).
            </li>
            <li>
              Scroll to the bottom of the page and find the{' '}
              <strong>Data &amp; account</strong> panel.
            </li>
            <li>
              In the right-hand <strong>Delete account</strong> card, click{' '}
              <strong>Delete my account</strong>.
            </li>
            <li>
              Type <code>DELETE</code> into the confirmation field, then click{' '}
              <strong>Delete forever</strong>.
            </li>
          </ol>
          <p>
            Deletion is immediate. You will be signed out and returned to the
            login screen.
          </p>
        </section>

        <section>
          <h2>Don't have access to your account?</h2>
          <p>
            If you've lost your password, use the{' '}
            <strong>Forgot password?</strong> link on the login page to reset
            it, then follow the steps above.
          </p>
          <p>
            If you no longer have access to the email address on the account,
            email us at{' '}
            <a href="mailto:hello@verge.app">hello@verge.app</a> from any
            address. Include the original sign-up email so we can identify
            the account. We will verify your identity and complete the
            deletion on your behalf within five business days.
          </p>
        </section>

        <section>
          <h2>What gets deleted</h2>
          <p>
            When you delete your account, every row tied to your user ID is
            removed from our database in a single transaction. That includes:
          </p>
          <ul>
            <li>
              <strong>Profile</strong> — display name, avatar, accent colour,
              notification + sound preferences, daily and weekly goals,
              streak ledger.
            </li>
            <li>
              <strong>Tasks and subtasks</strong> — every task you've created,
              completed, or archived, including notes, tags, recurrence rules,
              and snooze state.
            </li>
            <li>
              <strong>Schedule events</strong> — every calendar event on
              Chronos, including recurring series.
            </li>
            <li>
              <strong>Focus sessions</strong> — every Pomodoro / stopwatch
              entry in your history.
            </li>
            <li>
              <strong>Achievements</strong> — every badge you've earned.
            </li>
            <li>
              <strong>Constellation stars</strong> — the visual record of
              completed tasks shown on Astral.
            </li>
            <li>
              <strong>Avatar image</strong> — your uploaded profile photo,
              removed from object storage.
            </li>
            <li>
              <strong>Push subscriptions</strong> — any device-level Web Push
              endpoints registered for notifications.
            </li>
            <li>
              <strong>Authentication credentials</strong> — your email,
              hashed password, and any active session tokens. After this step
              the email address can be re-used to sign up for a new account if
              you ever want to.
            </li>
          </ul>
        </section>

        <section>
          <h2>What we retain</h2>
          <p>
            Because backups exist to protect against accidental data loss,
            some data may temporarily persist after the user-visible
            deletion:
          </p>
          <ul>
            <li>
              <strong>Database backups</strong> — Supabase, our database
              provider, retains daily snapshots for up to <strong>7 days</strong>{' '}
              on the free tier and up to <strong>30 days</strong> on paid
              tiers. Your data is purged from these snapshots according to
              that rolling window. We do not access these snapshots
              proactively.
            </li>
            <li>
              <strong>Server logs</strong> — request logs (timestamp, URL,
              status code, IP address) are retained for up to{' '}
              <strong>30 days</strong> for security and debugging purposes,
              then automatically discarded. Logs do not contain the contents
              of your tasks, events, or notes.
            </li>
            <li>
              <strong>Aggregated, anonymous metrics</strong> — totals such as
              "number of monthly active users" remain in counters that cannot
              be linked back to you.
            </li>
          </ul>
          <p>
            We do <strong>not</strong> retain copies of your tasks,
            schedule, focus sessions, or any personally identifying
            information beyond the retention windows above. We do not sell or
            transfer any of this data to third parties.
          </p>
        </section>

        <section>
          <h2>Want a copy first?</h2>
          <p>
            Deletion is permanent and cannot be reversed. If you want to keep
            a record of your tasks and focus history, use the{' '}
            <strong>Export my data</strong> button on the same{' '}
            <strong>Data &amp; account</strong> panel before deleting. You'll
            get a single JSON file containing every row tied to your account.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            Questions about deletion or data handling?{' '}
            <a href="mailto:hello@verge.app">hello@verge.app</a>.
          </p>
          <p>
            For our full data-handling policy, see the{' '}
            <Link href="/privacy">Privacy Policy</Link>. For the terms
            governing use of Verge, see the{' '}
            <Link href="/terms">Terms of Use</Link>.
          </p>
        </section>
      </article>
    </main>
  );
}
