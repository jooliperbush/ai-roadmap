/**
 * Temporal truth graph.
 *
 * A fact is not true or false — it is true over an interval. This is what catches the
 * class of defect nobody else catches: an answer that cites a real, reachable, credible
 * source for a fact that stopped being true two years ago. Sourced is not the same as current.
 */

export type Sensitivity = 'routine' | 'material' | 'regulated';

export interface CanonicalClaim {
  id: string;
  tenantId: string;
  brandId: string;
  subject: string;
  predicate: string;
  object: string;
  claimText: string;
  effectiveFrom: string; // ISO date
  effectiveTo: string | null; // null = still current
  supersededById: string | null;
  sourceId: string | null;
  sensitivity: Sensitivity;
  approvedBy: string | null;
  approvedAt: string | null;
}

export function normalizeKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Claims for (subject, predicate) whose interval contains `asOf`. */
export function resolveTruth(
  claims: CanonicalClaim[],
  subject: string,
  predicate: string,
  asOf: Date,
): CanonicalClaim | null {
  const target = [normalizeKey(subject), normalizeKey(predicate)];
  let selected: CanonicalClaim | null = null;
  let newest = -Infinity;
  for (const claim of claims) {
    if (normalizeKey(claim.subject) !== target[0] || normalizeKey(claim.predicate) !== target[1]) continue;
    const start = Date.parse(claim.effectiveFrom);
    if (!(start <= +asOf) || !(claim.effectiveTo === null || Date.parse(claim.effectiveTo) > +asOf)) continue;
    if (start > newest) {
      selected = claim;
      newest = start;
    }
  }
  return selected;
}

/** Every claim ever recorded for (subject, predicate), newest first — the history view. */
export function truthHistory(claims: CanonicalClaim[], subject: string, predicate: string): CanonicalClaim[] {
  const matches = claims.reduce<CanonicalClaim[]>((rows, claim) => {
    if (
      normalizeKey(claim.subject) === normalizeKey(subject) &&
      normalizeKey(claim.predicate) === normalizeKey(predicate)
    )
      rows.push(claim);
    return rows;
  }, []);
  return matches.sort((left, right) => Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom));
}

/** A superseded claim that was true at some earlier point — the source of STALE verdicts. */
export function wasEverTrue(
  claims: CanonicalClaim[],
  subject: string,
  predicate: string,
  objectMatcher: (object: string) => boolean,
): CanonicalClaim | null {
  for (const claim of truthHistory(claims, subject, predicate)) if (objectMatcher(claim.object)) return claim;
  return null;
}

/** Claims whose effectiveTo has passed with no successor — the registry is going stale. */
export function expiringClaims(claims: CanonicalClaim[], asOf: Date, horizonDays = 30): CanonicalClaim[] {
  const cutoff = +asOf + horizonDays * 86_400_000;
  return claims.filter(
    (claim) =>
      claim.effectiveTo !== null &&
      claim.effectiveTo !== '' &&
      claim.supersededById === null &&
      Date.parse(claim.effectiveTo) <= cutoff,
  );
}

/** Object equality with tolerance for phrasing and numbers, but not for meaning. */
export function objectMatches(a: string, b: string): boolean {
  const left = normalizeObject(a),
    right = normalizeObject(b);
  if (left === right) return true;
  const first = extractNumber(a),
    second = extractNumber(b);
  if (first !== null && second !== null) return Math.abs(first - second) < 1e-9;
  const words = [new Set(left.split('_').filter(Boolean)), new Set(right.split('_').filter(Boolean))];
  const size = Math.min(words[0].size, words[1].size);
  return size > 0 && [...words[0]].filter((word) => words[1].has(word)).length / size >= 0.8;
}

export function normalizeObject(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\b(inc|inc\.|llc|ltd|corp|corporation|company|the)\b/g, ' ')
    .replace(/[^a-z0-9.%$]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function extractNumber(s: string): number | null {
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
