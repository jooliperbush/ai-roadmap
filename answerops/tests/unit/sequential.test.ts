/**
 * Statistics that survive daily peeking.
 *
 * The simulation test in here is the point of the whole module: it demonstrates that the
 * per-round correction, which is correct within a round, fails badly when a human looks at
 * the same hypothesis every morning for three months.
 */
import { describe, it, expect } from 'vitest';
import {
  evalue, SequentialTest, runSequential, parallelTrends, poolByVersion, versionChangeExplanation,
  hierarchicalVariance, logGamma, E_ALPHA, PARALLEL_TREND_TOLERANCE,
} from '../../src/domain/sequential.js';
import { twoProportionTest, ALPHA } from '../../src/domain/stats.js';

/** Deterministic PRNG, so "the false positive rate is 4%" is a fact and not a mood. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function draw(rng: () => number, n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (rng() < p) k++;
  return k;
}

describe('e-values', () => {
  it('is 1 for an empty look', () => {
    expect(evalue(0, 0, 0.2)).toBe(1);
  });

  it('grows when the data disagrees with the null and stays small when it agrees', () => {
    const agrees = evalue(20, 100, 0.2);
    const disagrees = evalue(60, 100, 0.2);
    expect(disagrees).toBeGreaterThan(agrees);
    expect(agrees).toBeLessThan(1 / E_ALPHA);
  });

  it('accumulates across looks and reports an anytime-valid p-value', () => {
    const t = new SequentialTest(0.2);
    for (let i = 0; i < 10; i++) t.observe({ k: 12, n: 20 });
    expect(t.fired).toBe(true);
    expect(t.pValueAnytime).toBeLessThan(E_ALPHA);
    expect(t.firedAtLook).toBeGreaterThan(0);
  });

  it('stays quiet on a true null across many looks', () => {
    const rng = mulberry32(7);
    const t = new SequentialTest(0.2);
    for (let i = 0; i < 60; i++) t.observe({ k: draw(rng, 25, 0.2), n: 25 });
    expect(t.fired).toBe(false);
  });

  it('computes log-gamma accurately enough for the mixture', () => {
    expect(Math.exp(logGamma(5))).toBeCloseTo(24, 6);
    expect(Math.exp(logGamma(1))).toBeCloseTo(1, 6);
  });
});

describe('peeking every day', () => {
  const SERIES = 300;
  const DAYS = 90;
  const N_PER_DAY = 20;
  const P0 = 0.2;

  it('the per-round test fires on a true null far more often than its own alpha suggests', () => {
    const rng = mulberry32(99);
    let fired = 0;
    for (let s = 0; s < SERIES; s++) {
      const baselineK = draw(rng, 200, P0);
      for (let d = 0; d < DAYS; d++) {
        const k = draw(rng, N_PER_DAY, P0);
        if (twoProportionTest(baselineK, 200, k, N_PER_DAY).pValue < ALPHA) { fired++; break; }
      }
    }
    const rate = fired / SERIES;
    // This is the problem, stated as a number: a 5% test looked at 90 times is not a 5% test.
    expect(rate).toBeGreaterThan(0.2);
  });

  it('the sequential test holds its error rate at or below 5% under the same peeking', () => {
    const rng = mulberry32(99);
    let fired = 0;
    for (let s = 0; s < SERIES; s++) {
      const t = new SequentialTest(P0);
      for (let d = 0; d < DAYS; d++) {
        t.observe({ k: draw(rng, N_PER_DAY, P0), n: N_PER_DAY });
        if (t.fired) { fired++; break; }
      }
    }
    expect(fired / SERIES).toBeLessThanOrEqual(0.05);
  });

  it('still detects a real shift, so the protection is not just silence', () => {
    const rng = mulberry32(4);
    const looks = Array.from({ length: 20 }, () => ({ k: draw(rng, 25, 0.55), n: 25 }));
    expect(runSequential(looks, 0.2).fired).toBe(true);
  });
});

describe('parallel trends', () => {
  it('accepts arms that moved together before the change', () => {
    const check = parallelTrends([
      { treatmentK: 20, treatmentN: 100, controlK: 30, controlN: 100 },
      { treatmentK: 24, treatmentN: 100, controlK: 34, controlN: 100 },
      { treatmentK: 28, treatmentN: 100, controlK: 38, controlN: 100 },
    ]);
    expect(check.parallel).toBe(true);
    expect(check.divergence).toBeLessThanOrEqual(PARALLEL_TREND_TOLERANCE);
  });

  it('rejects arms that were already diverging, and says by how much', () => {
    const check = parallelTrends([
      { treatmentK: 20, treatmentN: 100, controlK: 30, controlN: 100 },
      { treatmentK: 45, treatmentN: 100, controlK: 31, controlN: 100 },
    ]);
    expect(check.parallel).toBe(false);
    expect(check.reason).toMatch(/already diverging/);
  });

  it('refuses to answer with fewer than two pre-periods rather than assuming', () => {
    const check = parallelTrends([{ treatmentK: 1, treatmentN: 10, controlK: 1, controlN: 10 }]);
    expect(check.parallel).toBe(false);
    expect(check.reason).toMatch(/cannot be checked/);
  });
});

describe('version pooling', () => {
  it('reports per version and flags a mixed window', () => {
    const { groups, mixed } = poolByVersion([
      { modelVersion: 'v1', defect: true }, { modelVersion: 'v1', defect: false },
      { modelVersion: 'v2', defect: true }, { modelVersion: 'v2', defect: true },
    ]);
    expect(mixed).toBe(true);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ modelVersion: 'v1', k: 1, n: 2 });
    expect(versionChangeExplanation(groups)).toMatch(/2 model versions/);
  });

  it('says nothing when a window is one version, because there is nothing to explain', () => {
    const { groups, mixed } = poolByVersion([{ modelVersion: 'v1', defect: true }]);
    expect(mixed).toBe(false);
    expect(versionChangeExplanation(groups)).toBeNull();
  });
});

describe('wording versus model variance', () => {
  it('names wording as the problem when the wordings disagree', () => {
    const split = hierarchicalVariance([
      { variantId: 'a', k: 1, n: 20 },
      { variantId: 'b', k: 18, n: 20 },
      { variantId: 'c', k: 2, n: 20 },
    ]);
    expect(split.icc).toBeGreaterThan(0.5);
    expect(split.interpretation).toMatch(/wordings disagree/);
  });

  it('names the model as the problem when the wordings agree', () => {
    const split = hierarchicalVariance([
      { variantId: 'a', k: 10, n: 20 },
      { variantId: 'b', k: 10, n: 20 },
      { variantId: 'c', k: 11, n: 20 },
    ]);
    expect(split.icc).toBeLessThan(0.5);
    expect(split.interpretation).toMatch(/model is inconsistent/);
  });

  it('refuses to split with one wording', () => {
    expect(hierarchicalVariance([{ variantId: 'a', k: 1, n: 5 }]).interpretation).toMatch(/cannot be separated/);
  });
});
