import type { MarketCode, Weekday } from './types.js';

/**
 * Everything that differs between running this in the UK and in Dubai lives here.
 * The conversation engine, matcher and scheduler read from this table and never
 * hard-code a country rule.
 */
export interface Market {
  code: MarketCode;
  name: string;
  currency: 'GBP' | 'AED';
  timeZone: string;
  /** E.164 country prefix used to sanity-check creator numbers */
  phonePrefix: string;
  locale: string;
  /** Local hours during which we will send proactive (business-initiated) messages */
  sendWindow: { fromHour: number; toHour: number };
  /** Days a venue typically treats as weekend (affects slot ordering only) */
  weekend: Weekday[];
  disclosure: {
    /** The label a post must carry, in the first line/frame */
    label: string;
    /** One-line reminder shown to creators before they post */
    reminder: string;
    regulator: string;
  };
  /** Whether the creator must hold a government advertiser permit before posting */
  requiresAdPermit: boolean;
  /** Default subscription price in minor units */
  defaultPriceMinor: number;
  vatRate: number;
  /** Nudge copy for the creator's dietary question, since defaults differ */
  dietaryButtons: { id: string; title: string }[];
}

export const MARKETS: Record<MarketCode, Market> = {
  UK: {
    code: 'UK',
    name: 'United Kingdom',
    currency: 'GBP',
    timeZone: 'Europe/London',
    phonePrefix: '+44',
    locale: 'en-GB',
    sendWindow: { fromHour: 8, toHour: 21 },
    weekend: ['sat', 'sun'],
    disclosure: {
      label: '#ad',
      reminder:
        'UK rules: the meal was gifted in return for a post, so label it as an ad. Put "#ad" (or "Ad – gifted") at the very start of the caption and on the first frame, before the venue is named.',
      regulator: 'ASA / CAP Code and CMA endorsement guidance',
    },
    requiresAdPermit: false,
    defaultPriceMinor: 29900,
    vatRate: 0.2,
    dietaryButtons: [
      { id: 'diet:none', title: 'Eat anything' },
      { id: 'diet:vegetarian', title: 'Veggie / vegan' },
      { id: 'diet:halal', title: 'Halal only' },
    ],
  },
  AE: {
    code: 'AE',
    name: 'United Arab Emirates',
    currency: 'AED',
    timeZone: 'Asia/Dubai',
    phonePrefix: '+971',
    locale: 'en-AE',
    // TDRA promotional messaging rules: no late-night sends.
    sendWindow: { fromHour: 8, toHour: 21 },
    weekend: ['sat', 'sun'],
    disclosure: {
      label: '#ad',
      reminder:
        'UAE rules: promotional posts need your UAE Media Council advertiser permit and must be clearly marked as an ad. Put "#ad" at the start of the caption and on the first frame.',
      regulator: 'UAE Media Council (Advertiser Permit, Federal Decree-Law 55/2023)',
    },
    requiresAdPermit: true,
    defaultPriceMinor: 149900,
    vatRate: 0.05,
    dietaryButtons: [
      { id: 'diet:none', title: 'Eat anything' },
      { id: 'diet:no_alcohol', title: 'No alcohol venues' },
      { id: 'diet:vegetarian', title: 'Veggie / vegan' },
    ],
  },
};

export function marketForPhone(phone: string): MarketCode | undefined {
  if (phone.startsWith('+44')) return 'UK';
  if (phone.startsWith('+971')) return 'AE';
  return undefined;
}

export function formatMoney(minor: number, market: Market): string {
  return new Intl.NumberFormat(market.locale, {
    style: 'currency',
    currency: market.currency,
  }).format(minor / 100);
}

/** Hour of day (0-23) in the market's time zone. */
export function localHour(d: Date, market: Market): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: market.timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(d);
  return Number(h) % 24;
}

export function withinSendWindow(d: Date, market: Market): boolean {
  const h = localHour(d, market);
  return h >= market.sendWindow.fromHour && h < market.sendWindow.toHour;
}

/** Next instant at or after `d` that falls inside the market's send window. */
export function nextSendTime(d: Date, market: Market): Date {
  if (withinSendWindow(d, market)) return d;
  // Walk forward in 15-minute steps; cheap, correct across DST, and only used by the scheduler.
  const t = new Date(d);
  for (let i = 0; i < 24 * 4; i++) {
    t.setUTCMinutes(t.getUTCMinutes() + 15);
    if (withinSendWindow(t, market)) return t;
  }
  return t;
}

export function formatLocal(d: Date, market: Market): string {
  // Same shape in both markets ("Thu 10 Sept, 19:00"); only currency is localised.
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: market.timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}
