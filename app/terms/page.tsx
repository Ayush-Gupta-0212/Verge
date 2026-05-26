import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms — Verge',
  description: 'Terms of use for Verge.',
};

const UPDATED = 'May 2026';

// Plain-English first-pass terms of service. Have a lawyer review before
// shipping to anyone outside your household — but the substance accurately
// reflects what the app does.
export default function TermsPage() {
  return (
    <main className="legal-page">
      <article>
        <header>
          <Link href="/" className="back-link">← Back to Verge</Link>
          <h1>Terms of Use</h1>
          <p className="updated">Last updated · {UPDATED}</p>
        </header>

        <section>
          <h2>What this is</h2>
          <p>
            Verge is a focused workspace for tasks, time, and deep work. By
            creating an account or using the service you agree to these terms.
            If you don't agree, please don't use Verge.
          </p>
        </section>

        <section>
          <h2>Your account</h2>
          <ul>
            <li>
              You're responsible for the email address and password you sign
              up with. Don't share your credentials. Tell us at{' '}
              <a href="mailto:hello@verge.app">hello@verge.app</a> if you
              suspect your account has been compromised.
            </li>
            <li>You must be at least 13 years old.</li>
            <li>
              We can suspend or close accounts that are used to harass other
              users, exploit the service, or violate the law.
            </li>
          </ul>
        </section>

        <section>
          <h2>Your content</h2>
          <p>
            The tasks, notes, schedules, avatars, and other content you put
            into Verge stay yours. By using the service you grant us a
            non-exclusive licence to store, display, and process that content
            for the sole purpose of providing Verge to you.
          </p>
          <p>
            If you opt your profile public (Astral → "Public profile"), the
            specific stats on that profile become visible to anyone with the
            link. You can disable public sharing at any time and the profile
            URL stops resolving.
          </p>
        </section>

        <section>
          <h2>Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use Verge to harass, threaten, or harm anyone.</li>
            <li>
              Upload content that infringes someone else's intellectual
              property or privacy.
            </li>
            <li>
              Attempt to break, probe, or overload the service (or anyone
              else's account).
            </li>
            <li>
              Use automated tools to scrape, mirror, or republish the
              service.
            </li>
          </ul>
        </section>

        <section>
          <h2>Availability</h2>
          <p>
            Verge is provided "as is". We do our best to keep it running
            and your data safe, but we don't guarantee uninterrupted
            service. Maintenance, outages, and infrastructure failures
            happen. Keep your own copy of data you can't afford to lose
            (Astral → Data &amp; account → "Export my data").
          </p>
        </section>

        <section>
          <h2>Termination</h2>
          <p>
            You can close your account at any time from Astral. Closure
            permanently deletes your data and revokes your credentials. We
            may close an account that violates these terms or applicable
            law; we'll give notice except where prompt action is needed to
            protect other users.
          </p>
        </section>

        <section>
          <h2>Liability</h2>
          <p>
            To the maximum extent permitted by law, Verge and its operator
            are not liable for indirect, incidental, or consequential damages
            arising out of your use of the service. Where liability cannot
            be excluded, it's capped at the greater of the amount you paid
            for the service in the last twelve months and USD $50.
          </p>
        </section>

        <section>
          <h2>Changes</h2>
          <p>
            We may update these terms from time to time. Material changes
            will be announced in the in-app changelog, and the "Last
            updated" date above will move forward. Continued use after a
            change means you accept the new version.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            Questions about these terms? Reach the operator at{' '}
            <a href="mailto:hello@verge.app">hello@verge.app</a>. (Replace
            this address with your real contact before you ship.)
          </p>
        </section>
      </article>
    </main>
  );
}
