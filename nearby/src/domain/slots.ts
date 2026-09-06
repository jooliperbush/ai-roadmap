import type { Market } from './markets.js';
import { WEEKDAYS, type Booking, type Restaurant, type Weekday } from './types.js';

function tzOffsetMinutes(utc: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(utc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return (asUtc - utc.getTime()) / 60_000;
}

/** Convert a wall-clock time in `timeZone` to an instant. */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offset = tzOffsetMinutes(guess, timeZone);
  const adjusted = new Date(guess.getTime() - offset * 60_000);
  // second pass handles the rare DST-edge case where the offset changed between guess and answer
  const offset2 = tzOffsetMinutes(adjusted, timeZone);
  return offset2 === offset ? adjusted : new Date(guess.getTime() - offset2 * 60_000);
}

function localDateParts(utc: Date, timeZone: string): { y: number; m: number; d: number; weekday: Weekday } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(utc);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    weekday: get('weekday').toLowerCase().slice(0, 3) as Weekday,
  };
}

/**
 * Upcoming hosting slots for a venue, one creator per slot, starting at least
 * `leadHours` ahead so the kitchen has notice.
 */
export function availableSlots(
  restaurant: Restaurant,
  bookings: Booking[],
  market: Market,
  from: Date,
  opts: { days?: number; leadHours?: number; limit?: number } = {},
): Date[] {
  const days = opts.days ?? 14;
  const leadMs = (opts.leadHours ?? 24) * 3_600_000;
  const limit = opts.limit ?? 10;
  const taken = new Set(
    bookings
      .filter((b) => b.restaurantId === restaurant.id && b.status === 'booked')
      .map((b) => new Date(b.at).getTime()),
  );
  const out: Date[] = [];
  for (let i = 0; i <= days && out.length < limit; i++) {
    const day = new Date(from.getTime() + i * 86_400_000);
    const { y, m, d, weekday } = localDateParts(day, market.timeZone);
    if (!WEEKDAYS.includes(weekday)) continue;
    for (const hhmm of restaurant.bookingHours[weekday] ?? []) {
      const [hh, mm] = hhmm.split(':').map(Number);
      const at = zonedToUtc(y, m, d, hh, mm, market.timeZone);
      if (at.getTime() - from.getTime() < leadMs) continue;
      if (taken.has(at.getTime())) continue;
      out.push(at);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function shortSlotLabel(at: Date, market: Market): string {
  // Must fit WhatsApp's 24-character list-row title, e.g. "Tue 10 Sep 19:00"
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: market.timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(at)
    .replace(',', '');
}
