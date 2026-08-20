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
  effectiveFrom: string;      // ISO date
  effectiveTo: string | null; // null = still current
  supersededById: string | null;
  sourceId: string | null;
  sensitivity: Sensitivity;
  approvedBy: string | null;
  approvedAt: string | null;
}

export function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Claims for (subject, predicate) whose interval contains `asOf`. */
export function resolveTruth(
  claims: CanonicalClaim[],
  subject: string,
  predicate: string,
  asOf: Date,
): CanonicalClaim | null {
  const s = normalizeKey(subject);
  const p = normalizeKey(predicate);
  const t = asOf.getTime();
  const candidates = claims.filter(
    (c) =>
      normalizeKey(c.subject) === s &&
      normalizeKey(c.predicate) === p &&
      new Date(c.effectiveFrom).getTime() <= t &&
      (c.effectiveTo === null || new Date(c.effectiveTo).getTime() > t),
  );
  if (candidates.length === 0) return null;
  // Latest effectiveFrom wins if the registry has overlapping rows.
  candidates.sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime());
  return candidates[0];
}

/** Every claim ever recorded for (subject, predicate), newest first — the history view. */
export function truthHistory(claims: CanonicalClaim[], subject: string, predicate: string): CanonicalClaim[] {
  const s = normalizeKey(subject);
  const p = normalizeKey(predicate);
  return claims
    .filter((c) => normalizeKey(c.subject) === s && normalizeKey(c.predicate) === p)
    .sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime());
}

/** A superseded claim that was true at some earlier point — the source of STALE verdicts. */
export function wasEverTrue(
  claims: CanonicalClaim[],
  subject: string,
  predicate: string,
  objectMatcher: (object: string) => boolean,
): CanonicalClaim | null {
  return (
    truthHistory(claims, subject, predicate).find((c) => objectMatcher(c.object)) ?? null
  );
}

/** Claims whose effectiveTo has passed with no successor — the registry is going stale. */
export function expiringClaims(claims: CanonicalClaim[], asOf: Date, horizonDays = 30): CanonicalClaim[] {
  const horizon = asOf.getTime() + horizonDays * 86400000;
  return claims.filter((c) => {
    if (!c.effectiveTo) return false;
    const to = new Date(c.effectiveTo).getTime();
    return to <= horizon && c.supersededById === null;
  });
}

/** Object equality with tolerance for phrasing and numbers, but not for meaning. */
export function objectMatches(a: string, b: string): boolean {
  const na = normalizeObject(a);
  const nb = normalizeObject(b);
  if (na === nb) return true;
  const numA = extractNumber(a);
  const numB = extractNumber(b);
  if (numA !== null && numB !== null) {
    return Math.abs(numA - numB) < 1e-9;
  }
  const ta = new Set(na.split('_').filter(Boolean));
  const tb = new Set(nb.split('_').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const overlap = inter / Math.min(ta.size, tb.size);
  return overlap >= 0.8;
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
