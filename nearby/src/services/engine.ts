import { staticGeocoder, type Geocoder } from '../domain/geo.js';
import { defaultIntentParser, type Intent, type IntentParser } from '../domain/intent.js';
import { MARKETS, formatLocal, formatMoney, marketForPhone, nextSendTime, withinSendWindow, type Market } from '../domain/markets.js';
import { availableSlots, shortSlotLabel } from '../domain/slots.js';
import {
  monthKey,
  systemClock,
  type Booking,
  type Clock,
  type ConversationState,
  type Creator,
  type Dietary,
  type Match,
  type Platform,
  type Post,
  type Restaurant,
} from '../domain/types.js';
import { memoryStore, newId, type Store } from '../store/memory.js';
import { template } from '../whatsapp/templates.js';
import type { Inbound, Outbound, Transport } from '../whatsapp/types.js';

export interface EngineOptions {
  store?: Store;
  clock?: Clock;
  intents?: IntentParser;
  geocoder?: Geocoder;
  brand?: string;
  /** Hours an invite stays open before the spot is released */
  inviteTtlHours?: number;
  log?: (line: string) => void;
}

interface Deferred {
  to: string;
  message: Outbound;
  sendAt: Date;
  /** Re-checked at flush time so a stale reminder or invite is dropped, not sent late. */
  stillRelevant: () => boolean;
}

const WINDOW_MS = 24 * 3_600_000;

/**
 * The creator-facing agent. Everything a creator experiences is a WhatsApp thread
 * with this class on the other end: onboarding, invites, booking, reminders,
 * post collection. It is a state machine with a small intent parser on the side,
 * which keeps it inside Meta's "task-specific bot" policy and makes it testable.
 */
export class Engine {
  readonly store: Store;
  readonly clock: Clock;
  readonly deferred: Deferred[] = [];
  private intents: IntentParser;
  private geocoder: Geocoder;
  private brand: string;
  private inviteTtlMs: number;
  private log: (line: string) => void;

  constructor(private transport: Transport, opts: EngineOptions = {}) {
    this.store = opts.store ?? memoryStore();
    this.clock = opts.clock ?? systemClock;
    this.intents = opts.intents ?? defaultIntentParser();
    this.geocoder = opts.geocoder ?? staticGeocoder;
    this.brand = opts.brand ?? 'Nearby';
    this.inviteTtlMs = (opts.inviteTtlHours ?? 24) * 3_600_000;
    this.log = opts.log ?? (() => {});
  }

  // ------------------------------------------------------------------ inbound

