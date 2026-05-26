import type { MetadataRoute } from 'next';

// ----------------------------------------------------------------------------
// Web app manifest — Next 15 serves this at /manifest.webmanifest and auto-
// injects <link rel="manifest"> in the <head>.
//
// Tuned for app-store quality (TWA / Bubblewrap / PWABuilder):
//   • `id`                          — stable identity even if start_url ever changes
//   • `display_override`            — graceful fallback chain across browsers
//   • `prefer_related_applications` — keep our PWA install banner showing instead of
//                                     redirecting to a Play Store entry we don't own yet
//   • icons                          — both 192 and 512 listed, plus a `maskable`
//                                     purpose so Android can clip to the adaptive-icon
//                                     mask without white bars
//   • `shortcuts`                    — three deep-links for the launcher long-press menu
//
// TODO before Play Store submission:
//   • Re-export the icon at a true 192×192 PNG (currently both sizes point at
//     /icon.png which is 512×512 — Chrome downscales it fine, but a dedicated
//     192 is sharper).
//   • Capture two real screenshots (phone 1080×1920 and desktop 1920×1080),
//     drop them in /public/screenshots/, and uncomment the `screenshots` block
//     below — Play Store uses these in the rich install card.
// ----------------------------------------------------------------------------

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Verge — Time, distilled.',
    short_name: 'Verge',
    description:
      'A focused, immersive workspace for tasks, time and deep work.',
    lang: 'en',
    dir: 'ltr',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui', 'browser'],
    orientation: 'portrait',
    background_color: '#0a0807',
    theme_color: '#ff8a3d',
    categories: ['productivity', 'utilities', 'lifestyle'],

    // Block the Android install banner from offering "the related native app"
    // — we ARE the native app (wrapped via TWA). Without this, some browsers
    // try to steer the user to a Play Store entry we'd have to actively
    // maintain even before the TWA exists.
    prefer_related_applications: false,

    icons: [
      // 192 — required by Chrome/Android for the legacy launcher icon.
      // Points at the 512 source for now; Chrome downscales cleanly.
      {
        src: '/icon.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      // 512 — required for high-density launchers + Play Store splash.
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],

    // Long-press the installed app's launcher icon → these jump straight
    // into the matching view. Same icons for now; per-shortcut artwork is
    // nice-to-have but not required.
    shortcuts: [
      {
        name: 'Start focus session',
        short_name: 'Focus',
        description: 'Open the immersive Pomodoro timer.',
        url: '/?source=pwa&action=focus',
        icons: [{ src: '/icon.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Open Nexus (tasks)',
        short_name: 'Tasks',
        description: 'Jump straight into your task scheduler.',
        url: '/?source=pwa&view=nexus',
        icons: [{ src: '/icon.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Open Chronos (calendar)',
        short_name: 'Calendar',
        description: 'Plan your week.',
        url: '/?source=pwa&view=chronos',
        icons: [{ src: '/icon.png', sizes: '192x192', type: 'image/png' }],
      },
    ],

    // Uncomment + drop matching files in /public/screenshots/ before
    // submitting to the Play Store. Phone first (form_factor:'narrow'),
    // then desktop (form_factor:'wide') — Chrome's rich install card uses
    // them in that order.
    //
    // screenshots: [
    //   {
    //     src: '/screenshots/phone-flow.png',
    //     sizes: '1080x1920',
    //     type: 'image/png',
    //     form_factor: 'narrow',
    //     label: 'Daily dashboard',
    //   },
    //   {
    //     src: '/screenshots/desktop-chronos.png',
    //     sizes: '1920x1080',
    //     type: 'image/png',
    //     form_factor: 'wide',
    //     label: 'Calendar planning',
    //   },
    // ],
  };
}
