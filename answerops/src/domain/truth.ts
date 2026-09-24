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

/**
 * Every claim for (subject, predicate) in force at `asOf`, newest first. A multi-valued fact
 * (integrations, features) has several rows in force at once, and each of them is true.
 */
export function currentTruths(
  claims: CanonicalClaim[],
  subject: string,
  predicate: string,
  asOf: Date,
): CanonicalClaim[] {
  return truthHistory(claims, subject, predicate).filter(
    (claim) =>
      Date.parse(claim.effectiveFrom) <= +asOf &&
      (claim.effectiveTo === null || Date.parse(claim.effectiveTo) > +asOf),
  );
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
  a = canonicalGrades(a);
  b = canonicalGrades(b);
  const left = normalizeObject(a),
    right = normalizeObject(b);
  if (left === right) return true;
  // Every distinguishing token must agree: "SOC 2 Type I" is not "SOC 2 Type II" and "$48
  // million" is not "$48 billion". A grade or magnitude one side leaves unstated is compatible.
  const grades = [a, b].map((s) => s.match(GRADE_RE)?.[0].replace(/\D+/g, '') ?? null);
  if (grades[0] !== null && grades[1] !== null && grades[0] !== grades[1]) return false;
  const [first, second] = [quantities(a), quantities(b)].sort((x, y) => x.length - y.length);
  if (first.length) {
    const pool = [...second];
    return first.every((quantity) => {
      const index = pool.findIndex((other) => sameQuantity(quantity, other));
      return index >= 0 && pool.splice(index, 1).length === 1;
    });
  }
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

const GRADE_RE = /\b(?:type|tier|level|phase|class|stage|gen(?:eration)?|version)[\s-]*(?:\d+|[ivx]+)\b/i;
const SCALE: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, mn: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9 };
const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10 };

/** "Type II" and "type 2" are one grade: rewrite roman numerals so grades compare as numbers. */
function canonicalGrades(s: string): string {
  return s.replace(new RegExp(GRADE_RE.source, 'gi'), (grade) =>
    grade.replace(/[ivx]+$/i, (numeral) => {
      const values = [...numeral.toLowerCase()].map((letter) => ROMAN[letter]);
      return String(values.reduce((sum, value, i) => sum + (value < (values[i + 1] ?? 0) ? -value : value), 0));
    }),
  );
}

interface Quantity {
  value: number;
  scale: number | null;
}

function quantities(s: string): Quantity[] {
  return [
    ...s.replace(/,(?=\d{3}\b)/g, '').matchAll(/(\d+(?:\.\d+)?)(?:\s?(thousand|million|billion|mn|bn|k|m|b)\b)?/gi),
  ].map((m) => ({ value: Number(m[1]), scale: m[2] ? SCALE[m[2].toLowerCase()] : null }));
}

function sameQuantity(x: Quantity, y: Quantity): boolean {
  const close = (p: number, q: number) => Math.abs(p - q) <= 1e-9 * Math.max(1, Math.abs(p), Math.abs(q));
  if (close(x.value * (x.scale ?? 1), y.value * (y.scale ?? 1))) return true;
  return (x.scale === null || y.scale === null) && close(x.value, y.value);
}
