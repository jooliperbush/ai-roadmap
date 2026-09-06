export type MarketCode = 'UK' | 'AE';
export type Platform = 'instagram' | 'tiktok';
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface GeoPoint {
  lat: number;
  lng: number;
}

export type Dietary = 'none' | 'halal' | 'vegetarian' | 'vegan' | 'no_alcohol';

export interface Creator {
  id: string;
  /** E.164, e.g. +447700900123 or +971501234567 */
  phone: string;
  market: MarketCode;
  name?: string;
  handles: Partial<Record<Platform, string>>;
  followers?: number;
  home?: GeoPoint;
  /** Free-text area: postcode district ("E2"), or Dubai area ("JLT") */
  area?: string;
  cuisines: string[];
  dietary: Dietary[];
  /** Radius the creator is willing to travel, km */
  travelKm: number;
  /** Max visits the creator wants per month */
  monthlyCap: number;
  status: 'onboarding' | 'active' | 'paused' | 'removed';
  reliability: { completed: number; noShows: number; latePosts: number };
  /** UAE Media Council advertiser permit. Required to post promotional content from the UAE. */
  adPermit?: { number: string; verified: boolean };
  consent: { messaging: boolean; at?: string };
  createdAt: string;
}

export interface Restaurant {
  id: string;
  name: string;
  market: MarketCode;
  location: GeoPoint;
  area: string;
  cuisine: string[];
  /** e.g. 'halal', 'licensed', 'vegan_friendly', 'vegetarian_friendly' */
  tags: string[];
  plan: {
    creatorsPerMonth: number;
    priceMinor: number;
    currency: 'GBP' | 'AED';
    status: 'active' | 'paused' | 'cancelled';
  };
  hospitality: { compValueMinor: number; guests: number; notes: string };
  /** Slots the venue will host creators, local time "HH:MM" */
  bookingHours: Partial<Record<Weekday, string[]>>;
  /** WhatsApp number for the venue manager */
  contactPhone: string;
  minFollowers: number;
  createdAt: string;
}

export type MatchStatus = 'invited' | 'accepted' | 'declined' | 'expired';

export interface Match {
  id: string;
  restaurantId: string;
  creatorId: string;
  /** 'YYYY-MM' the visit counts against */
  month: string;
  score: number;
  reasons: string[];
  status: MatchStatus;
  invitedAt: string;
  expiresAt: string;
  respondedAt?: string;
}

export type BookingStatus =
  | 'booked'
  | 'visited'
  | 'no_show'
  | 'cancelled'
  | 'posted';

export interface Booking {
  id: string;
  matchId: string;
  restaurantId: string;
  creatorId: string;
  /** ISO instant */
  at: string;
  guests: number;
  status: BookingStatus;
  remindersSent: string[];
  postNudgesSent: number;
  createdAt: string;
}

export interface Post {
  id: string;
  bookingId: string;
  creatorId: string;
  restaurantId: string;
  platform: Platform | 'unknown';
  url: string;
  submittedAt: string;
  disclosureConfirmed: boolean;
  status: 'submitted' | 'verified' | 'rejected';
}

export type ConversationStep =
  | 'new'
  | 'consent'
  | 'ask_name'
  | 'ask_handle'
  | 'ask_area'
  | 'ask_cuisines'
  | 'ask_dietary'
  | 'ask_permit'
  | 'idle'
  | 'invite_pending'
  | 'decline_reason'
  | 'pick_slot'
  | 'awaiting_post'
  | 'confirm_disclosure'
  | 'paused';

export interface ConversationState {
  phone: string;
  market: MarketCode;
  creatorId?: string;
  step: ConversationStep;
  data: Record<string, unknown>;
  lastInboundAt?: string;
  lastOutboundAt?: string;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function monthKey(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  return `${y}-${m}`;
}
