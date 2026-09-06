import type { Booking, Creator, GeoPoint, Match, Restaurant } from './types.js';

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface MatchContext {
  /** 'YYYY-MM' being filled */
  month: string;
  /** All matches (any status) already recorded */
  matches: Match[];
  bookings: Booking[];
  now: Date;
  /** Days a creator must wait before revisiting the same venue */
  revisitCooldownDays?: number;
}

export interface Candidate {
  creator: Creator;
  score: number;
  reasons: string[];
}

export interface Exclusion {
  creator: Creator;
  reason: string;
}

/**
 * Hard rules first (exclusions), then a weighted score. The weights are deliberately
 * simple and documented; TryNearby's stated edge is that the agent learns preferences
 * from every conversation, which here is the `cuisines`, `dietary`, `travelKm` and
 * reliability fields being kept fresh by the conversation engine.
 */
export function rankCreators(
  restaurant: Restaurant,
  creators: Creator[],
  ctx: MatchContext,
): { candidates: Candidate[]; excluded: Exclusion[] } {
  const cooldownMs = (ctx.revisitCooldownDays ?? 180) * 86_400_000;
  const candidates: Candidate[] = [];
  const excluded: Exclusion[] = [];

  for (const creator of creators) {
    const reject = (reason: string) => excluded.push({ creator, reason });

    if (creator.market !== restaurant.market) {
      reject('different market');
      continue;
    }
    if (creator.status !== 'active') {
      reject(`status ${creator.status}`);
      continue;
    }
    if (!creator.consent.messaging) {
      reject('no messaging consent');
      continue;
    }
    if (restaurant.market === 'AE' && !creator.adPermit?.verified) {
      reject('UAE advertiser permit not verified');
      continue;
    }
    if ((creator.followers ?? 0) < restaurant.minFollowers) {
      reject(`below venue minimum of ${restaurant.minFollowers} followers`);
      continue;
    }
    if (!creator.home) {
      reject('no location on file');
      continue;
    }
    const km = haversineKm(creator.home, restaurant.location);
    if (km > creator.travelKm) {
      reject(`${km.toFixed(1)}km away, creator travels ${creator.travelKm}km`);
      continue;
    }
    if (creator.dietary.includes('halal') && !restaurant.tags.includes('halal')) {
      reject('creator is halal-only, venue is not halal');
      continue;
    }
    if (creator.dietary.includes('no_alcohol') && restaurant.tags.includes('licensed')) {
      reject('creator avoids licensed venues');
      continue;
    }
    if (
      (creator.dietary.includes('vegetarian') || creator.dietary.includes('vegan')) &&
      !restaurant.tags.some((t) => t === 'vegetarian_friendly' || t === 'vegan_friendly')
    ) {
      reject('creator is veggie/vegan, venue has no suitable options');
      continue;
    }

    const priorHere = ctx.matches.filter(
      (m) => m.creatorId === creator.id && m.restaurantId === restaurant.id,
    );
    if (priorHere.some((m) => m.status === 'invited' || m.status === 'accepted')) {
      reject('already invited or booked at this venue');
      continue;
    }
    if (priorHere.some((m) => m.month === ctx.month && (m.status === 'declined' || m.status === 'expired'))) {
      reject('passed on this venue this month');
      continue;
    }
    const lastVisit = ctx.bookings
      .filter(
        (b) =>
          b.creatorId === creator.id &&
          b.restaurantId === restaurant.id &&
          (b.status === 'visited' || b.status === 'posted'),
      )
      .map((b) => new Date(b.at).getTime())
      .sort((a, b) => b - a)[0];
    if (lastVisit !== undefined && ctx.now.getTime() - lastVisit < cooldownMs) {
      reject('visited recently');
      continue;
    }
    const thisMonth = ctx.matches.filter(
      (m) =>
        m.creatorId === creator.id &&
        m.month === ctx.month &&
        (m.status === 'accepted' || m.status === 'invited'),
    ).length;
    if (thisMonth >= creator.monthlyCap) {
      reject('creator at monthly cap');
      continue;
    }

    // ---- scoring ----
    const reasons: string[] = [];
    let score = 0;

    const proximity = Math.max(0, 1 - km / creator.travelKm); // 1 = next door
    score += 40 * proximity;
    reasons.push(`${km.toFixed(1)}km away`);

    const cuisineHits = restaurant.cuisine.filter((c) =>
      creator.cuisines.some((cc) => cc.toLowerCase() === c.toLowerCase()),
    );
    if (cuisineHits.length) {
      score += 30;
      reasons.push(`likes ${cuisineHits.join(', ')}`);
    }

    const total = creator.reliability.completed + creator.reliability.noShows;
    const reliability = total === 0 ? 0.6 : creator.reliability.completed / total;
    score += 20 * reliability;
    if (creator.reliability.noShows > 0) reasons.push(`${creator.reliability.noShows} no-show(s)`);
    if (creator.reliability.latePosts > 0) {
      score -= 5 * creator.reliability.latePosts;
      reasons.push(`${creator.reliability.latePosts} late post(s)`);
    }

    // Prefer creators who haven't had an invite this month, so the pool rotates.
    if (thisMonth === 0) {
      score += 10;
      reasons.push('no visits yet this month');
    }

    candidates.push({ creator, score: Math.round(score * 10) / 10, reasons });
  }

  candidates.sort((a, b) => b.score - a.score);
  return { candidates, excluded };
}

/** How many more creators a venue can take this month. */
export function openSlots(restaurant: Restaurant, month: string, matches: Match[]): number {
  const taken = matches.filter(
    (m) =>
      m.restaurantId === restaurant.id &&
      m.month === month &&
      (m.status === 'accepted' || m.status === 'invited'),
  ).length;
  return Math.max(0, restaurant.plan.creatorsPerMonth - taken);
}
