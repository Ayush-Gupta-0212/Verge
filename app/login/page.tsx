import Link from 'next/link';
import LoginPortal from '@/components/verge/LoginPortalClient';

export default function LoginPage() {
  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <LoginPortal />
      {/* Anchored bottom-centre — small, low-contrast so it never competes
          with the portal itself. Required link for transparency at sign-up. */}
      <footer
        className="
          pointer-events-auto absolute inset-x-0 bottom-4 z-30
          flex items-center justify-center gap-4
          text-[11px] uppercase tracking-[0.18em] text-ink-faint
        "
      >
        <Link href="/privacy" className="hover:text-amber transition-colors">
          Privacy
        </Link>
        <span aria-hidden className="opacity-40">·</span>
        <Link href="/terms" className="hover:text-amber transition-colors">
          Terms
        </Link>
      </footer>
    </main>
  );
}
