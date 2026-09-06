import { openSlots, rankCreators } from '../domain/matching.js';
import { MARKETS } from '../domain/markets.js';
import { monthKey } from '../domain/types.js';
import type { Engine } from './engine.js';

export interface TickReport {
  invitesSent: number;
  invitesExpired: number;
  remindersSent: number;
  postRequests: number;
  postNudges: number;
  deferredFlushed: number;
}

/**
 * The autopilot. Run every few minutes (cron, a worker loop, or a queue consumer):
 *   1. release expired invites so the venue's slot is offered to the next creator,
 *   2. fill each venue's remaining slots for the month, best candidate first,
 *   3. remind creators the day before and two hours before,
 *   4. after the visit, ask for the post link, then nudge twice, then mark it late.
 * Every send goes through Engine.notify, which handles the 24h rule and quiet hours.
 */
export async function tick(engine: Engine): Promise<TickReport> {
  const { store } = engine;
  const now = engine.clock.now();
  const report: TickReport = { invitesSent: 0, invitesExpired: 0, remindersSent: 0, postRequests: 0, postNudges: 0, deferredFlushed: 0 };

  report.deferredFlushed = await engine.flushDeferred();

  // 1. expire invites
  for (const m of store.matches.find((m) => m.status === 'invited' && new Date(m.expiresAt).getTime() <= now.getTime())) {
    m.status = 'expired';
    report.invitesExpired++;
    const c = store.creators.get(m.creatorId);
    const conv = c && store.conversationByPhone(c.phone);
    if (conv && conv.step === 'invite_pending' && conv.data.pendingMatchId === m.id) {
      conv.step = 'idle';
      delete conv.data.pendingMatchId;
      await engine.notify(c.phone, { type: 'text', text: 'That spot has gone to someone else. No problem, the next one is yours if it fits.' }, undefined);
    }
  }

  // 2. fill venues
  for (const r of store.restaurants.find((r) => r.plan.status === 'active')) {
    const market = MARKETS[r.market];
    const month = monthKey(now, market.timeZone);
    let open = openSlots(r, month, store.matches.all());
    if (open <= 0) continue;
    const { candidates } = rankCreators(r, store.creators.all(), {
      month,
      matches: store.matches.all(),
      bookings: store.bookings.all(),
      now,
    });
    for (const cand of candidates) {
      if (open <= 0) break;
      const match = await engine.sendInvite(r, cand.creator, cand.score, cand.reasons);
      if (match) {
        open--;
        report.invitesSent++;
      }
    }
  }

  // 3. reminders
  for (const b of store.bookings.find((b) => b.status === 'booked')) {
    const msUntil = new Date(b.at).getTime() - now.getTime();
    if (msUntil <= 0) continue;
    if (msUntil <= 24 * 3_600_000 && msUntil > 2 * 3_600_000 && !b.remindersSent.includes('24h')) {
      await engine.sendReminder(b, '24h');
      report.remindersSent++;
    } else if (msUntil <= 2 * 3_600_000 && !b.remindersSent.includes('2h')) {
      await engine.sendReminder(b, '2h');
      report.remindersSent++;
    }
  }

  // 4. post collection
  for (const b of store.bookings.find((b) => b.status === 'booked' || b.status === 'visited')) {
    const sinceVisit = now.getTime() - new Date(b.at).getTime();
    if (b.status === 'booked' && sinceVisit >= 3 * 3_600_000) {
      await engine.requestPost(b);
      report.postRequests++;
      continue;
    }
    if (b.status === 'visited') {
      const dueNudge = 72 * 3_600_000 * (b.postNudgesSent + 1);
      if (b.postNudgesSent < 2 && sinceVisit >= dueNudge) {
        const c = store.creators.get(b.creatorId)!;
        const r = store.restaurants.get(b.restaurantId)!;
        const market = MARKETS[r.market];
        const res = await engine.notify(
          c.phone,
          { type: 'text', text: `Gentle nudge: ${r.name} is waiting for your post. Send the link here when it is live.` },
          { type: 'template', name: 'nearby_post_request_v1', language: 'en', bodyParams: [r.name, `Remember to label it ${market.disclosure.label}.`], quickReplies: [] },
          { stillRelevant: () => b.status === 'visited' },
        );
        if (res !== 'skipped') {
          b.postNudgesSent++;
          report.postNudges++;
        }
      } else if (b.postNudgesSent >= 2 && sinceVisit >= 10 * 86_400_000 && !b.remindersSent.includes('late')) {
        b.remindersSent.push('late');
        const c = store.creators.get(b.creatorId);
        if (c) c.reliability.latePosts += 1;
      }
    }
  }

  return report;
}
