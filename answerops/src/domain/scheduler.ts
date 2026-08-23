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
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hourUtc, 0, 0, 0));
  if (cadence === 'daily') {
    while (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  // Weekly runs on Monday at hourUtc.
  while (next.getUTCDay() !== 1 || next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** Daily windows are dated; weekly windows are ISO week numbers. Both sort lexically. */
export function windowLabelFor(cadence: Cadence, at: Date): string {
  if (cadence === 'weekly') {
    const { year, week } = isoWeek(at);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }
  return at.toISOString().slice(0, 10);
}

export function isoWeek(at: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** Month key used by the budget ledger. */
export function monthKey(at: Date): string {
  return at.toISOString().slice(0, 7);
}

export function leaseIsLive(leaseExpiresAt: string | null | undefined, now: Date): boolean {
  if (!leaseExpiresAt) return false;
  return new Date(leaseExpiresAt).getTime() > now.getTime();
}
