// ----------------------------------------------------------------------------
// Verge — telemetry / error reporter.
//
// Zero-dependency Sentry-compatible error reporter. Implements just enough
// of the Sentry envelope protocol that any DSN-style endpoint (Sentry,
// Glitchtip, BugSink, GoatCounter-with-the-Sentry-adapter…) will accept
// our events. Why not @sentry/nextjs?
//
//   • adds ~120 KB to the client bundle
//   • forces an Edge-incompatible runtime split
//   • makes a hard build dep out of a thing the user might disable
//
// The trade-off is we don't get session replay or performance tracing —
// just errors and breadcrumbs. That's the right scope for v1: see what's
// crashing in the wild.
//
// Activation:
//   - Set NEXT_PUBLIC_SENTRY_DSN (browser) or SENTRY_DSN (server) in env.
//   - Without those, every call here is a no-op and zero network I/O.
// ----------------------------------------------------------------------------

type SeverityLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

interface DSNComponents {
  publicKey: string;
  host: string;
  projectId: string;
  protocol: string;
  /** Final URL to POST envelopes to: `${protocol}://${host}/api/${projectId}/envelope/?…` */
  envelopeUrl: string;
}

interface EventPayload {
  event_id: string;
  timestamp: number;
  platform: 'javascript' | 'node';
  level: SeverityLevel;
  environment: string;
  release?: string;
  server_name?: string;
  tags?: Record<string, string>;
  user?: { id?: string; email?: string };
  message?: string;
  exception?: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: { frames: Array<{ filename?: string; function?: string; lineno?: number; colno?: number; in_app?: boolean }> };
    }>;
  };
  breadcrumbs?: { values: Array<{ timestamp: number; category?: string; message?: string; level?: SeverityLevel; data?: Record<string, unknown> }> };
  contexts?: { app?: Record<string, unknown>; runtime?: Record<string, unknown> };
}

let parsedDSN: DSNComponents | null | undefined;
let isInitialised = false;
const breadcrumbs: NonNullable<EventPayload['breadcrumbs']>['values'] = [];
const MAX_BREADCRUMBS = 30;
let currentUser: EventPayload['user'] | undefined;

function getDSN(): string | undefined {
  if (typeof window !== 'undefined') {
    return process.env.NEXT_PUBLIC_SENTRY_DSN;
  }
  return process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
}

function parseDSN(): DSNComponents | null {
  if (parsedDSN !== undefined) return parsedDSN;
  const dsn = getDSN();
  if (!dsn) {
    parsedDSN = null;
    return null;
  }
  try {
    const u = new URL(dsn);
    // Sentry DSN: protocol://publicKey@host/projectId
    const publicKey = u.username;
    const host = u.host;
    const projectId = u.pathname.replace(/^\//, '').replace(/\/$/, '');
    if (!publicKey || !host || !projectId) {
      parsedDSN = null;
      return null;
    }
    const envelopeUrl =
      `${u.protocol}//${host}/api/${projectId}/envelope/` +
      `?sentry_version=7&sentry_key=${publicKey}&sentry_client=verge/1.0`;
    parsedDSN = { publicKey, host, projectId, protocol: u.protocol, envelopeUrl };
    return parsedDSN;
  } catch {
    parsedDSN = null;
    return null;
  }
}

function uuid(): string {
  // No hyphens — Sentry event IDs are 32-char hex.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

function getEnvironment(): string {
  return (
    process.env.NEXT_PUBLIC_APP_ENV ||
    process.env.VERCEL_ENV ||
    process.env.NODE_ENV ||
    'development'
  );
}

function getRelease(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_APP_VERSION ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.npm_package_version
  );
}

async function sendEnvelope(payload: EventPayload): Promise<void> {
  const dsn = parseDSN();
  if (!dsn) return;

  // Sentry envelope = newline-separated header + item-header + item.
  const envelopeHeader = JSON.stringify({
    event_id: payload.event_id,
    sent_at: new Date().toISOString(),
    dsn: getDSN(),
  });
  const itemHeader = JSON.stringify({ type: 'event', content_type: 'application/json' });
  const itemBody = JSON.stringify(payload);
  const body = `${envelopeHeader}\n${itemHeader}\n${itemBody}`;

  try {
    if (typeof window !== 'undefined' && 'sendBeacon' in navigator) {
      // sendBeacon survives page unload — best for last-gasp error reports.
      navigator.sendBeacon(
        dsn.envelopeUrl,
        new Blob([body], { type: 'application/x-sentry-envelope' }),
      );
      return;
    }
    await fetch(dsn.envelopeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope' },
      body,
      keepalive: true,
    });
  } catch {
    // We never want telemetry to throw — that's the whole point.
  }
}

