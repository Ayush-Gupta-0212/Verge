'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUserStore } from '@/stores/useUserStore';
import { getSupabaseBrowser } from '@/lib/supabase/client';

// ----------------------------------------------------------------------------
// /reset-password — finish-the-reset page.
//
// Flow:
//   1. User clicks "Forgot password?" on /login.
//   2. supabase.auth.resetPasswordForEmail() emails them with a magic link
//      that points at /reset-password.
//   3. Supabase auto-converts the URL token into a session on landing.
//   4. This page shows a "set a new password" form and calls updateUser.
//   5. On success → redirect to '/' (now authenticated with the new password).
//
// We give the auth listener up to 1.5s to populate the session before
// rendering the "your link is invalid" state — Supabase sometimes lands
// the session a beat after the page mounts.
// ----------------------------------------------------------------------------

export default function ResetPasswordClient() {
  const router = useRouter();
  const init = useUserStore((s) => s.init);
  const user = useUserStore((s) => s.user);
  const updatePassword = useUserStore((s) => s.updatePassword);
  const supabaseConfigured = !!getSupabaseBrowser();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Wait one beat for Supabase to materialise the session from the URL hash.
  const [sessionWaitDone, setSessionWaitDone] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    const id = window.setTimeout(() => setSessionWaitDone(true), 1500);
    return () => window.clearTimeout(id);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await updatePassword(password);
      if (error) {
        setError(error);
      } else {
        setInfo('Password updated. Sending you in…');
        window.setTimeout(() => router.push('/'), 700);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // If we're confident no session arrived from the link, show a friendly
  // "this link is invalid or expired" state with a return path.
  if (sessionWaitDone && !user && supabaseConfigured) {
    return (
      <div className="flex h-full w-full items-center justify-center px-4">
        <div className="card w-[min(92vw,440px)] p-9 text-center">
          <div className="text-[11px] uppercase tracking-[0.20em] text-amber font-semibold">
            Reset link expired
          </div>
          <h1 className="mt-3 font-display text-2xl font-light text-ink">
            This link can&apos;t be used.
          </h1>
          <p className="mt-3 text-sm text-ink-mute">
            It may have already been used, or it&apos;s more than an hour old.
            Request a fresh one and try again.
          </p>
          <Link
            href="/login"
            className="btn-amber mt-6 inline-block px-5 py-2 text-[11px] uppercase tracking-[0.16em]"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="card w-[min(92vw,440px)] p-9"
      >
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-[0.20em] text-amber font-semibold">
            Verge · Reset password
          </div>
          <h1 className="mt-3 font-display text-2xl font-light text-ink">
            Set a new password
          </h1>
          <p className="mt-1.5 text-sm text-ink-mute">
            Pick something at least 6 characters long.
          </p>
        </div>

        <div className="mt-7 space-y-3">
          <Field
            label="New password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 6 characters"
            autoComplete="new-password"
            required
          />
          <Field
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={setConfirm}
            placeholder="Same again"
            autoComplete="new-password"
            required
          />
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </p>
        )}
        {info && (
          <p className="mt-4 rounded-lg bg-amber/[0.08] px-3 py-2 text-xs text-amber">
            {info}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !supabaseConfigured}
          className="btn-amber mt-6 w-full disabled:opacity-50"
        >
          {submitting ? 'Updating…' : 'Update password'}
        </button>

        <Link
          href="/login"
          className="mt-4 block text-center text-xs text-ink-faint hover:text-amber transition-colors"
        >
          Back to sign in
        </Link>
      </form>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text', placeholder, autoComplete, required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-left">
      <span className="mb-1.5 block text-[11px] font-semibold tracking-[0.18em] uppercase text-ink-faint">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className="w-full rounded-xl border border-line bg-bg/60 px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-amber/40 focus:outline-none transition-colors"
      />
    </label>
  );
}