  async handleInbound(msg: Inbound): Promise<void> {
    const now = msg.at;
    let conv = this.store.conversationByPhone(msg.from);
    if (!conv) {
      const market = marketForPhone(msg.from);
      if (!market) {
        await this.transport.send(msg.from, {
          type: 'text',
          text: `Thanks for messaging ${this.brand}. We are only live in the UK and the UAE right now, so we cannot sign up this number yet.`,
        });
        return;
      }
      conv = { phone: msg.from, market, step: 'new', data: {} };
      this.store.conversations.put(conv);
    }
    conv.lastInboundAt = now.toISOString();
    const market = MARKETS[conv.market];
    const creator = conv.creatorId ? this.store.creators.get(conv.creatorId) : undefined;

    const send = async (m: Outbound) => {
      await this.transport.send(conv!.phone, m);
      conv!.lastOutboundAt = this.clock.now().toISOString();
    };
    const buttonId = msg.kind === 'button' || msg.kind === 'list' ? msg.id : undefined;
    const text = msg.kind === 'text' ? msg.text : undefined;
    const intent: Intent | undefined = text ? await this.intents.parse(text, conv.step) : undefined;

    // Global commands that work in any state once a creator exists.
    if (creator && intent?.intent === 'help') {
      await send({
        type: 'text',
        text:
          `I can help with visits from ${this.brand}: accepting invites, picking a time, moving or cancelling a booking, ` +
          `and collecting your post link. Reply PAUSE to stop invites, RESUME to start again. For anything else a human replies in working hours.`,
      });
      return;
    }
    if (creator && conv.step !== 'invite_pending' && (intent?.intent === 'pause' || buttonId === 'pause')) {
      creator.status = 'paused';
      conv.step = 'paused';
      await send({ type: 'text', text: 'Paused. No more invites until you reply RESUME. Any booked visit still stands.' });
      return;
    }

    switch (conv.step) {
      case 'new': {
        await send({
          type: 'buttons',
          text:
            `Hi! This is ${this.brand}. We book local food creators into restaurants near them for a comped meal, in exchange for one honest post.\n\n` +
            `Can we message you here about visits, bookings and reminders? You can reply PAUSE any time.`,
          buttons: [
            { id: 'consent:yes', title: 'Yes, count me in' },
            { id: 'consent:no', title: 'No thanks' },
          ],
        });
        conv.step = 'consent';
        return;
      }
      case 'consent': {
        const yes = buttonId === 'consent:yes' || intent?.intent === 'yes';
        const no = buttonId === 'consent:no' || intent?.intent === 'no';
        if (yes) {
          const c: Creator = {
            id: newId('cr'),
            phone: conv.phone,
            market: conv.market,
            handles: {},
            cuisines: [],
            dietary: [],
            travelKm: conv.market === 'AE' ? 15 : 8,
            monthlyCap: 4,
            status: 'onboarding',
            reliability: { completed: 0, noShows: 0, latePosts: 0 },
            consent: { messaging: true, at: now.toISOString() },
            createdAt: now.toISOString(),
          };
          this.store.creators.put(c);
          conv.creatorId = c.id;
          conv.step = 'ask_name';
          await send({ type: 'text', text: 'Great. What should we call you?' });
        } else if (no) {
          conv.step = 'new';
          await send({ type: 'text', text: 'No problem. Message us again if you change your mind.' });
        } else {
          await send({ type: 'text', text: 'Tap "Yes, count me in" to get started, or "No thanks".' });
        }
        return;
      }
      case 'ask_name': {
        if (!text || !creator) return void (await send({ type: 'text', text: 'Just type your first name.' }));
        creator.name = text.trim().slice(0, 40);
        conv.step = 'ask_handle';
        await send({
          type: 'text',
          text: `Nice to meet you, ${creator.name}. Which account will you post from? Send your Instagram or TikTok handle or profile link.`,
        });
        return;
      }
      case 'ask_handle': {
        if (!text || !creator) return void (await send({ type: 'text', text: 'Send a handle like @yourname or a profile link.' }));
        const parsed = parseHandle(text);
        if (!parsed) return void (await send({ type: 'text', text: 'I could not read that. Try @yourname or a profile link.' }));
        creator.handles[parsed.platform] = parsed.handle;
        conv.step = 'ask_area';
        await send({
          type: 'text',
          text:
            `Got it, ${parsed.platform} @${parsed.handle}. Where are you based? Share your location (📎 → Location) or type your ` +
            (conv.market === 'UK' ? 'postcode or area, e.g. "E2" or "Brixton".' : 'area, e.g. "JLT" or "Business Bay".'),
        });
        return;
      }
      case 'ask_area': {
        if (!creator) return;
        if (msg.kind === 'location') {
          creator.home = { lat: msg.lat, lng: msg.lng };
          creator.area = 'shared location';
        } else if (text) {
          creator.area = text.trim().slice(0, 60);
          creator.home = this.geocoder.geocode(text, conv.market);
        } else {
          return void (await send({ type: 'text', text: 'Share a location pin or type your area.' }));
        }
        conv.step = 'ask_cuisines';
        await send({
          type: 'text',
          text: creator.home
            ? 'Perfect. What do you love eating? List a few cuisines, e.g. "Japanese, Indian, brunch".'
            : 'Thanks. I could not place that exactly, so please also share a location pin when you can. Meanwhile, what do you love eating? e.g. "Japanese, Indian, brunch".',
        });
        return;
      }
      case 'ask_cuisines': {
        if (!creator) return;
        if (msg.kind === 'location') {
          creator.home = { lat: msg.lat, lng: msg.lng };
          return void (await send({ type: 'text', text: 'Location saved. Now, which cuisines do you love?' }));
        }
        if (!text) return void (await send({ type: 'text', text: 'Type a few cuisines separated by commas.' }));
        creator.cuisines = text
          .split(/,|\band\b|\//i)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8);
        conv.step = 'ask_dietary';
        await send({ type: 'buttons', text: 'Any dietary rules we should respect when matching you?', buttons: market.dietaryButtons });
        return;
      }
      case 'ask_dietary': {
        if (!creator) return;
        if (!buttonId?.startsWith('diet:')) {
          return void (await send({ type: 'buttons', text: 'Pick one:', buttons: market.dietaryButtons }));
        }
        const d = buttonId.slice(5) as Dietary;
        creator.dietary = d === 'none' ? [] : [d];
        if (market.requiresAdPermit) {
          conv.step = 'ask_permit';
          await send({
            type: 'buttons',
            text:
              'One more thing. Posting promotional content from the UAE needs a UAE Media Council advertiser permit (free for residents). Do you have one?',
            buttons: [
              { id: 'permit:have', title: 'Yes, I have one' },
              { id: 'permit:none', title: 'Not yet' },
            ],
          });
        } else {
          await this.activate(conv, creator, send, market);
        }
        return;
      }
      case 'ask_permit': {
        if (!creator) return;
        if (buttonId === 'permit:have') {
          conv.data.awaitingPermit = true;
          return void (await send({ type: 'text', text: 'Reply with your permit number and we will verify it before your first invite.' }));
        }
        if (buttonId === 'permit:none') {
          await send({
            type: 'text',
            text: 'Apply at the UAE Media Council portal (it is free for the first three years). Send the permit number here when you have it; invites start once it is verified.',
          });
          await this.activate(conv, creator, send, market);
          return;
        }
        if (text && conv.data.awaitingPermit) {
          creator.adPermit = { number: text.trim().slice(0, 40), verified: false };
          delete conv.data.awaitingPermit;
          await send({ type: 'text', text: 'Thanks, we will verify that within a day.' });
          await this.activate(conv, creator, send, market);
          return;
        }
        await send({ type: 'text', text: 'Tap "Yes, I have one" or "Not yet".' });
        return;
      }
      case 'paused': {
        if (!creator) return;
        if (intent?.intent === 'resume' || buttonId === 'yes' || intent?.intent === 'yes') {
          creator.status = 'active';
          conv.step = 'idle';
          await send({ type: 'text', text: 'Welcome back. Invites are on again.' });
        } else {
          await send({ type: 'text', text: 'You are paused. Reply RESUME to get invites again.' });
        }
        return;
      }
      case 'idle': {
        if (!creator) return;
        if (intent?.intent === 'post_link' && intent.url) {
          const open = this.openBookingFor(creator.id);
          if (open) return void (await this.recordPost(conv, creator, open, intent.url, send, market));
          return void (await send({ type: 'text', text: 'Thanks for the link. I do not have a visit waiting for a post from you, so I have passed it to the team.' }));
        }
        if (intent?.intent === 'reschedule' || intent?.intent === 'cancel' || buttonId === 'reschedule') {
          const upcoming = this.upcomingBooking(creator.id);
          if (!upcoming) return void (await send({ type: 'text', text: 'You have no upcoming visit to change.' }));
          if (intent?.intent === 'cancel') {
            await this.cancelBooking(upcoming, 'creator cancelled');
            conv.step = 'idle';
            return void (await send({ type: 'text', text: 'Cancelled, and the venue has been told. Thanks for the heads-up.' }));
          }
          return void (await this.offerSlots(conv, upcoming.matchId, send, market, upcoming));
        }
        if (intent?.intent === 'confirm' || buttonId === 'confirm') {
          return void (await send({ type: 'text', text: 'Confirmed, see you there.' }));
        }
        await send({
          type: 'text',
          text: `I only handle ${this.brand} visits here. Reply HELP to see what I can do, or wait for your next invite.`,
        });
        return;
      }
      case 'invite_pending': {
        if (!creator) return;
        const matchId = String(conv.data.pendingMatchId ?? '');
        const match = this.store.matches.get(matchId);
        if (!match || match.status !== 'invited') {
          conv.step = 'idle';
          return void (await send({ type: 'text', text: 'That invite has expired. I will send the next one that fits.' }));
        }
        const accepted = buttonId === `accept:${matchId}` || buttonId === 'accept' || intent?.intent === 'accept' || intent?.intent === 'yes';
        const declined = buttonId === `decline:${matchId}` || buttonId === 'decline' || intent?.intent === 'decline' || intent?.intent === 'no';
        if (accepted) {
          match.status = 'accepted';
          match.respondedAt = now.toISOString();
          await this.offerSlots(conv, matchId, send, market);
          return;
        }
        if (declined || intent?.intent === 'pause') {
          match.status = 'declined';
          match.respondedAt = now.toISOString();
          conv.step = 'decline_reason';
          conv.data.declinedMatchId = matchId;
          await send({
            type: 'buttons',
            text: 'No worries. So the next invite is better, what put you off?',
            buttons: [
              { id: 'why:far', title: 'Too far' },
              { id: 'why:food', title: 'Not my food' },
              { id: 'why:time', title: 'Bad timing' },
            ],
          });
          return;
        }
        const r = this.store.restaurants.get(match.restaurantId)!;
        await send({
          type: 'buttons',
          text: `Still keen on ${r.name}? Tap Accept to pick a time, or Decline to pass.`,
          buttons: [
            { id: `accept:${matchId}`, title: 'Accept' },
            { id: `decline:${matchId}`, title: 'Decline' },
          ],
        });
        return;
      }
      case 'decline_reason': {
        if (!creator) return;
        const match = this.store.matches.get(String(conv.data.declinedMatchId ?? ''));
        const r = match ? this.store.restaurants.get(match.restaurantId) : undefined;
        if (buttonId === 'why:far' && r && creator.home) {
          const { haversineKm } = await import('../domain/matching.js');
          const km = haversineKm(creator.home, r.location);
          creator.travelKm = Math.max(2, Math.min(creator.travelKm, Math.floor(km)));
          await send({ type: 'text', text: `Noted. I will keep invites within about ${creator.travelKm}km of you.` });
        } else if (buttonId === 'why:food' && r) {
          creator.cuisines = creator.cuisines.filter((c) => !r.cuisine.map((x) => x.toLowerCase()).includes(c.toLowerCase()));
          conv.data.avoidCuisines = [...new Set([...((conv.data.avoidCuisines as string[]) ?? []), ...r.cuisine])];
          await send({ type: 'text', text: `Noted, fewer ${r.cuisine.join('/')} places.` });
        } else {
          await send({ type: 'text', text: 'Noted. I will try again with the next venue.' });
        }
        conv.step = 'idle';
        delete conv.data.declinedMatchId;
        return;
      }
      case 'pick_slot': {
        if (!creator) return;
        const matchId = String(conv.data.slotMatchId ?? '');
        const match = this.store.matches.get(matchId);
        if (!match) {
          conv.step = 'idle';
          return;
        }
        if (buttonId?.startsWith('slot:')) {
          const at = new Date(buttonId.slice(5));
          const r = this.store.restaurants.get(match.restaurantId)!;
          const stillFree = availableSlots(r, this.store.bookings.all(), market, this.clock.now()).some((s) => s.getTime() === at.getTime());
          if (!stillFree) return void (await this.offerSlots(conv, matchId, send, market));
          const b: Booking = {
            id: newId('bk'),
            matchId,
            restaurantId: r.id,
            creatorId: creator.id,
            at: at.toISOString(),
            guests: r.hospitality.guests,
            status: 'booked',
            remindersSent: [],
            postNudgesSent: 0,
            createdAt: now.toISOString(),
          };
          this.store.bookings.put(b);
          conv.step = 'idle';
          delete conv.data.slotMatchId;
          await send({
            type: 'text',
            text:
              `Booked: ${r.name}, ${formatLocal(at, market)}, table for ${b.guests} under "${creator.name}". ` +
              `Ask for the manager and say you are with ${this.brand}. I will remind you the day before.\n\n${market.disclosure.reminder}`,
          });
          await this.notifyVenue(r, creator, b, market);
          return;
        }
        if (intent?.intent === 'decline' || intent?.intent === 'no' || intent?.intent === 'cancel') {
          match.status = 'declined';
          conv.step = 'idle';
          return void (await send({ type: 'text', text: 'Okay, I have released that spot.' }));
        }
        await this.offerSlots(conv, matchId, send, market);
        return;
      }
      case 'awaiting_post': {
        if (!creator) return;
        const booking = this.store.bookings.get(String(conv.data.bookingId ?? ''));
        if (!booking) {
          conv.step = 'idle';
          return;
        }
        if (intent?.intent === 'post_link' && intent.url) {
          return void (await this.recordPost(conv, creator, booking, intent.url, send, market));
        }
        if (msg.kind === 'media') {
          return void (await send({ type: 'text', text: 'Thanks! Once it is live, send the link to the post itself (not the file) so we can share it with the venue.' }));
        }
        await send({ type: 'text', text: 'Send the link to your post when it is live. Reply HELP if something went wrong with the visit.' });
        return;
      }
      case 'confirm_disclosure': {
        if (!creator) return;
        const post = this.store.posts.get(String(conv.data.postId ?? ''));
        if (!post) {
          conv.step = 'idle';
          return;
        }
        if (buttonId === 'disclosure:yes' || intent?.intent === 'yes' || intent?.intent === 'confirm') {
          post.disclosureConfirmed = true;
          post.status = 'verified';
          const booking = this.store.bookings.get(post.bookingId)!;
          booking.status = 'posted';
          creator.reliability.completed += 1;
          conv.step = 'idle';
          delete conv.data.postId;
          delete conv.data.bookingId;
          await send({ type: 'text', text: `Brilliant, thank you. The venue will see it today. Next invite coming when there is a good fit.` });
          return;
        }
        if (buttonId === 'disclosure:no' || intent?.intent === 'no') {
          await send({ type: 'text', text: `${market.disclosure.reminder}\n\nEdit the caption, then reply DONE.` });
          return;
        }
        await send({
          type: 'buttons',
          text: `Does the post carry "${market.disclosure.label}" at the start of the caption?`,
          buttons: [
            { id: 'disclosure:yes', title: 'Yes it does' },
            { id: 'disclosure:no', title: 'Not yet' },
          ],
        });
        return;
      }
    }
  }

  // ------------------------------------------------------------ proactive sends

  /**
   * Business-initiated message. Within 24h of the creator's last message a free-form
   * message is allowed; outside it we must use an approved template. Outside the
   * market's send window the message is queued for the next allowed time.
   */
  async notify(
    phone: string,
    freeform: Outbound,
    templateMsg: Outbound | undefined,
    opts: { respectWindow?: boolean; stillRelevant?: () => boolean } = {},
  ): Promise<'sent' | 'deferred' | 'skipped'> {
    const conv = this.store.conversationByPhone(phone);
    const market = MARKETS[conv?.market ?? marketForPhone(phone) ?? 'UK'];
    const now = this.clock.now();
    const inWindow = conv?.lastInboundAt ? now.getTime() - new Date(conv.lastInboundAt).getTime() < WINDOW_MS : false;
    const message = inWindow ? freeform : templateMsg;
    if (!message) {
      this.log(`skip ${phone}: outside 24h window and no template`);
      return 'skipped';
    }
    if ((opts.respectWindow ?? true) && !withinSendWindow(now, market)) {
      const sendAt = nextSendTime(now, market);
      this.deferred.push({ to: phone, message, sendAt, stillRelevant: opts.stillRelevant ?? (() => true) });
      this.log(`defer ${phone} until ${sendAt.toISOString()} (quiet hours)`);
      return 'deferred';
    }
    await this.transport.send(phone, message);
    if (conv) conv.lastOutboundAt = now.toISOString();
    return 'sent';
  }

  async flushDeferred(): Promise<number> {
    const now = this.clock.now();
    let n = 0;
    for (let i = this.deferred.length - 1; i >= 0; i--) {
      const d = this.deferred[i];
      if (d.sendAt.getTime() <= now.getTime()) {
        this.deferred.splice(i, 1);
        if (!d.stillRelevant()) {
          this.log(`drop deferred message to ${d.to}: no longer relevant`);
          continue;
        }
        await this.transport.send(d.to, d.message);
        n++;
      }
    }
    return n;
  }

  async sendInvite(restaurant: Restaurant, creator: Creator, score: number, reasons: string[]): Promise<Match | undefined> {
    const conv = this.store.conversationByPhone(creator.phone);
    if (!conv || conv.step !== 'idle') return undefined; // one thing at a time per creator
    const market = MARKETS[restaurant.market];
    const now = this.clock.now();
    const match: Match = {
      id: newId('m'),
      restaurantId: restaurant.id,
      creatorId: creator.id,
      month: monthKey(now, market.timeZone),
      score,
      reasons,
      status: 'invited',
      invitedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.inviteTtlMs).toISOString(),
    };
    const value = formatMoney(restaurant.hospitality.compValueMinor, market);
    const platform = (Object.keys(creator.handles)[0] as Platform | undefined) ?? 'instagram';
    const freeform: Outbound = {
      type: 'buttons',
      text:
        `🍽️ ${restaurant.name} · ${restaurant.area} · ${restaurant.cuisine.join(', ')}\n\n` +
        `They would host you for a ${value} meal for ${restaurant.hospitality.guests}, in exchange for one ${platform} post. ` +
        `${restaurant.hospitality.notes ? restaurant.hospitality.notes + ' ' : ''}Spot held for 24h.`,
      buttons: [
        { id: `accept:${match.id}`, title: 'Accept' },
        { id: `decline:${match.id}`, title: 'Decline' },
      ],
    };
    const tmpl = template('invite', [
      creator.name ?? 'there',
      restaurant.name,
      restaurant.area,
      value,
      String(restaurant.hospitality.guests),
    ]);
    const result = await this.notify(creator.phone, freeform, tmpl, { stillRelevant: () => match.status === 'invited' });
    if (result === 'skipped') return undefined;
    this.store.matches.put(match);
    conv.step = 'invite_pending';
    conv.data.pendingMatchId = match.id;
    return match;
  }

