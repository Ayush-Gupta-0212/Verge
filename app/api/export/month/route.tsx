import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

// ----------------------------------------------------------------------------
// /api/export/month — render the Chronos Month view as a downloadable PNG.
//
// Query params:
//   ym       YYYY-MM  → reference month
//   events   base64(JSON.stringify([{date,start_minute,duration_minutes,title,color}, ...]))
//   accent   hex without #, default ff8a3d
//   name     optional caption ("Verge · March 2026")
//
// Same stateless / Node-runtime pattern as the week route.
// ----------------------------------------------------------------------------

export const runtime = 'nodejs';

interface ExportEvent {
  date: string;
  start_minute: number;
  duration_minutes: number;
  title: string;
  color: string;
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
      .slice(0, 800);
  } catch {
    return [];
  }
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
  const ymRaw = url.searchParams.get('ym') ?? '';
  const [yStr, mStr] = ymRaw.split('-');
  const today = new Date();
  const year = parseInt(yStr, 10) || today.getFullYear();
  const month = (parseInt(mStr, 10) || today.getMonth() + 1) - 1;
  const monthRef = new Date(year, month, 1);
  const accent = `#${(url.searchParams.get('accent') ?? 'ff8a3d').replace(/[^0-9a-fA-F]/g, '').slice(0, 6) || 'ff8a3d'}`;
  const events = parseEvents(url.searchParams.get('events'));
  const name = (url.searchParams.get('name') ?? '').slice(0, 60);

  // Build the 6×7 day grid, Monday-first. Empty cells before/after the
  // month boundary stay rendered (dimmed) so the calendar looks complete.
  const first = new Date(monthRef.getFullYear(), monthRef.getMonth(), 1);
  const startWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(
    monthRef.getFullYear(),
    monthRef.getMonth() + 1,
    0,
  ).getDate();
  const todayYMD = dateToYMD(today);

  const cells = Array.from({ length: 42 }, (_, i) => {
    const dateNum = i - startWeekday + 1;
    if (dateNum < 1 || dateNum > daysInMonth) {
      return { date: null as Date | null, events: [] as ExportEvent[], isToday: false };
    }
    const d = new Date(monthRef.getFullYear(), monthRef.getMonth(), dateNum);
    const ymd = dateToYMD(d);
    const dayEvs = events
      .filter((e) => e.date === ymd)
      .sort((a, b) => a.start_minute - b.start_minute);
    return { date: d, events: dayEvs, isToday: ymd === todayYMD };
  });

  const W = 1600;
  const H = 1200;
  const PAD_X = 56;
  const PAD_TOP = 130;
  const PAD_BOTTOM = 56;
  const DAY_HEADER = 40;

  const gridW = W - PAD_X * 2;
  const gridH = H - PAD_TOP - DAY_HEADER - PAD_BOTTOM;
  const colW = gridW / 7;
  const rowH = gridH / 6;

  const headerLabel =
    name ||
    monthRef.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#0a0807',
          backgroundImage: `radial-gradient(circle at 50% 0%, ${accent}1f, transparent 60%)`,
          color: '#f0ebe4',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Page header */}
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
                Verge · Month
              </span>
              <span style={{ fontSize: 24, fontWeight: 400 }}>{headerLabel}</span>
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

        {/* Day-name header row */}
        <div
          style={{
            position: 'absolute',
            top: PAD_TOP,
            left: PAD_X,
            width: gridW,
            height: DAY_HEADER,
            display: 'flex',
          }}
        >
          {DAY_LABELS.map((d, i) => (
            <div
              key={`dh-${i}`}
              style={{
                display: 'flex',
                width: colW,
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                letterSpacing: 4,
                textTransform: 'uppercase',
                color: 'rgba(240,235,228,0.55)',
                fontWeight: 600,
                borderBottom: `1px solid ${accent}26`,
              }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* 6×7 day cells */}
        <div
          style={{
            position: 'absolute',
            top: PAD_TOP + DAY_HEADER + 8,
            left: PAD_X,
            width: gridW,
            height: gridH,
            display: 'flex',
            flexWrap: 'wrap',
          }}
        >
          {cells.map((c, i) => {
            const isEmpty = c.date === null;
            return (
              <div
                key={`cell-${i}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  width: colW - 6,
                  height: rowH - 6,
                  margin: 3,
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: c.isToday
                    ? `1px solid ${accent}80`
                    : `1px solid ${accent}22`,
                  background: c.isToday
                    ? `${accent}12`
                    : isEmpty
                    ? 'transparent'
                    : 'rgba(20,16,14,0.45)',
                  opacity: isEmpty ? 0.25 : 1,
                  overflow: 'hidden',
                }}
              >
                {c.date && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        fontSize: 18,
                        fontWeight: c.isToday ? 600 : 400,
                        color: c.isToday ? accent : '#f0ebe4',
                        lineHeight: 1,
                      }}
                    >
                      {c.date.getDate()}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                        marginTop: 6,
                      }}
                    >
                      {c.events.slice(0, 3).map((e, ei) => (
                        <div
                          key={ei}
                          style={{
                            display: 'flex',
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontSize: 11,
                            background: `${e.color}24`,
                            color: e.color,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {fmtMinute(e.start_minute)}{' '}
                          {e.title.length > 14 ? `${e.title.slice(0, 14)}…` : e.title}
                        </div>
                      ))}
                      {c.events.length > 3 && (
                        <div
                          style={{
                            display: 'flex',
                            fontSize: 11,
                            color: 'rgba(240,235,228,0.45)',
                            paddingLeft: 6,
                          }}
                        >
                          +{c.events.length - 3} more
                        </div>
                      )}
                    </div>
                  </>
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
