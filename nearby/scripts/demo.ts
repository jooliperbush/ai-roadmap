/**
 * End-to-end walk-through on the simulated transport. No credentials needed.
 *   npm run demo
 */
import { RuleIntentParser } from '../src/domain/intent.js';
import type { Clock, Restaurant } from '../src/domain/types.js';
import { Engine } from '../src/services/engine.js';
import { tick } from '../src/services/scheduler.js';
import { SimulatedTransport, inbound, render } from '../src/whatsapp/simulated.js';

const H = 3_600_000;
class DemoClock implements Clock {
  current = new Date('2026-09-08T09:00:00Z');
  now() {
    return new Date(this.current);
  }
  set(d: Date) {
    this.current = d;
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

const clock = new DemoClock();
const transport = new SimulatedTransport(() => clock.now());
const engine = new Engine(transport, { clock, intents: new RuleIntentParser(), log: (l) => console.log(`   · ${l}`) });

const hours = { mon: ['19:00'], tue: ['12:30', '19:00'], wed: ['19:00'], thu: ['19:00'], fri: ['19:30'], sat: ['13:00', '19:30'], sun: ['13:00'] };
const venues: Restaurant[] = [
  {
    id: 'r_bao', name: 'Bao Corner', market: 'UK', location: { lat: 51.526, lng: -0.078 }, area: 'Shoreditch',
    cuisine: ['Taiwanese'], tags: ['licensed', 'vegetarian_friendly'],
    plan: { creatorsPerMonth: 5, priceMinor: 29900, currency: 'GBP', status: 'active' },
    hospitality: { compValueMinor: 6000, guests: 2, notes: 'Drinks included.' },
    bookingHours: hours, contactPhone: '+447700900999', minFollowers: 1000, createdAt: '',
  },
  {
    id: 'r_saffron', name: 'Saffron House', market: 'AE', location: { lat: 25.07, lng: 55.145 }, area: 'JLT',
    cuisine: ['Indian', 'Persian'], tags: ['halal', 'vegetarian_friendly'],
    plan: { creatorsPerMonth: 5, priceMinor: 149900, currency: 'AED', status: 'active' },
    hospitality: { compValueMinor: 30000, guests: 2, notes: '' },
    bookingHours: hours, contactPhone: '+971500000999', minFollowers: 2000, createdAt: '',
  },
];
venues.forEach((v) => engine.store.restaurants.put(v));

let printed = 0;
function flush(label?: string) {
  if (label) console.log(`\n── ${label} ──`);
  for (const d of transport.sent.slice(printed)) console.log(`  ${d.to}  ◀  ${render(d.message).replace(/\n/g, '\n            ')}`);
  printed = transport.sent.length;
}
async function creatorSays(phone: string, what: string | { button: string } | { location: [number, number] }) {
  const ev =
    typeof what === 'string'
      ? inbound.text(phone, what, clock.now())
      : 'button' in what
        ? inbound.button(phone, what.button, what.button, clock.now())
        : inbound.location(phone, what.location[0], what.location[1], clock.now());
  console.log(`  ${phone}  ▶  ${typeof what === 'string' ? what : 'button' in what ? `[${what.button}]` : '📍 location'}`);
  await engine.handleInbound(ev);
  flush();
}

const PRIYA = '+447700900111';
const OMAR = '+971500000111';

console.log('══ 1. A London creator onboards ══');
await creatorSays(PRIYA, 'hi');
await creatorSays(PRIYA, { button: 'consent:yes' });
await creatorSays(PRIYA, 'Priya');
await creatorSays(PRIYA, 'instagram.com/priya.eats');
await creatorSays(PRIYA, 'E2');
await creatorSays(PRIYA, 'Taiwanese, Japanese, brunch');
await creatorSays(PRIYA, { button: 'diet:none' });
engine.store.creatorByPhone(PRIYA)!.followers = 4200;

console.log('\n══ 2. A Dubai creator onboards (permit step) ══');
await creatorSays(OMAR, 'salam');
await creatorSays(OMAR, { button: 'consent:yes' });
await creatorSays(OMAR, 'Omar');
await creatorSays(OMAR, '@omar.eats tiktok');
await creatorSays(OMAR, { location: [25.075, 55.14] });
await creatorSays(OMAR, 'Indian, Persian, Levantine');
await creatorSays(OMAR, { button: 'diet:no_alcohol' });
await creatorSays(OMAR, { button: 'permit:have' });
await creatorSays(OMAR, 'ADV-2026-1187');
engine.store.creatorByPhone(OMAR)!.followers = 9800;

console.log('\n══ 3. Scheduler tick: nothing for Omar until the permit is verified ══');
let rep = await tick(engine);
console.log('  report', rep);
flush();

console.log('\n══ 4. Priya accepts and books ══');
const priyaMatch = engine.store.matches.find((m) => m.creatorId === engine.store.creatorByPhone(PRIYA)!.id)[0];
await creatorSays(PRIYA, { button: `accept:${priyaMatch.id}` });
const list = transport.last(PRIYA)!.message;
if (list.type === 'list') {
  const row = list.sections[0].rows[1];
  console.log(`  ${PRIYA}  ▶  picks "${row.title}"`);
  await engine.handleInbound(inbound.list(PRIYA, row.id, row.title, clock.now()));
  flush();
}

console.log('\n══ 5. Ops verifies Omar\'s permit; next tick invites him (free-form: he messaged us < 24h ago) ══');
await engine.verifyPermit(engine.store.creatorByPhone(OMAR)!.id);
rep = await tick(engine);
console.log('  report', rep);
flush();
await creatorSays(OMAR, 'yes keen');
const omarList = transport.last(OMAR)!.message;
if (omarList.type === 'list') {
  const row = omarList.sections[0].rows[0];
  console.log(`  ${OMAR}  ▶  picks "${row.title}"`);
  await engine.handleInbound(inbound.list(OMAR, row.id, row.title, clock.now()));
  flush();
}

console.log('\n══ 6. Day before Priya\'s visit: reminder goes as an approved template (silent > 24h) ══');
const priyaBooking = engine.store.bookings.find((b) => b.creatorId === engine.store.creatorByPhone(PRIYA)!.id)[0];
clock.set(new Date(new Date(priyaBooking.at).getTime() - 20 * H));
rep = await tick(engine);
flush();

console.log('\n══ 7. After the visit: post request, link, disclosure check ══');
clock.set(new Date(new Date(priyaBooking.at).getTime() + 4 * H));
rep = await tick(engine);
flush();
await creatorSays(PRIYA, 'up now https://www.instagram.com/reel/C9abc/');
await creatorSays(PRIYA, { button: 'disclosure:yes' });

console.log('\n══ 8. Late-night send is held until the morning window ══');
clock.set(new Date('2026-09-20T22:30:00Z')); // 23:30 London
engine.store.creators.put({ ...engine.store.creatorByPhone(PRIYA)!, id: 'cr_late', phone: '+447700900333', name: 'Leo', handles: { tiktok: 'leo.eats' } });
engine.store.conversations.put({ phone: '+447700900333', market: 'UK', creatorId: 'cr_late', step: 'idle', data: {} });
rep = await tick(engine);
console.log('  report', rep, '| deferred:', engine.deferred.length);
clock.set(new Date('2026-09-21T07:05:00Z'));
rep = await tick(engine);
console.log('  next morning report', rep);
flush();

console.log('\n══ Venue view: Bao Corner ══');
const bao = engine.store.restaurants.get('r_bao')!;
console.table(
  engine.store.matches.find((m) => m.restaurantId === bao.id).map((m) => ({
    creator: engine.store.creators.get(m.creatorId)?.name,
    score: m.score,
    status: m.status,
    booking: engine.store.bookings.find((b) => b.matchId === m.id)[0]?.status ?? '-',
    post: engine.store.posts.find((p) => p.bookingId === engine.store.bookings.find((b) => b.matchId === m.id)[0]?.id)[0]?.url ?? '-',
  })),
);
