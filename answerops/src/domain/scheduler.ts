/**
 * Scheduling arithmetic, with no database and no ambient time.
 *
 * The service layer owns leases and rounds; everything here is a pure function so the
 * question "what does a daily schedule do across a week" is answerable by a test in a
 * millisecond instead of a week.
 */

export type Cadence = 'daily' | 'weekly' | 'manual';

export const CADENCES: Cadence[] = ['daily', 'weekly', 'manual'];

export const LEASE_MS = 10 * 60_000;

/**
 * The next boundary strictly after `from`. Manual schedules never come due on their own, so
 * they are parked a century out rather than given a null the query would have to special-case.
 */
export function computeNextRun(cadence: Cadence, from: Date, hourUtc = 6): Date {
  if (cadence === 'manual') return new Date('2999-01-01T00:00:00.000Z');
  const boundary = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hourUtc);
  const dayMs = 86_400_000;
  if (cadence === 'daily') return new Date(boundary + (boundary <= +from ? dayMs : 0));
  const weekday = new Date(boundary).getUTCDay();
  const monday = boundary + ((8 - weekday) % 7) * dayMs;
  return new Date(monday + (monday <= +from ? 7 * dayMs : 0));
}

/** Daily windows are dated; weekly windows are ISO week numbers. Both sort lexically. */
export function windowLabelFor(cadence: Cadence, at: Date): string {
  if (cadence !== 'weekly') return at.toISOString().substring(0, 10);
  const value = isoWeek(at);
  return value.year + '-W' + String(value.week).padStart(2, '0');
}

export function isoWeek(at: Date): { year: number; week: number } {
  const dayMs = 86_400_000;
  const midnight = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const thursday = new Date(midnight + (4 - (at.getUTCDay() || 7)) * dayMs);
  const year = thursday.getUTCFullYear();
  return { year, week: 1 + Math.floor((+thursday - Date.UTC(year, 0, 1)) / (7 * dayMs)) };
}

/** Month key used by the budget ledger. */
export function monthKey(at: Date): string {
  return at.toISOString().substring(0, 7);
}

export function leaseIsLive(leaseExpiresAt: string | null | undefined, now: Date): boolean {
  return Boolean(leaseExpiresAt && Date.parse(leaseExpiresAt) > +now);
}
