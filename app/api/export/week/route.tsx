import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

// ----------------------------------------------------------------------------
// /api/export/week — render the Chronos Week view as a downloadable PNG.
//
// Stateless: the caller (the client) computes which events to include and
// passes them base64-encoded in the `events` query param. That keeps the
// route a thin layout pass — no auth round-trip, no DB hit — and means the
// CDN can cache identical requests without flushing per-user state.
//
// Query params:
//   start    YYYY-MM-DD  → first day of the week (Monday-anchored)
//   events   base64(JSON.stringify([{date,start_minute,duration_minutes,title,color}, ...]))
//   accent   hex without #, default ff8a3d
//   daystart 0-23 (default 9)
//   dayend   1-24 (default 21)
//   name     optional caption ("Verge · Week of Mar 18")
//
// Runs on Node (not Edge) because the Edge runtime's WASM chunk lookup is
// unreliable on Windows dev, and ImageResponse works on both.
// ----------------------------------------------------------------------------

export const runtime = 'nodejs';

interface ExportEvent {
  date: string;          // YYYY-MM-DD
  start_minute: number;  // 0..1439
  duration_minutes: number;
  title: string;
  color: string;         // hex
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function parseEvents(raw: string | null): ExportEvent[] {
  if (!raw) return [];
  try {
    const json =
      typeof Buffer !== 'undefined'
        ? Buffer.from(raw, 'base64').toString('utf8')
        : atob(raw);
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (e): e is ExportEvent =>
          e &&
          typeof e.date === 'string' &&
          typeof e.start_minute === 'number' &&
          typeof e.duration_minutes === 'number' &&
          typeof e.title === 'string' &&
          typeof e.color === 'string',
      )
      .slice(0, 500); // hard cap so a runaway client can't OOM the renderer
  } catch {
    return [];
  }
}

