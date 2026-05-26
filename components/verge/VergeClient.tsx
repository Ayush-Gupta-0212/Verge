'use client';

// Client-side dynamic import boundary. Next 15 requires `ssr: false` dynamic
// imports to be declared from a Client Component, so this thin wrapper lives
// here and is the only thing the Server Component page imports.
import dynamic from 'next/dynamic';

const VergeCanvas = dynamic(() => import('./VergeCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-obsidian-900 text-iridescent">
      <span className="animate-breathe text-sm tracking-[0.4em] uppercase">
        Calibrating the cosmos…
      </span>
    </div>
  ),
});

export default VergeCanvas;