  async sendReminder(booking: Booking, which: '24h' | '2h'): Promise<void> {
    const creator = this.store.creators.get(booking.creatorId)!;
    const r = this.store.restaurants.get(booking.restaurantId)!;
    const market = MARKETS[r.market];
    const when = formatLocal(new Date(booking.at), market);
    const freeform: Outbound = {
      type: 'buttons',
      text: `Reminder: ${r.name}, ${when}, table for ${booking.guests} under "${creator.name}". ${which === '2h' ? 'See you soon!' : 'Still good?'}`,
      buttons: [
        { id: 'confirm', title: 'Confirmed' },
        { id: 'reschedule', title: 'Need to change' },
      ],
    };
    const tmpl = template('reminder', [r.name, when, String(booking.guests), creator.name ?? '']);
    // 2h reminders go regardless of quiet hours: the creator is about to eat there.
    const res = await this.notify(creator.phone, freeform, tmpl, {
      respectWindow: which === '24h',
      stillRelevant: () => booking.status === 'booked' && new Date(booking.at).getTime() > this.clock.now().getTime(),
    });
    if (res !== 'skipped') booking.remindersSent.push(which);
  }

  async requestPost(booking: Booking): Promise<void> {
    const creator = this.store.creators.get(booking.creatorId)!;
    const r = this.store.restaurants.get(booking.restaurantId)!;
    const market = MARKETS[r.market];
    const conv = this.store.conversationByPhone(creator.phone);
    const freeform: Outbound = {
      type: 'text',
      text: `Hope you enjoyed ${r.name}! When your post is live, send the link here so we can share it with the venue.\n\n${market.disclosure.reminder}`,
    };
    const tmpl = template('postRequest', [r.name, `Remember to label it ${market.disclosure.label}.`]);
    const res = await this.notify(creator.phone, freeform, tmpl, { stillRelevant: () => booking.status === 'visited' });
    if (res === 'skipped') return;
    booking.status = 'visited';
    if (conv) {
      conv.step = 'awaiting_post';
      conv.data.bookingId = booking.id;
    }
  }

