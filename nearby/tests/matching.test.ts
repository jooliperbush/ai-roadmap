import { describe, expect, it } from 'vitest';
import { haversineKm, openSlots, rankCreators } from '../src/domain/matching.js';
import type { Match } from '../src/domain/types.js';
import { aeRestaurant, creator, ukRestaurant } from './fixtures.js';

const ctx = (over: Partial<Parameters<typeof rankCreators>[2]> = {}) => ({
  month: '2026-09',
  matches: [] as Match[],
  bookings: [],
  now: new Date('2026-09-08T09:00:00Z'),
  ...over,
});

describe('matching', () => {
  it('measures distance', () => {
    expect(haversineKm({ lat: 51.526, lng: -0.078 }, { lat: 51.529, lng: -0.058 })).toBeCloseTo(1.4, 0);
  });

  it('ranks nearer, cuisine-matched, reliable creators first', () => {
    const near = creator({ id: 'near' });
    const far = creator({ id: 'far', home: { lat: 51.465, lng: -0.114 }, area: 'Brixton', cuisines: ['Pizza'] });
    const flaky = creator({ id: 'flaky', reliability: { completed: 1, noShows: 2, latePosts: 1 } });
    const { candidates } = rankCreators(ukRestaurant(), [far, flaky, near], ctx());
    expect(candidates.map((c) => c.creator.id)).toEqual(['near', 'flaky', 'far']);
    expect(candidates[0].reasons).toContain('likes Taiwanese');
  });

  it('excludes for hard rules and says why', () => {
    const r = ukRestaurant();
    const tooFar = creator({ id: 'tooFar', travelKm: 1, home: { lat: 51.465, lng: -0.114 } });
    const small = creator({ id: 'small', followers: 200 });
    const halal = creator({ id: 'halal', dietary: ['halal'] });
    const paused = creator({ id: 'paused', status: 'paused' });
    const dryOnly = creator({ id: 'dry', dietary: ['no_alcohol'] });
    const { candidates, excluded } = rankCreators(r, [tooFar, small, halal, paused, dryOnly], ctx());
    expect(candidates).toHaveLength(0);
    const why = Object.fromEntries(excluded.map((e) => [e.creator.id, e.reason]));
    expect(why.tooFar).toMatch(/travels 1km/);
    expect(why.small).toMatch(/below venue minimum/);
    expect(why.halal).toMatch(/halal/);
    expect(why.paused).toMatch(/paused/);
    expect(why.dry).toMatch(/licensed/);
  });

  it('requires a verified UAE advertiser permit in Dubai', () => {
    const r = aeRestaurant();
    const base = { market: 'AE' as const, phone: '+971500000123', home: { lat: 25.075, lng: 55.14 }, travelKm: 15, cuisines: ['Indian'] };
    const noPermit = creator({ ...base, id: 'none' });
    const pending = creator({ ...base, id: 'pending', adPermit: { number: 'X1', verified: false } });
    const ok = creator({ ...base, id: 'ok', adPermit: { number: 'X2', verified: true } });
    const { candidates, excluded } = rankCreators(r, [noPermit, pending, ok], ctx());
    expect(candidates.map((c) => c.creator.id)).toEqual(['ok']);
    expect(excluded.every((e) => /permit/.test(e.reason))).toBe(true);
  });

  it('respects creator monthly cap, cooldown and open invites', () => {
    const r = ukRestaurant();
    const c = creator({ id: 'c1', monthlyCap: 1 });
    const invited: Match = {
      id: 'm1', restaurantId: 'other', creatorId: 'c1', month: '2026-09', score: 1, reasons: [],
      status: 'invited', invitedAt: '', expiresAt: '2099-01-01T00:00:00Z',
    };
    expect(rankCreators(r, [c], ctx({ matches: [invited] })).excluded[0].reason).toMatch(/monthly cap/);

    const c2 = creator({ id: 'c2' });
    const bookings = [{
      id: 'b', matchId: 'm', restaurantId: r.id, creatorId: 'c2', at: '2026-08-20T19:00:00Z', guests: 2,
      status: 'posted' as const, remindersSent: [], postNudgesSent: 0, createdAt: '',
    }];
    expect(rankCreators(r, [c2], ctx({ bookings })).excluded[0].reason).toMatch(/recently/);
  });

  it('counts open slots against invited and accepted matches only', () => {
    const r = ukRestaurant({ plan: { creatorsPerMonth: 3, priceMinor: 0, currency: 'GBP', status: 'active' } });
    const m = (status: Match['status'], month = '2026-09'): Match => ({
      id: Math.random().toString(), restaurantId: r.id, creatorId: 'x', month, score: 0, reasons: [], status, invitedAt: '', expiresAt: '',
    });
    expect(openSlots(r, '2026-09', [m('invited'), m('accepted'), m('declined'), m('expired'), m('accepted', '2026-08')])).toBe(1);
  });
});
