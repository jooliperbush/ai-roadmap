import { RuleIntentParser } from '../src/domain/intent.js';
import type { Clock, Creator, Restaurant } from '../src/domain/types.js';
import { Engine } from '../src/services/engine.js';
import { SimulatedTransport } from '../src/whatsapp/simulated.js';

export class FakeClock implements Clock {
  constructor(public current: Date) {}
  now() {
    return new Date(this.current);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
    return this.now();
  }
  set(d: Date) {
    this.current = new Date(d);
  }
}

export const H = 3_600_000;
export const D = 24 * H;

/** A Tuesday 10:00 London time, so slots and quiet hours are predictable. */
export const START_UK = new Date('2026-09-08T09:00:00Z');
/** Same instant is 13:00 in Dubai. */
export const START_AE = START_UK;

export function rig(start = START_UK) {
  const clock = new FakeClock(start);
  const transport = new SimulatedTransport(() => clock.now());
  const engine = new Engine(transport, { clock, intents: new RuleIntentParser(), inviteTtlHours: 24 });
  return { clock, transport, engine };
}

export const ALL_DAYS = { mon: ['12:30', '19:00'], tue: ['12:30', '19:00'], wed: ['12:30', '19:00'], thu: ['12:30', '19:00'], fri: ['12:30', '19:00'], sat: ['13:00', '19:30'], sun: ['13:00'] };

export function ukRestaurant(over: Partial<Restaurant> = {}): Restaurant {
  return {
    id: 'r_uk1',
    name: 'Bao Corner',
    market: 'UK',
    location: { lat: 51.526, lng: -0.078 }, // Shoreditch
    area: 'Shoreditch',
    cuisine: ['Taiwanese', 'Asian'],
    tags: ['licensed', 'vegetarian_friendly'],
    plan: { creatorsPerMonth: 5, priceMinor: 29900, currency: 'GBP', status: 'active' },
    hospitality: { compValueMinor: 6000, guests: 2, notes: 'Drinks included.' },
    bookingHours: ALL_DAYS,
    contactPhone: '+447700900999',
    minFollowers: 1000,
    createdAt: '2026-09-01T00:00:00Z',
    ...over,
  };
}

export function aeRestaurant(over: Partial<Restaurant> = {}): Restaurant {
  return {
    id: 'r_ae1',
    name: 'Saffron House',
    market: 'AE',
    location: { lat: 25.07, lng: 55.145 }, // JLT
    area: 'JLT',
    cuisine: ['Indian', 'Persian'],
    tags: ['halal', 'vegetarian_friendly'],
    plan: { creatorsPerMonth: 5, priceMinor: 149900, currency: 'AED', status: 'active' },
    hospitality: { compValueMinor: 30000, guests: 2, notes: '' },
    bookingHours: ALL_DAYS,
    contactPhone: '+971500000999',
    minFollowers: 2000,
    createdAt: '2026-09-01T00:00:00Z',
    ...over,
  };
}

export function creator(over: Partial<Creator> = {}): Creator {
  return {
    id: 'cr_' + Math.random().toString(36).slice(2, 8),
    phone: '+447700900' + Math.floor(Math.random() * 900 + 100),
    market: 'UK',
    name: 'Sam',
    handles: { instagram: 'sameats' },
    followers: 5000,
    home: { lat: 51.529, lng: -0.058 }, // E2
    area: 'E2',
    cuisines: ['Taiwanese', 'Japanese'],
    dietary: [],
    travelKm: 8,
    monthlyCap: 4,
    status: 'active',
    reliability: { completed: 3, noShows: 0, latePosts: 0 },
    consent: { messaging: true, at: '2026-08-01T00:00:00Z' },
    createdAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}
