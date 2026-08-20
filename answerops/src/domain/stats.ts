/**
 * Statistical contract for AnswerOps.
 *
 * LLM outputs are non-deterministic. Every rate this product displays must carry its
 * sample size and a 95% interval, and no alert may fire on noise. These primitives are
 * the only sanctioned way to turn counts into numbers a customer sees.
 */

export const Z_95 = 1.959963984540054;
export const MIN_SAMPLES = 5;
export const MAX_SAMPLES = 20;
export const MIN_EFFECT = 0.1;
export const ALPHA = 0.05;
export const BH_Q = 0.1;

export interface Measurement {
  k: number;
  n: number;
  /** point estimate, null when n < MIN_SAMPLES — we suppress rather than round */
  point: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  method: 'wilson';
  sufficient: boolean;
}

/** Wilson score interval — correct at k=0 and k=n, unlike the normal approximation. */
export function wilson(k: number, n: number, z = Z_95): { low: number; high: number; centre: number } {
  if (n <= 0) return { low: 0, high: 1, centre: 0 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  // At the boundaries the interval is exactly [0, x] or [x, 1]; pin them so floating-point
  // residue never leaks a "0.0000000001% defect rate" into a ranking or a headline.
  const low = k === 0 ? 0 : Math.max(0, centre - half);
  const high = k === n ? 1 : Math.min(1, centre + half);
  return { low, high, centre };
}

export function measure(k: number, n: number): Measurement {
  if (n < MIN_SAMPLES) {
    return { k, n, point: null, ciLow: null, ciHigh: null, method: 'wilson', sufficient: false };
  }
  const w = wilson(k, n);
  return { k, n, point: k / n, ciLow: w.low, ciHigh: w.high, method: 'wilson', sufficient: true };
}

/** Half-width of the interval — used as the Confidence factor in prioritisation. */
export function ciWidth(m: Measurement): number {
  if (!m.sufficient || m.ciLow === null || m.ciHigh === null) return 1;
  return m.ciHigh - m.ciLow;
}

export function confidenceFactor(m: Measurement): number {
  const w = ciWidth(m);
  return Math.min(1, Math.max(0, 1 - w / 2));
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf approximation). */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

export interface TwoProportionTest {
  p1: number;
  p2: number;
  diff: number;
  z: number;
  /** two-sided p-value */
  pValue: number;
  /** one-sided p-value for "group 2 is greater than group 1" */
  pValueOneSided: number;
  significant: boolean;
  underpowered: boolean;
}

/**
 * Pooled two-proportion z-test. Group 1 is baseline, group 2 is current/treatment.
 * `significant` requires BOTH p < ALPHA and |effect| >= MIN_EFFECT: statistical
 * significance on a trivial effect is not a reason to wake a customer up.
 */
export function twoProportionTest(k1: number, n1: number, k2: number, n2: number): TwoProportionTest {
  const underpowered = n1 < MIN_SAMPLES || n2 < MIN_SAMPLES;
  if (n1 <= 0 || n2 <= 0) {
    return { p1: 0, p2: 0, diff: 0, z: 0, pValue: 1, pValueOneSided: 1, significant: false, underpowered: true };
  }
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const diff = p2 - p1;
  const pool = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n2));
  const z = se === 0 ? 0 : diff / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  const pValueOneSided = 1 - normalCdf(z);
  return {
    p1, p2, diff, z,
    pValue,
    pValueOneSided,
    significant: !underpowered && pValue < ALPHA && Math.abs(diff) >= MIN_EFFECT,
    underpowered,
  };
}

/** Probability the improvement is real = 1 - one-sided p. Frequentist complement, not a posterior. */
export function probabilityReal(k1: number, n1: number, k2: number, n2: number): number {
  const t = twoProportionTest(k1, n1, k2, n2);
  return Math.min(1, Math.max(0, 1 - t.pValueOneSided));
}

/**
 * Benjamini-Hochberg step-up. Returns per-input {pValue, qValue, rejected} in input order.
 * Used so scanning 100 clusters does not manufacture 5 false alerts.
 */
