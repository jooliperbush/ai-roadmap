/**
 * Statistical contract for Miscited.
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
  const successes = k / n;
  const square = z ** 2;
  const adjustment = 1 + square / n;
  const centre = (successes + square / (2 * n)) / adjustment;
  const radius = (z / adjustment) * Math.sqrt((successes * (1 - successes)) / n + square / (4 * n ** 2));
  return {
    centre,
    low: k === 0 ? 0 : Math.max(centre - radius, 0),
    high: k === n ? 1 : Math.min(centre + radius, 1),
  };
}

export function measure(k: number, n: number): Measurement {
  const sufficient = n >= MIN_SAMPLES;
  const interval = sufficient ? wilson(k, n) : null;
  return {
    k,
    n,
    method: 'wilson',
    sufficient,
    point: sufficient ? k / n : null,
    ciLow: interval?.low ?? null,
    ciHigh: interval?.high ?? null,
  };
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
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
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
  if (n1 <= 0 || n2 <= 0)
    return {
      p1: 0,
      p2: 0,
      diff: 0,
      z: 0,
      pValue: 1,
      pValueOneSided: 1,
      significant: false,
      underpowered: true,
    };
  const rates = [k1 / n1, k2 / n2];
  const diff = rates[1] - rates[0];
  const pooled = (k1 + k2) / (n1 + n2);
  const variance = pooled * (1 - pooled) * (1 / n1 + 1 / n2);
  const z = variance === 0 ? 0 : diff / Math.sqrt(variance);
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  const underpowered = Math.min(n1, n2) < MIN_SAMPLES;
  return {
    p1: rates[0],
    p2: rates[1],
    diff,
    z,
    pValue,
    pValueOneSided: 1 - normalCdf(z),
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
export function benjaminiHochberg(
  pValues: number[],
  q = BH_Q,
): Array<{ pValue: number; qValue: number; rejected: boolean }> {
  const ranked = pValues
    .map((pValue, position) => ({ pValue, position }))
    .sort((a, b) => a.pValue - b.pValue);
  let cutoff = 0;
  ranked.forEach((entry, index) => {
    if (entry.pValue <= ((index + 1) / ranked.length) * q) cutoff = index + 1;
  });
  let adjusted = 1;
  const results = ranked.map((entry) => ({ pValue: entry.pValue, qValue: 1, rejected: false }));
  for (let index = ranked.length - 1; index >= 0; index--) {
    const entry = ranked[index];
    adjusted = Math.min(adjusted, (entry.pValue * ranked.length) / (index + 1));
    results[entry.position] = {
      pValue: entry.pValue,
      qValue: Math.min(1, adjusted),
      rejected: index < cutoff,
    };
  }
  return results;
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
  const cells = [
    [treatment.preK, treatment.preN],
    [treatment.postK, treatment.postN],
    [control.preK, control.preN],
    [control.postK, control.postN],
  ];
  const variance = cells.reduce((sum, [k, n]) => {
    if (n <= 0) return sum;
    const adjusted = (k + 0.5) / (n + 1);
    return sum + (adjusted * (1 - adjusted)) / n;
  }, 0);
  const effect = differenceInDifferences(treatment, control),
    se = Math.sqrt(variance);
  const z = se > 0 ? effect / se : 0;
  return { effect, se, z, pValue: 2 * (1 - normalCdf(Math.abs(z))), pValueOneSided: 1 - normalCdf(z) };
}

/** Difference-in-differences on proportions: (T_post - T_pre) - (C_post - C_pre). */
export function differenceInDifferences(
  treatment: { preK: number; preN: number; postK: number; postN: number },
  control: { preK: number; preN: number; postK: number; postN: number } | null,
): number {
  const delta = (arm: typeof treatment) =>
    arm.preN && arm.postN ? arm.postK / arm.postN - arm.preK / arm.preN : 0;
  return delta(treatment) - (control ? delta(control) : 0);
}

/** Sample size needed to detect `effect` at the given base rate (two-sided, 80% power). */
export function requiredSampleSize(baseRate: number, effect: number, power = 0.8): number {
  const clamp = (rate: number) => Math.min(0.999, Math.max(0.001, rate));
  const baseline = clamp(baseRate),
    post = clamp(baseRate + effect);
  const pooled = (baseline + post) / 2;
  const targetZ = power >= 0.9 ? 1.2816 : 0.8416;
  const numerator =
    Z_95 * Math.sqrt(2 * pooled * (1 - pooled)) +
    targetZ * Math.sqrt(baseline * (1 - baseline) + post * (1 - post));
  return Math.ceil(numerator ** 2 / (post - baseline) ** 2);
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