  async markNoShow(booking: Booking): Promise<void> {
    booking.status = 'no_show';
    const creator = this.store.creators.get(booking.creatorId);
    if (creator) creator.reliability.noShows += 1;
    const match = this.store.matches.get(booking.matchId);
    if (match) match.status = 'declined'; // frees the venue's slot for the month
    const conv = creator && this.store.conversationByPhone(creator.phone);
    if (conv && conv.step === 'awaiting_post') conv.step = 'idle';
  }

  async verifyPermit(creatorId: string): Promise<void> {
    const c = this.store.creators.get(creatorId);
    if (c?.adPermit) c.adPermit.verified = true;
  }

  // ------------------------------------------------------------------ helpers

  private async activate(conv: ConversationState, creator: Creator, send: (m: Outbound) => Promise<void>, market: Market) {
    creator.status = 'active';
    conv.step = 'idle';
    const permitNote =
      market.requiresAdPermit && !creator.adPermit?.verified
        ? ' Invites start as soon as your advertiser permit is verified.'
        : ' First invite lands as soon as a venue near you has a spot this month.';
    await send({
      type: 'text',
      text:
        `You are in, ${creator.name}. Invites come one at a time, within about ${creator.travelKm}km of ${creator.area === 'shared location' ? 'your location' : creator.area}. ` +
        `Accept, pick a time, eat, post, done.${permitNote}\n\nReply PAUSE to stop invites, HELP for options.`,
    });
  }

