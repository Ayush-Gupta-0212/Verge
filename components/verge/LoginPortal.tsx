'use client';

import { useEffect, useState } from 'react';
import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import FocusSphere from './FocusSphere';
import { useUserStore } from '@/stores/useUserStore';
import { getSupabaseBrowser } from '@/lib/supabase/client';

// ----------------------------------------------------------------------------
// Login portal — sign in, create account, magic link, forgot password, and
// the email-verification "check your inbox" state.
//
// We use a small `Screen` state machine so the form's contents swap cleanly
// when the user enters / leaves an alternate flow (forgot, verify-sent),
// without losing the email + password fields they may have typed.
// ----------------------------------------------------------------------------

type Mode = 'signIn' | 'signUp' | 'magic';
type Screen = 'form' | 'forgot' | 'verify' | 'resetSent';

export default function LoginPortal() {
  const router = useRouter();
  const init = useUserStore((s) => s.init);
  const user = useUserStore((s) => s.user);
  const signInWithPassword = useUserStore((s) => s.signInWithPassword);
  const signUpWithPassword = useUserStore((s) => s.signUpWithPassword);
  const signInWithMagicLink = useUserStore((s) => s.signInWithMagicLink);
  const sendPasswordResetEmail = useUserStore((s) => s.sendPasswordResetEmail);
  const resendConfirmationEmail = useUserStore((s) => s.resendConfirmationEmail);

  const supabaseConfigured = !!getSupabaseBrowser();

  const [screen, setScreen] = useState<Screen>('form');
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => { init(); }, [init]);

  useEffect(() => {
    if (user) router.push('/');
  }, [user, router]);

  const goTo = (s: Screen) => {
    setScreen(s);
    setError(null);
    setInfo(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!supabaseConfigured) {
      router.push('/');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signIn') {
        const { error } = await signInWithPassword(email, password);
        if (error) setError(error);
        else router.push('/');
      } else if (mode === 'signUp') {
        if (password.length < 6) {
          setError('Password must be at least 6 characters.');
          return;
        }
        const { error, needsConfirmation } = await signUpWithPassword(
          email,
          password,
          displayName || undefined,
        );
        if (error) setError(error);
        else if (needsConfirmation) {
          setPassword('');
          goTo('verify');
        } else {
          router.push('/');
        }
      } else {
        const { error } = await signInWithMagicLink(email);
        if (error) setError(error);
        else setInfo('Magic link sent. Check your inbox.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!email) {
      setError('Enter your email first.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await sendPasswordResetEmail(email);
      if (error) setError(error);
      else goTo('resetSent');
    } finally {
      setSubmitting(false);
    }
  };

  const resendVerify = async () => {
    setError(null);
    setInfo(null);
    if (!email) return;
    setSubmitting(true);
    try {
      const { error } = await resendConfirmationEmail(email);
      if (error) setError(error);
      else setInfo('Confirmation email re-sent.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Canvas
        gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping }}
        camera={{ position: [0, 0, 7], fov: 38 }}
        dpr={[1, 2]}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.35} />
        <directionalLight position={[-3, 3, 4]} intensity={0.6} color="#fff2e0" />
        <directionalLight position={[3, -2, -1]} intensity={0.35} color="#ff7a18" />
        <Suspense fallback={null}>
          <FocusSphere />
        </Suspense>
      </Canvas>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {/* ── 1) Email-verification screen ────────────────────────────── */}
        {screen === 'verify' && (
          <div className="card pointer-events-auto w-[min(92vw,440px)] p-9 text-center">
            <Brand />
            <div className="mt-6 inline-flex h-14 w-14 items-center justify-center rounded-full border border-amber/30 bg-amber/[0.08]">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-amber" fill="none">
                <path d="M3 7l9 6 9-6M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="mt-5 font-display text-2xl font-light text-ink">
              Check your inbox
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-mute">
              We sent a confirmation link to{' '}
              <span className="text-ink">{email || 'your email'}</span>. Click
              it from any device to finish setting up your Verge account.
            </p>
            {error && (
              <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
            )}
            {info && (
              <p className="mt-4 rounded-lg bg-amber/[0.08] px-3 py-2 text-xs text-amber">{info}</p>
            )}
            <div className="mt-6 flex flex-col items-center gap-3">
              <button
                onClick={resendVerify}
                disabled={submitting}
                className="btn-amber w-full disabled:opacity-50"
              >
                {submitting ? 'Sending…' : 'Resend email'}
              </button>
              <button
                onClick={() => { setMode('signIn'); goTo('form'); }}
                className="text-xs text-ink-faint hover:text-amber transition-colors"
              >
                Back to sign in
              </button>
            </div>
          </div>
        )}

        {/* ── 2) Reset-sent confirmation screen ───────────────────────── */}
        {screen === 'resetSent' && (
          <div className="card pointer-events-auto w-[min(92vw,440px)] p-9 text-center">
            <Brand />
            <div className="mt-6 inline-flex h-14 w-14 items-center justify-center rounded-full border border-amber/30 bg-amber/[0.08]">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-amber" fill="none">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <h1 className="mt-5 font-display text-2xl font-light text-ink">
              Reset link sent
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-mute">
              We emailed a link to{' '}
              <span className="text-ink">{email || 'your email'}</span>.
              Click it to set a new password.
            </p>
            <button
              onClick={() => { setMode('signIn'); goTo('form'); }}
              className="btn-amber mt-6 w-full"
            >
              Back to sign in
            </button>
          </div>
        )}

        {/* ── 3) Forgot-password form ─────────────────────────────────── */}
        {screen === 'forgot' && (
          <form
            onSubmit={submitForgot}
            className="card pointer-events-auto w-[min(92vw,440px)] p-9"
          >
            <div className="text-center">
              <Brand />
              <h1 className="mt-5 font-display text-2xl font-light text-ink">
                Forgot your password?
              </h1>
              <p className="mt-1.5 text-sm text-ink-mute">
                Enter your email and we&apos;ll send a reset link.
              </p>
            </div>
            <div className="mt-7 space-y-3">
              <Field
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="you@somewhere.cosmos"
                autoComplete="email"
                required
              />
            </div>
            {error && (
              <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
            )}
            <button
              type="submit"
              disabled={submitting || !supabaseConfigured}
              className="btn-amber mt-6 w-full disabled:opacity-50"
            >
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
            <button
              type="button"
              onClick={() => { setMode('signIn'); goTo('form'); }}
              className="mt-4 block w-full text-center text-xs text-ink-faint hover:text-amber transition-colors"
            >
              Back to sign in
            </button>
          </form>
        )}

        {/* ── 4) Main login / signup / magic form ─────────────────────── */}
        {screen === 'form' && (
          <form
            onSubmit={submit}
            className="card pointer-events-auto w-[min(92vw,440px)] p-9"
          >
            <div className="text-center">
              <Brand />
              <h1 className="mt-5 font-display text-2xl font-light text-ink">
                {mode === 'signUp' ? 'Create your account' :
                 mode === 'magic'  ? 'Send a magic link'    :
                                     'Step into the flow'}
              </h1>
              <p className="mt-1.5 text-sm text-ink-mute">
                {supabaseConfigured
                  ? 'A sliver of light, then time bends.'
                  : 'Running offline — enter to continue.'}
              </p>
            </div>

            {/* Mode tabs */}
            {supabaseConfigured && (
              <div className="mt-7 inline-flex w-full rounded-full bg-white/[0.04] p-1">
                {([
                  ['signIn', 'Sign in'],
                  ['signUp', 'Create'],
                ] as Array<[Mode, string]>).map(([m, label]) => (
                  <button
                    type="button"
                    key={m}
                    onClick={() => { setMode(m); setError(null); setInfo(null); }}
                    className={clsx(
                      'flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors',
                      mode === m
                        ? 'bg-amber/[0.14] text-amber'
                        : 'text-ink-mute hover:text-ink',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-5 space-y-3">
              {mode === 'signUp' && supabaseConfigured && (
                <Field
                  label="Display name"
                  value={displayName}
                  onChange={setDisplayName}
                  placeholder="What should we call you?"
                  autoComplete="name"
                />
              )}
              <Field
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="you@somewhere.cosmos"
                autoComplete="email"
                required
              />
              {mode !== 'magic' && supabaseConfigured && (
                <Field
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder={mode === 'signUp' ? 'At least 6 characters' : '••••••••'}
                  autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                  required
                />
              )}
            </div>

            {/* Forgot password — only on Sign-in mode, only when configured.
                Anchored just below the password field, full-width-ish so it
                can't be missed under the input. */}
            {mode === 'signIn' && supabaseConfigured && (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => goTo('forgot')}
                  className="rounded-md px-2 py-1 text-sm font-medium text-amber/85 underline decoration-amber/35 underline-offset-2 transition-colors hover:bg-amber/[0.06] hover:text-amber hover:decoration-amber"
                >
                  Forgot password?
                </button>
              </div>
            )}

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
              disabled={submitting}
              className="btn-amber mt-6 w-full disabled:opacity-50"
            >
              {submitting
                ? 'Aligning…'
                : !supabaseConfigured
                ? 'Enter offline'
                : mode === 'signIn'
                ? 'Sign in'
                : mode === 'signUp'
                ? 'Create account'
                : 'Send magic link'}
            </button>

            {/* Legal consent line — only on Create. Quietly persistent so the
                user has fair notice before they tap Create. */}
            {supabaseConfigured && mode === 'signUp' && (
              <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-faint">
                By creating an account you agree to our{' '}
                <Link href="/terms" className="text-ink-mute hover:text-amber transition-colors">
                  Terms
                </Link>{' '}
                and{' '}
                <Link href="/privacy" className="text-ink-mute hover:text-amber transition-colors">
                  Privacy Policy
                </Link>
                .
              </p>
            )}

            {supabaseConfigured && mode !== 'magic' && (
              <button
                type="button"
                onClick={() => { setMode('magic'); setError(null); setInfo(null); }}
                className="mt-4 block w-full text-center text-xs text-ink-faint hover:text-amber transition-colors"
              >
                Or send me a magic link instead
              </button>
            )}
            {supabaseConfigured && mode === 'magic' && (
              <button
                type="button"
                onClick={() => { setMode('signIn'); setError(null); setInfo(null); }}
                className="mt-4 block w-full text-center text-xs text-ink-faint hover:text-amber transition-colors"
              >
                Back to password sign-in
              </button>
            )}
          </form>
        )}
      </div>
    </>
  );
}

function Brand() {
  return (
    <div className="flex flex-col items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="Verge"
        width={80}
        height={80}
        className="h-20 w-20 object-contain"
      />
      <span className="font-display text-2xl font-light tracking-tight text-amber">
        Verge
      </span>
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