export function benjaminiHochberg(pValues: number[], q = BH_Q): Array<{ pValue: number; qValue: number; rejected: boolean }> {
  const m = pValues.length;
  if (m === 0) return [];
  const indexed = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const out = new Array<{ pValue: number; qValue: number; rejected: boolean }>(m);
  let maxRejectRank = -1;
  for (let rank = 0; rank < m; rank++) {
    const entry = indexed[rank];
    if (entry.p <= ((rank + 1) / m) * q) maxRejectRank = rank;
  }
  // monotone q-values
  let running = 1;
  for (let rank = m - 1; rank >= 0; rank--) {
    const entry = indexed[rank];
    running = Math.min(running, (entry.p * m) / (rank + 1));
    out[entry.i] = { pValue: entry.p, qValue: Math.min(1, running), rejected: rank <= maxRejectRank };
  }
  return out;
}

export interface DidTest {
  effect: number;
  se: number;
  z: number;
  pValue: number;
  pValueOneSided: number;
}

/**
 * z-test on the difference-in-differences of four proportions. Variance uses the
 * Agresti-adjusted estimate (k+0.5)/(n+1) so a control that happens to be 0/20 or 20/20
 * contributes real uncertainty instead of a zero that manufactures false confidence.
 */
export function didTest(
  treatment: { preK: number; preN: number; postK: number; postN: number },
  control: { preK: number; preN: number; postK: number; postN: number },
): DidTest {
  const v = (k: number, n: number) => {
    if (n <= 0) return 0;
    const p = (k + 0.5) / (n + 1);
    return (p * (1 - p)) / n;
  };
  const effect = differenceInDifferences(treatment, control);
  const se = Math.sqrt(
    v(treatment.preK, treatment.preN) + v(treatment.postK, treatment.postN) +
    v(control.preK, control.preN) + v(control.postK, control.postN),
  );
  const z = se === 0 ? 0 : effect / se;
  return { effect, se, z, pValue: 2 * (1 - normalCdf(Math.abs(z))), pValueOneSided: 1 - normalCdf(z) };
}

/** Difference-in-differences on proportions: (T_post - T_pre) - (C_post - C_pre). */
export function differenceInDifferences(
  treatment: { preK: number; preN: number; postK: number; postN: number },
  control: { preK: number; preN: number; postK: number; postN: number } | null,
): number {
  const tDelta = treatment.postN && treatment.preN ? treatment.postK / treatment.postN - treatment.preK / treatment.preN : 0;
  if (!control || !control.preN || !control.postN) return tDelta;
  const cDelta = control.postK / control.postN - control.preK / control.preN;
  return tDelta - cDelta;
}

/** Sample size needed to detect `effect` at the given base rate (two-sided, 80% power). */
export function requiredSampleSize(baseRate: number, effect: number, power = 0.8): number {
  const zAlpha = Z_95;
  const zBeta = power >= 0.9 ? 1.2816 : 0.8416;
  const p1 = Math.min(0.999, Math.max(0.001, baseRate));
  const p2 = Math.min(0.999, Math.max(0.001, baseRate + effect));
  const pBar = (p1 + p2) / 2;
  const num = zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil((num * num) / ((p2 - p1) * (p2 - p1)));
}

/** p-values round to 0.000 long before they are zero; say what we mean. */
export function formatP(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  if (p < 0.001) return '<0.001';
  return p.toFixed(3);
}

/**
 * Render a measurement the only way it is allowed to appear: rate, interval, n.
 * The interval is printed as explicit bounds rather than "± x" because a Wilson interval is
 * asymmetric — "100% ± 14%" is not a thing, and at the boundaries the ± form actively lies.
 */
export function formatMeasurement(m: Measurement, digits = 0): string {
  if (!m.sufficient || m.point === null || m.ciLow === null || m.ciHigh === null) {
    return `insufficient data (n=${m.n})`;
  }
  const pct = (x: number) => `${(x * 100).toFixed(digits)}%`;
  const num = (x: number) => (x * 100).toFixed(digits);
  return `${pct(m.point)} (95% CI ${num(m.ciLow)}–${num(m.ciHigh)}%, n=${m.n})`;
}
