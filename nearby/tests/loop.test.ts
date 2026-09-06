import { describe, expect, it } from 'vitest';
import { tick } from '../src/services/scheduler.js';
import { inbound } from '../src/whatsapp/simulated.js';
import { D, H, aeRestaurant, creator, rig, ukRestaurant } from './fixtures.js';

/** Register an already-onboarded creator and a matching conversation record. */
function seedCreator(engine: ReturnType<typeof rig>['engine'], over: Parameters<typeof creator>[0] = {}, lastInboundAt?: Date) {
  const c = engine.store.creators.put(creator(over));
  engine.store.conversations.put({ phone: c.phone, market: c.market, creatorId: c.id, step: 'idle', data: {}, lastInboundAt: lastInboundAt?.toISOString() });
  return c;
}

describe('the monthly loop', () => {
  it('invites, books, reminds, collects the post, and counts it for the venue', async () => {
    const { engine, transport, clock } = rig();
    const r = engine.store.restaurants.put(ukRestaurant({ plan: { creatorsPerMonth: 1, priceMinor: 29900, currency: 'GBP', status: 'active' } }));
    const c = seedCreator(engine, {}, clock.now()); // messaged us just now, so free-form is allowed

    // invite
    let rep = await tick(engine);
    expect(rep.invitesSent).toBe(1);
    const invite = transport.last(c.phone)!.message;
    expect(invite.type).toBe('buttons');
    const matchId = engine.store.matches.all()[0].id;
    expect(engine.store.conversationByPhone(c.phone)!.step).toBe('invite_pending');

    // second tick does not double-invite: the venue's one slot is held
    rep = await tick(engine);
    expect(rep.invitesSent).toBe(0);

    // accept -> slot list
    await engine.handleInbound(inbound.button(c.phone, `accept:${matchId}`, 'Accept', clock.now()));
    const list = transport.last(c.phone)!.message;
    expect(list.type).toBe('list');
    if (list.type !== 'list') throw new Error();
    const rows = list.sections[0].rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows[0].title).toMatch(/^\w{3} \d{1,2} \w{3,4} \d{2}:\d{2}$/);

    // pick the last slot (far enough out that the reminder falls outside the 24h window) -> booking + venue notified
    const pick = rows[rows.length - 1];
    await engine.handleInbound(inbound.list(c.phone, pick.id, pick.title, clock.now()));
    const booking = engine.store.bookings.all()[0];
    expect(booking.status).toBe('booked');
    expect(transport.last(c.phone)!.message).toMatchObject({ text: expect.stringMatching(/Booked: Bao Corner/) });
    expect(transport.last(r.contactPhone)!.message).toMatchObject({ type: 'template', name: 'nearby_venue_booking_v1' });
    expect(engine.store.conversationByPhone(c.phone)!.step).toBe('idle');

    // 24h reminder arrives as a template (creator has been silent > 24h by then)
    const visitAt = new Date(booking.at);
    clock.set(new Date(visitAt.getTime() - 20 * H));
    rep = await tick(engine);
    expect(rep.remindersSent).toBe(1);
    expect(transport.last(c.phone)!.message).toMatchObject({ type: 'template', name: 'nearby_visit_reminder_v1' });

    // 2h reminder
    clock.set(new Date(visitAt.getTime() - 1 * H));
    rep = await tick(engine);
    expect(rep.remindersSent).toBe(1);
    expect(booking.remindersSent).toEqual(['24h', '2h']);

    // after the visit: post request
    clock.set(new Date(visitAt.getTime() + 4 * H));
    rep = await tick(engine);
    expect(rep.postRequests).toBe(1);
    expect(booking.status).toBe('visited');
    expect(engine.store.conversationByPhone(c.phone)!.step).toBe('awaiting_post');

    // creator sends the link, confirms the #ad label
    await engine.handleInbound(inbound.text(c.phone, 'posted! https://www.instagram.com/reel/abc123/', clock.now()));
    expect(transport.last(c.phone)!.message).toMatchObject({ type: 'buttons', text: expect.stringMatching(/#ad/) });
    await engine.handleInbound(inbound.button(c.phone, 'disclosure:yes', 'Yes it does', clock.now()));
    const post = engine.store.posts.all()[0];
    expect(post).toMatchObject({ platform: 'instagram', status: 'verified', disclosureConfirmed: true });
    expect(booking.status).toBe('posted');
    expect(engine.store.creators.get(c.id)!.reliability.completed).toBe(4);
  });

  it('uses a template outside the 24h window and defers during quiet hours', async () => {
    const { engine, transport, clock } = rig();
    engine.store.restaurants.put(ukRestaurant());
    const silent = seedCreator(engine, { id: 'silent' }, new Date(clock.now().getTime() - 3 * D));
    await tick(engine);
    expect(transport.last(silent.phone)!.message).toMatchObject({ type: 'template', name: 'nearby_invite_v1', quickReplies: ['accept', 'decline'] });

    // 23:30 London: nothing should go out until 08:00
    clock.set(new Date('2026-09-08T22:30:00Z'));
    const late = seedCreator(engine, { id: 'late', phone: '+447700900222' });
    const before = transport.sent.length;
    const rep = await tick(engine);
    expect(rep.invitesSent).toBe(1); // match recorded and the spot held
    expect(transport.sent.length).toBe(before); // but not sent yet
    expect(engine.deferred).toHaveLength(1);
    expect(engine.store.conversationByPhone(late.phone)!.step).toBe('invite_pending');

    clock.set(new Date('2026-09-09T07:15:00Z')); // 08:15 London
    await tick(engine);
    expect(engine.deferred).toHaveLength(0);
    expect(transport.last(late.phone)!.message).toMatchObject({ type: 'template', name: 'nearby_invite_v1' });
  });

  it('drops a deferred reminder that is stale by the time the window opens', async () => {
    const { engine, transport, clock } = rig();
    engine.store.restaurants.put(ukRestaurant());
    const c = seedCreator(engine, {}, clock.now());
    const b = engine.store.bookings.put({
      id: 'b1', matchId: 'm1', restaurantId: 'r_uk1', creatorId: c.id, at: '2026-09-09T23:30:00Z', guests: 2,
      status: 'booked', remindersSent: [], postNudgesSent: 0, createdAt: clock.now().toISOString(),
    });
    clock.set(new Date('2026-09-09T02:00:00Z')); // 03:00 London, 21.5h before the visit
    await engine.sendReminder(b, '24h');
    expect(engine.deferred).toHaveLength(1);
    b.status = 'cancelled';
    clock.set(new Date('2026-09-09T07:30:00Z'));
    const before = transport.sent.length;
    expect(await engine.flushDeferred()).toBe(0);
    expect(transport.sent.length).toBe(before);
    expect(engine.deferred).toHaveLength(0);
  });

  it('expires an unanswered invite and offers the spot to the next creator', async () => {
    const { engine, transport, clock } = rig();
    engine.store.restaurants.put(ukRestaurant({ plan: { creatorsPerMonth: 1, priceMinor: 0, currency: 'GBP', status: 'active' } }));
    const first = seedCreator(engine, { id: 'first', phone: '+447700900301', reliability: { completed: 9, noShows: 0, latePosts: 0 } }, clock.now());
    const second = seedCreator(engine, { id: 'second', phone: '+447700900302', reliability: { completed: 1, noShows: 0, latePosts: 0 } }, clock.now());
    await tick(engine);
    expect(engine.store.matches.all().map((m) => m.creatorId)).toEqual(['first']);

    clock.advance(25 * H);
    const rep = await tick(engine);
    expect(rep.invitesExpired).toBe(1);
    expect(rep.invitesSent).toBe(1);
    expect(engine.store.matches.find((m) => m.creatorId === 'second')).toHaveLength(1);
    expect(engine.store.conversationByPhone(first.phone)!.step).toBe('idle');
    expect(transport.last(second.phone)!.message).toMatchObject({ type: 'template', name: 'nearby_invite_v1' });
  });

  it('learns from a decline: "too far" tightens the radius', async () => {
    const { engine, clock } = rig();
    engine.store.restaurants.put(ukRestaurant({ location: { lat: 51.465, lng: -0.114 }, area: 'Brixton' })); // ~7.5km from E2
    const c = seedCreator(engine, { travelKm: 10 }, clock.now());
    await tick(engine);
    const matchId = engine.store.matches.all()[0].id;
    await engine.handleInbound(inbound.button(c.phone, `decline:${matchId}`, 'Decline', clock.now()));
    await engine.handleInbound(inbound.button(c.phone, 'why:far', 'Too far', clock.now()));
    expect(engine.store.creators.get(c.id)!.travelKm).toBeLessThan(10);
    expect(engine.store.matches.all()[0].status).toBe('declined');
    expect(engine.store.conversationByPhone(c.phone)!.step).toBe('idle');
  });

  it('runs the Dubai loop with permit-verified creators and AED pricing', async () => {
    const { engine, transport, clock } = rig();
    engine.store.restaurants.put(aeRestaurant());
    const c = seedCreator(
      engine,
      { market: 'AE', phone: '+971500000777', home: { lat: 25.075, lng: 55.14 }, travelKm: 15, cuisines: ['Indian'], adPermit: { number: 'ADV-1', verified: true } },
      clock.now(),
    );
    const rep = await tick(engine);
    expect(rep.invitesSent).toBe(1);
    const m = transport.last(c.phone)!.message;
    expect(m.type).toBe('buttons');
    if (m.type === 'buttons') expect(m.text).toMatch(/AED\s?300/);
  });

  it('a no-show frees the venue slot and dents reliability', async () => {
    const { engine, clock } = rig();
    engine.store.restaurants.put(ukRestaurant({ plan: { creatorsPerMonth: 1, priceMinor: 0, currency: 'GBP', status: 'active' } }));
    const c = seedCreator(engine, {}, clock.now());
    await tick(engine);
    const match = engine.store.matches.all()[0];
    match.status = 'accepted';
    const b = engine.store.bookings.put({
      id: 'b1', matchId: match.id, restaurantId: 'r_uk1', creatorId: c.id, at: clock.now().toISOString(), guests: 2,
      status: 'booked', remindersSent: [], postNudgesSent: 0, createdAt: clock.now().toISOString(),
    });
    await engine.markNoShow(b);
    expect(engine.store.creators.get(c.id)!.reliability.noShows).toBe(1);
    expect(match.status).toBe('declined');
  });
});