  private async offerSlots(
    conv: ConversationState,
    matchId: string,
    send: (m: Outbound) => Promise<void>,
    market: Market,
    rescheduling?: Booking,
  ) {
    const match = this.store.matches.get(matchId)!;
    const r = this.store.restaurants.get(match.restaurantId)!;
    if (rescheduling) await this.cancelBooking(rescheduling, 'rescheduling');
    const slots = availableSlots(r, this.store.bookings.all(), market, this.clock.now(), { limit: 10 });
    if (slots.length === 0) {
      conv.step = 'idle';
      return void (await send({ type: 'text', text: `${r.name} has no open slots in the next two weeks. I will come back to you when they do.` }));
    }
    conv.step = 'pick_slot';
    conv.data.slotMatchId = matchId;
    await send({
      type: 'list',
      text: `${rescheduling ? 'New time' : 'Great'} for ${r.name}. Pick a slot (table for ${r.hospitality.guests}):`,
      button: 'Choose a time',
      sections: [{ title: 'Next two weeks', rows: slots.map((s) => ({ id: `slot:${s.toISOString()}`, title: shortSlotLabel(s, market) })) }],
    });
  }

  private async recordPost(
    conv: ConversationState,
    creator: Creator,
    booking: Booking,
    url: string,
    send: (m: Outbound) => Promise<void>,
    market: Market,
  ) {
    const post: Post = {
      id: newId('p'),
      bookingId: booking.id,
      creatorId: creator.id,
      restaurantId: booking.restaurantId,
      platform: /tiktok\.com/i.test(url) ? 'tiktok' : /instagram\.com/i.test(url) ? 'instagram' : 'unknown',
      url,
      submittedAt: this.clock.now().toISOString(),
      disclosureConfirmed: false,
      status: 'submitted',
    };
    this.store.posts.put(post);
    conv.step = 'confirm_disclosure';
    conv.data.postId = post.id;
    conv.data.bookingId = booking.id;
    await send({
      type: 'buttons',
      text: `Got it. Quick check: does the post carry "${market.disclosure.label}" at the start of the caption? (${market.disclosure.regulator})`,
      buttons: [
        { id: 'disclosure:yes', title: 'Yes it does' },
        { id: 'disclosure:no', title: 'Not yet' },
      ],
    });
  }