function parseYMD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function dateToYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtMinute(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const startStr = url.searchParams.get('start') ?? dateToYMD(new Date());
  const daystart = clamp(parseInt(url.searchParams.get('daystart') ?? '9', 10), 0, 23);
  const dayend = clamp(parseInt(url.searchParams.get('dayend') ?? '21', 10), daystart + 1, 24);
  const accent = `#${(url.searchParams.get('accent') ?? 'ff8a3d').replace(/[^0-9a-fA-F]/g, '').slice(0, 6) || 'ff8a3d'}`;
  const events = parseEvents(url.searchParams.get('events'));
  const name = (url.searchParams.get('name') ?? '').slice(0, 60);

  const weekStart = parseYMD(startStr);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = dateToYMD(new Date());
  const todayIdx = weekDates.findIndex((d) => dateToYMD(d) === today);

  // Layout constants. 1600×1000 lands on a comfortable 16:10 share/screenshot
  // ratio that's still legible when printed on US Letter or A4.
  const W = 1600;
  const H = 1000;
  const PAD_X = 56;
  const PAD_TOP = 110;
  const PAD_BOTTOM = 56;
  const LABEL_COL = 80;
  const DAY_HEADER = 56;

  const gridX = PAD_X + LABEL_COL;
  const gridY = PAD_TOP + DAY_HEADER;
  const gridW = W - PAD_X * 2 - LABEL_COL;
  const gridH = H - PAD_TOP - DAY_HEADER - PAD_BOTTOM;
  const colW = gridW / 7;
  const hourCount = dayend - daystart;
  const rowH = gridH / hourCount;

  const headerLabel =
    name ||
    `${weekStart.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} — ${weekDates[6].toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#0a0807',
          backgroundImage: `radial-gradient(circle at 50% 0%, ${accent}1f, transparent 55%)`,
          color: '#f0ebe4',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Page header — brand + week label */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `28px ${PAD_X}px 0`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: accent,
                color: '#0a0807',
                fontWeight: 800,
                fontSize: 22,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              V
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span
                style={{
                  fontSize: 12,
                  letterSpacing: 6,
                  textTransform: 'uppercase',
                  color: accent,
                  fontWeight: 700,
                }}
              >
                Verge · Week
              </span>
              <span style={{ fontSize: 22, fontWeight: 400 }}>{headerLabel}</span>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 14,
              letterSpacing: 4,
              textTransform: 'uppercase',
              color: 'rgba(240,235,228,0.45)',
            }}
          >
            {events.length} event{events.length === 1 ? '' : 's'}
          </div>
        </div>

        {/* Grid container (absolute children) */}
        <div
          style={{
            position: 'absolute',
            top: PAD_TOP,
            left: PAD_X,
            width: W - PAD_X * 2,
            height: H - PAD_TOP - PAD_BOTTOM,
            display: 'flex',
          }}
        >
          {/* Today column wash */}
          {todayIdx >= 0 && (
            <div
              style={{
                position: 'absolute',
                left: LABEL_COL + colW * todayIdx,
                top: DAY_HEADER,
                width: colW,
                height: rowH * hourCount,
                background: `${accent}10`,
              }}
            />
          )}

          {/* Day headers */}
          {weekDates.map((d, i) => {
            const isToday = i === todayIdx;
            return (
              <div
                key={`dh-${i}`}
                style={{
                  position: 'absolute',
                  left: LABEL_COL + colW * i,
                  top: 0,
                  width: colW,
                  height: DAY_HEADER,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  color: isToday ? accent : 'rgba(240,235,228,0.55)',
                  borderBottom: `1px solid ${accent}26`,
                  fontWeight: isToday ? 700 : 600,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    letterSpacing: 4,
                    textTransform: 'uppercase',
                  }}
                >
                  {DAY_LABELS[i]}
                </span>
                <span style={{ fontSize: 20 }}>{d.getDate()}</span>
              </div>
            );
          })}

          {/* Hour labels + horizontal grid lines */}
          {Array.from({ length: hourCount }).map((_, h) => (
            <div
              key={`hr-${h}`}
              style={{
                position: 'absolute',
                top: DAY_HEADER + rowH * h,
                left: 0,
                width: W - PAD_X * 2,
                height: rowH,
                display: 'flex',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  width: LABEL_COL,
                  paddingTop: 4,
                  paddingRight: 12,
                  justifyContent: 'flex-end',
                  fontSize: 12,
                  color: 'rgba(240,235,228,0.45)',
                }}
              >
                {String(daystart + h).padStart(2, '0')}:00
              </div>
              <div
                style={{
                  display: 'flex',
                  flex: 1,
                  borderTop: h === 0 ? '0' : `1px solid ${accent}1a`,
                }}
              />
            </div>
          ))}

          {/* Vertical day-column separators */}
          {weekDates.map((_, i) => (
            <div
              key={`vsep-${i}`}
              style={{
                position: 'absolute',
                left: LABEL_COL + colW * i,
                top: DAY_HEADER,
                width: 1,
                height: rowH * hourCount,
                background: `${accent}14`,
              }}
            />
          ))}
          <div
            style={{
              position: 'absolute',
              left: LABEL_COL + colW * 7,
              top: DAY_HEADER,
              width: 1,
              height: rowH * hourCount,
              background: `${accent}14`,
            }}
          />

          {/* Event blocks */}
          {events.map((e, idx) => {
            const dayIdx = weekDates.findIndex((d) => dateToYMD(d) === e.date);
            if (dayIdx < 0) return null;
            const startMinFromDay = e.start_minute - daystart * 60;
            if (startMinFromDay + e.duration_minutes <= 0) return null;
            if (startMinFromDay >= hourCount * 60) return null;
            const topMin = Math.max(0, startMinFromDay);
            const bottomMin = Math.min(hourCount * 60, startMinFromDay + e.duration_minutes);
            const top = DAY_HEADER + (topMin / 60) * rowH;
            const height = Math.max(20, ((bottomMin - topMin) / 60) * rowH);
            const left = LABEL_COL + colW * dayIdx + 4;
            const width = colW - 8;
            const color = e.color || accent;
            const minTextH = 32;
            const showTime = height >= minTextH + 12;

            return (
              <div
                key={`ev-${idx}`}
                style={{
                  position: 'absolute',
                  top,
                  left,
                  width,
                  height,
                  display: 'flex',
                  flexDirection: 'column',
                  borderRadius: 6,
                  padding: '6px 8px',
                  background: `${color}33`,
                  borderLeft: `3px solid ${color}`,
                  overflow: 'hidden',
                  color: '#f0ebe4',
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    fontSize: 13,
                    fontWeight: 600,
                    color,
                    lineHeight: 1.2,
                    overflow: 'hidden',
                  }}
                >
                  {e.title.length > 36 ? `${e.title.slice(0, 36)}…` : e.title}
                </span>
                {showTime && (
                  <span
                    style={{
                      display: 'flex',
                      fontSize: 11,
                      color: 'rgba(240,235,228,0.65)',
                      marginTop: 2,
                    }}
                  >
                    {fmtMinute(e.start_minute)} · {Math.round(e.duration_minutes)}m
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            position: 'absolute',
            bottom: 14,
            left: PAD_X,
            right: PAD_X,
            display: 'flex',
            justifyContent: 'space-between',
            color: 'rgba(240,235,228,0.42)',
            fontSize: 12,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}
        >
          <span style={{ display: 'flex' }}>Verge — Time, distilled.</span>
          <span style={{ display: 'flex' }}>verge.app</span>
        </div>
      </div>
    ),
    { width: W, height: H },
  );
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