function frameFromStackLine(line: string) {
  // Crude parser — handles the common Chrome/Firefox/Node formats.
  const m =
    line.match(/^\s*at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)$/) ||
    line.match(/^\s*at\s+(.*?):(\d+):(\d+)$/);
  if (!m) return null;
  if (m.length === 5) {
    return {
      function: m[1],
      filename: m[2],
      lineno: parseInt(m[3], 10),
      colno: parseInt(m[4], 10),
      in_app: !m[2].includes('/node_modules/'),
    };
  }
  return {
    filename: m[1],
    lineno: parseInt(m[2], 10),
    colno: parseInt(m[3], 10),
    in_app: !m[1].includes('/node_modules/'),
  };
}

function buildBaseEvent(level: SeverityLevel): EventPayload {
  return {
    event_id: uuid(),
    timestamp: Date.now() / 1000,
    platform: typeof window === 'undefined' ? 'node' : 'javascript',
    level,
    environment: getEnvironment(),
    release: getRelease(),
    server_name: typeof window === 'undefined' ? 'edge-or-node' : undefined,
    tags: {
      runtime: typeof window === 'undefined' ? 'server' : 'browser',
    },
    user: currentUser,
    breadcrumbs: breadcrumbs.length > 0 ? { values: [...breadcrumbs] } : undefined,
    contexts: {
      app: { app_name: 'verge' },
      runtime:
        typeof window === 'undefined'
          ? { name: 'node', version: process.versions?.node }
          : { name: 'browser', version: navigator.userAgent },
    },
  };
}

/** Set the user the next error will be attributed to. Pass null on sign-out. */
export function identify(user: { id?: string; email?: string } | null): void {
  currentUser = user ?? undefined;
}

/** Add a breadcrumb (small action log entry) shown alongside the next error. */
export function addBreadcrumb(message: string, opts: { category?: string; level?: SeverityLevel; data?: Record<string, unknown> } = {}): void {
  breadcrumbs.push({
    timestamp: Date.now() / 1000,
    category: opts.category,
    message,
    level: opts.level || 'info',
    data: opts.data,
  });
  while (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
}

/** Capture an exception. Safe to call with any value. */
export function captureException(err: unknown, hints: { tags?: Record<string, string> } = {}): void {
  if (!parseDSN()) return;
  const event = buildBaseEvent('error');
  if (hints.tags) event.tags = { ...event.tags, ...hints.tags };

  if (err instanceof Error) {
    const stack = err.stack ?? '';
    const frames = stack
      .split('\n')
      .slice(1)
      .map(frameFromStackLine)
      .filter((f): f is NonNullable<ReturnType<typeof frameFromStackLine>> => f != null)
      .reverse();
    event.exception = {
      values: [
        {
          type: err.name || 'Error',
          value: err.message,
          stacktrace: frames.length > 0 ? { frames } : undefined,
        },
      ],
    };
  } else {
    event.message = String(err);
  }
  void sendEnvelope(event);
}

/** Capture a plain message. Useful for non-throw error paths. */
export function captureMessage(message: string, level: SeverityLevel = 'info'): void {
  if (!parseDSN()) return;
  const event = buildBaseEvent(level);
  event.message = message;
  void sendEnvelope(event);
}

/** Whether reporting is wired up. Components can hide UI tied to it. */
export function isTelemetryEnabled(): boolean {
  return parseDSN() !== null;
}

/**
 * One-time browser setup — hook into window error events. Safe to call
 * multiple times (no-ops after the first). No-op when no DSN is configured.
 */
export function initBrowserTelemetry(): void {
  if (isInitialised) return;
  if (typeof window === 'undefined') return;
  if (!parseDSN()) return;
  isInitialised = true;

  window.addEventListener('error', (event) => {
    captureException(event.error ?? event.message, { tags: { source: 'window.error' } });
  });

  window.addEventListener('unhandledrejection', (event) => {
    captureException(event.reason, { tags: { source: 'unhandledrejection' } });
  });
}
