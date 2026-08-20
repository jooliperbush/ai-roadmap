import { describe, it, expect } from 'vitest';
import {
  wilson, measure, twoProportionTest, probabilityReal, benjaminiHochberg,
  differenceInDifferences, requiredSampleSize, formatMeasurement, normalCdf,
  confidenceFactor, MIN_SAMPLES, MIN_EFFECT,
} from '../../src/domain/stats.js';

describe('Wilson interval', () => {
  it('stays inside [0,1] at the k=0 boundary where the normal approximation does not', () => {
    const w = wilson(0, 10);
    expect(w.low).toBe(0);
    expect(w.high).toBeGreaterThan(0);
    expect(w.high).toBeLessThan(0.35);
  });

  it('stays inside [0,1] at k=n', () => {
    const w = wilson(10, 10);
    expect(w.high).toBeCloseTo(1, 12);
    expect(w.low).toBeGreaterThan(0.65);
    expect(w.low).toBeLessThan(1);
  });

  it('narrows as n grows for the same rate', () => {
    const small = wilson(5, 10);
    const large = wilson(50, 100);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it('matches the published interval for 20/100 within 0.001', () => {
    const w = wilson(20, 100);
    expect(w.low).toBeCloseTo(0.1332, 3);
    expect(w.high).toBeCloseTo(0.2886, 3);
  });
});

describe('measure()', () => {
  it('suppresses the point estimate below the sample floor rather than rounding it', () => {
    const m = measure(1, 2);
    expect(m.sufficient).toBe(false);
    expect(m.point).toBeNull();
    expect(formatMeasurement(m)).toBe('insufficient data (n=2)');
  });

  it('reports point and interval at or above the floor', () => {
    const m = measure(3, MIN_SAMPLES);
    expect(m.sufficient).toBe(true);
    expect(m.point).toBeCloseTo(0.6, 6);
    expect(m.ciLow).toBeLessThan(0.6);
    expect(m.ciHigh).toBeGreaterThan(0.6);
  });

  it('renders asymmetric intervals honestly at the boundary', () => {
    expect(formatMeasurement(measure(10, 10))).toBe('100% (95% CI 72–100%, n=10)');
    expect(formatMeasurement(measure(0, 10))).toBe('0% (95% CI 0–28%, n=10)');
  });

  it('always renders rate, interval and n together', () => {
    expect(formatMeasurement(measure(38, 100))).toBe('38% (95% CI 29–48%, n=100)');
  });

  it('never returns a rate without an interval', () => {
    for (let n = 1; n <= 40; n++) {
      for (let k = 0; k <= n; k++) {
        const m = measure(k, n);
        if (m.point !== null) {
          expect(m.ciLow).not.toBeNull();
          expect(m.ciHigh).not.toBeNull();
        }
      }
    }
  });
});

describe('confidence factor', () => {
  it('penalises wide intervals', () => {
    expect(confidenceFactor(measure(5, 10))).toBeLessThan(confidenceFactor(measure(50, 100)));
  });
});

describe('two-proportion test', () => {
  it('does not fire on a tiny but statistically detectable effect', () => {
    const t = twoProportionTest(500, 10000, 520, 10000);
    expect(Math.abs(t.diff)).toBeLessThan(MIN_EFFECT);
    expect(t.significant).toBe(false);
  });

  it('fires on a large effect with adequate samples', () => {
    const t = twoProportionTest(10, 50, 35, 50);
    expect(t.pValue).toBeLessThan(0.05);
    expect(t.significant).toBe(true);
  });

  it('flags underpowered comparisons instead of asserting them', () => {
    const t = twoProportionTest(0, 2, 2, 2);
    expect(t.underpowered).toBe(true);
    expect(t.significant).toBe(false);
  });

  it('is symmetric in p-value under swap', () => {
    const a = twoProportionTest(10, 40, 25, 40);
    const b = twoProportionTest(25, 40, 10, 40);
    expect(a.pValue).toBeCloseTo(b.pValue, 10);
  });
});

describe('probabilityReal', () => {
  it('is high for a clear improvement and low for a clear regression', () => {
    expect(probabilityReal(5, 50, 30, 50)).toBeGreaterThan(0.99);
    expect(probabilityReal(30, 50, 5, 50)).toBeLessThan(0.01);
  });

  it('sits near 0.5 when nothing moved', () => {
    expect(probabilityReal(20, 50, 20, 50)).toBeCloseTo(0.5, 2);
  });
});

describe('Benjamini-Hochberg', () => {
  it('rejects fewer hypotheses than a naive alpha cut', () => {
    const ps = [0.001, 0.02, 0.03, 0.04, 0.2, 0.5, 0.7, 0.8, 0.9, 0.95];
    const naive = ps.filter((p) => p < 0.05).length;
    const bh = benjaminiHochberg(ps, 0.1).filter((r) => r.rejected).length;
    expect(bh).toBeLessThanOrEqual(naive);
    expect(bh).toBeGreaterThan(0);
  });

  it('returns results in input order with monotone q-values', () => {
    const ps = [0.5, 0.001, 0.2];
    const out = benjaminiHochberg(ps);
    expect(out.map((o) => o.pValue)).toEqual(ps);
    expect(out[1].qValue).toBeLessThanOrEqual(out[2].qValue);
  });

  it('rejects nothing when every p-value is large', () => {
    expect(benjaminiHochberg([0.4, 0.6, 0.9]).some((r) => r.rejected)).toBe(false);
  });
});

describe('difference-in-differences', () => {
  it('subtracts a category-wide movement the control also saw', () => {
    const did = differenceInDifferences(
      { preK: 10, preN: 100, postK: 30, postN: 100 },
      { preK: 10, preN: 100, postK: 20, postN: 100 },
    );
    expect(did).toBeCloseTo(0.1, 6);
  });

  it('falls back to the raw delta with no control', () => {
    expect(differenceInDifferences({ preK: 10, preN: 100, postK: 30, postN: 100 }, null)).toBeCloseTo(0.2, 6);
  });
});

describe('sample size planning', () => {
  it('requires more samples to detect smaller effects', () => {
    expect(requiredSampleSize(0.2, 0.05)).toBeGreaterThan(requiredSampleSize(0.2, 0.3));
  });
});

describe('normalCdf', () => {
  it('is calibrated at the standard quantiles', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe('p-value formatting', () => {
  it('never prints a p-value as exactly zero', async () => {
    const { formatP } = await import('../../src/domain/stats.js');
    expect(formatP(1e-12)).toBe('<0.001');
    expect(formatP(0.0431)).toBe('0.043');
    expect(formatP(null)).toBe('—');
  });
});
