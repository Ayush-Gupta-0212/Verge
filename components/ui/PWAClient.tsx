'use client';

import { useEffect, useRef } from 'react';
import { toastInfo, toastSuccess } from '@/stores/useToastStore';

// Registers the service worker once on mount and surfaces online/offline
// transitions as toasts. Mount once at the HUD root.
//
// SW registration is skipped in dev to avoid clashing with Next's HMR and
// to keep the dev experience predictable.

export default function PWAClient() {
  const offlineRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Service worker — registered in prod for caching + notifications, and
    // ALSO in dev when the page is hosted (not file://) so the notification
    // action buttons can be tested without a prod build. We still skip the
    // shell cache from poisoning HMR by detecting and bypassing /_next/*
    // and /api/* inside the SW.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) =>
          console.warn('[verge] SW register failed:', err?.message ?? err),
        );
    }

    // Online / offline indicators.
    offlineRef.current = typeof navigator !== 'undefined' && !navigator.onLine;
    const onOnline = () => {
      if (offlineRef.current) {
        toastSuccess('Back online. Changes will sync.');
      }
      offlineRef.current = false;
    };
    const onOffline = () => {
      offlineRef.current = true;
      toastInfo('Working offline. Changes save locally.');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return null;
}