  private async cancelBooking(b: Booking, reason: string) {
    b.status = 'cancelled';
    const r = this.store.restaurants.get(b.restaurantId);
    const c = this.store.creators.get(b.creatorId);
    if (reason !== 'rescheduling') {
      const match = this.store.matches.get(b.matchId);
      if (match) match.status = 'declined';
    }
    if (r && c) {
      await this.transport.send(r.contactPhone, {
        type: 'text',
        text: `${this.brand}: ${c.name} (@${Object.values(c.handles)[0] ?? ''}) can no longer make ${formatLocal(new Date(b.at), MARKETS[r.market])}${
          reason === 'rescheduling' ? ' and is picking a new time.' : '. We are lining up a replacement.'
        }`,
      });
    }
  }

  private async notifyVenue(r: Restaurant, c: Creator, b: Booking, market: Market) {
    const handle = Object.values(c.handles)[0] ?? '';
    await this.transport.send(
      r.contactPhone,
      template('venueBooking', [c.name ?? 'A creator', `@${handle}`, formatLocal(new Date(b.at), market), String(b.guests)]),
    );
  }

  private openBookingFor(creatorId: string): Booking | undefined {
    return this.store.bookings.find((b) => b.creatorId === creatorId && b.status === 'visited')[0];
  }

  private upcomingBooking(creatorId: string): Booking | undefined {
    const now = this.clock.now().getTime();
    return this.store.bookings
      .find((b) => b.creatorId === creatorId && b.status === 'booked' && new Date(b.at).getTime() > now)
      .sort((a, b) => a.at.localeCompare(b.at))[0];
  }
}

export function parseHandle(text: string): { platform: Platform; handle: string } | undefined {
  const t = text.trim();
  const url = t.match(/(?:instagram\.com|tiktok\.com)\/@?([A-Za-z0-9._]+)/i);
  if (url) return { platform: /tiktok/i.test(t) ? 'tiktok' : 'instagram', handle: url[1] };
  const at = t.match(/^@?([A-Za-z0-9._]{2,30})(?:\s+(?:on\s+)?(instagram|ig|tiktok|tt))?$/i);
  if (at) {
    const p = at[2]?.toLowerCase();
    return { platform: p === 'tiktok' || p === 'tt' ? 'tiktok' : 'instagram', handle: at[1] };
  }
  return undefined;
}
