import { describe, it, expect } from 'vitest';
import { computePriority, deriveExpectedRange, FIXABILITY, ACTION_TYPES, isActionType, quantile } from '../../src/domain/priority.js';
import { measure } from '../../src/domain/stats.js';

const BASE = { demandWeight: 0.5, intentFamily: 'comparison' as const, economicValue: 0.8, actionType: 'update_owned_page' as const };

describe('priority formula', () => {
  it('is the product of its six published factors', () => {
    const p = computePriority({ ...BASE, defect: measure(30, 100) });
    const product = p.demand * p.buyerIntent * p.economicValue * p.defectProbability * p.fixability * p.confidence;
    expect(p.score).toBeCloseTo(product, 12);
  });

  it('uses the Wilson lower bound so a 1-of-2 observation cannot outrank 30-of-100', () => {
    const tiny = computePriority({ ...BASE, defect: measure(1, 2) });
    const solid = computePriority({ ...BASE, defect: measure(30, 100) });
    expect(solid.score).toBeGreaterThan(tiny.score);
  });

  it('halves confidence below the sample floor and says so', () => {
    const p = computePriority({ ...BASE, defect: measure(2, 4) });
    expect(p.explanation).toMatch(/below the 5-run floor/);
  });

  it('ranks transactional intent above navigational at equal evidence', () => {
    const t = computePriority({ ...BASE, intentFamily: 'transactional', defect: measure(30, 100) });
    const n = computePriority({ ...BASE, intentFamily: 'navigational', defect: measure(30, 100) });
    expect(t.score).toBeGreaterThan(n.score);
  });

  it('scores zero when nothing is wrong', () => {
    expect(computePriority({ ...BASE, defect: measure(0, 100) }).score).toBe(0);
  });

  it('explains itself in a form a customer can recompute', () => {
    const p = computePriority({ ...BASE, defect: measure(30, 100) });
    expect(p.explanation).toMatch(/demand .* x intent .* x value .* x defect\(lower bound\)/);
  });
});

describe('expected range', () => {
  const cohort = [
    { experimentId: 'e1', actionType: 'update_owned_page' as const, baselineRate: 0.1, postRate: 0.3 },
    { experimentId: 'e2', actionType: 'update_owned_page' as const, baselineRate: 0.2, postRate: 0.35 },
    { experimentId: 'e3', actionType: 'update_owned_page' as const, baselineRate: 0.05, postRate: 0.3 },
  ];

  it('returns null without a comparable cohort — we never invent an impact number', () => {
    expect(deriveExpectedRange('update_owned_page', cohort.slice(0, 2))).toBeNull();
    expect(deriveExpectedRange('publisher_correction_packet', cohort)).toBeNull();
  });

  it('derives an interquartile range from this workspace’s own confirmed experiments', () => {
    const r = deriveExpectedRange('update_owned_page', cohort)!;
    expect(r.cohortSize).toBe(3);
    expect(r.low).toBeLessThanOrEqual(r.high);
    expect(r.basis).toMatch(/previously confirmed/);
  });
});

describe('action catalogue', () => {
  it('is closed — spam vectors are absent and rejected', () => {
    for (const banned of ['post_to_reddit', 'generate_reviews', 'create_synthetic_mentions', 'buy_backlinks']) {
      expect(isActionType(banned)).toBe(false);
    }
  });

  it('assigns every action type a fixability prior', () => {
    for (const t of ACTION_TYPES) expect(typeof FIXABILITY[t]).toBe('number');
  });

  it('rates third-party corrections as less fixable than owned pages — we do not control publishers', () => {
    expect(FIXABILITY.publisher_correction_packet).toBeLessThan(FIXABILITY.update_owned_page);
  });
});

describe('quantile', () => {
  it('interpolates', () => {
    expect(quantile([0, 1, 2, 3], 0.5)).toBeCloseTo(1.5, 6);
  });
});
