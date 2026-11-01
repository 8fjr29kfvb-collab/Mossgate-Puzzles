/** Puzzle dates roll over at midnight in Japan (no daylight saving). */
export const TOKYO_TIME_ZONE = 'Asia/Tokyo';

/** First catalog day. Nonogram pictures are indexed from this Tokyo date. */
export const CATALOG_EPOCH = '2026-01-01';

/** First day the site offered daily puzzles. Archive dates do not go earlier. */
export const LAUNCH_DATE = '2026-10-31';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function tokyoDateString(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TOKYO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error('Could not read the Tokyo date');
  }
  return `${year}-${month}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const utc = new Date(Date.UTC(year!, (month ?? 1) - 1, (day ?? 1) + days));
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  return addDays(value, 0) === value;
}

/**
 * A playable archive date. Invalid or future values become today.
 * Dates before launch clamp to launch.
 */
export function clampPuzzleDate(raw: string | null | undefined, today: string, launch = LAUNCH_DATE): string {
  const safeToday = isIsoDate(today) ? today : launch;
  if (!raw || !isIsoDate(raw)) return safeToday;
  if (raw > safeToday) return safeToday;
  if (raw < launch) return launch;
  return raw;
}

/** Today first, back through launch. */
export function archiveDates(today: string, launch = LAUNCH_DATE): string[] {
  const end = clampPuzzleDate(today, today, launch);
  const dates: string[] = [];
  for (let cursor = end; cursor >= launch; cursor = addDays(cursor, -1)) {
    dates.push(cursor);
    if (dates.length > 5000) break;
  }
  return dates;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const from = Date.UTC(fy!, (fm ?? 1) - 1, fd ?? 1);
  const to = Date.UTC(ty!, (tm ?? 1) - 1, td ?? 1);
  return Math.round((to - from) / 86_400_000);
}

export function formatLongDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const utc = new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1, 12));
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc);
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  }
  return `${minutes}:${ss}`;
}
