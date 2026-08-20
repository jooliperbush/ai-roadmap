import { describe, it, expect } from 'vitest';
import { resolveTruth, truthHistory, objectMatches, expiringClaims, CanonicalClaim, normalizeObject } from '../../src/domain/truth.js';

function claim(p: Partial<CanonicalClaim>): CanonicalClaim {
  return {
    id: p.id ?? 'c1', tenantId: 't', brandId: 'b',
    subject: p.subject ?? 'Vanar', predicate: p.predicate ?? 'acquired_by',
    object: p.object ?? 'Terra Virtua', claimText: p.claimText ?? '',
    effectiveFrom: p.effectiveFrom ?? '2021-01-01T00:00:00.000Z',
    effectiveTo: p.effectiveTo ?? null,
    supersededById: p.supersededById ?? null, sourceId: null,
    sensitivity: p.sensitivity ?? 'material', approvedBy: 'a', approvedAt: 'x',
  };
}

const HISTORY = [
  claim({ id: 'old', object: 'Terra Virtua', effectiveFrom: '2021-01-01T00:00:00.000Z', effectiveTo: '2023-11-01T00:00:00.000Z' }),
  claim({ id: 'new', object: 'Vanar Foundation', effectiveFrom: '2023-11-01T00:00:00.000Z', effectiveTo: null }),
];

describe('temporal resolution', () => {
  it('returns the fact in force at a past date', () => {
    expect(resolveTruth(HISTORY, 'Vanar', 'acquired_by', new Date('2022-06-01'))?.id).toBe('old');
  });

  it('returns the current fact for today', () => {
    expect(resolveTruth(HISTORY, 'Vanar', 'acquired_by', new Date('2026-08-19'))?.id).toBe('new');
  });

  it('treats the interval as half-open so the boundary date belongs to the successor', () => {
    expect(resolveTruth(HISTORY, 'Vanar', 'acquired_by', new Date('2023-11-01T00:00:00.000Z'))?.id).toBe('new');
  });

  it('returns null before any fact was in force', () => {
    expect(resolveTruth(HISTORY, 'Vanar', 'acquired_by', new Date('2019-01-01'))).toBeNull();
  });

  it('is insensitive to predicate and subject formatting', () => {
    expect(resolveTruth(HISTORY, '  vanar ', 'Acquired By', new Date('2026-01-01'))?.id).toBe('new');
  });
});

describe('history', () => {
  it('returns every version newest first', () => {
    expect(truthHistory(HISTORY, 'Vanar', 'acquired_by').map((c) => c.id)).toEqual(['new', 'old']);
  });
});

describe('object matching', () => {
  it('ignores legal suffixes and punctuation', () => {
    expect(objectMatches('HubSpot, Inc.', 'HubSpot')).toBe(true);
  });
  it('compares numbers numerically', () => {
    expect(objectMatches('$0.0002', '0.0002')).toBe(true);
    expect(objectMatches('2.4 billion', '3 billion')).toBe(false);
  });
  it('does not match different companies', () => {
    expect(objectMatches('ZoomInfo', 'HubSpot')).toBe(false);
  });
  it('normalises consistently', () => {
    expect(normalizeObject('The Acme Corporation')).toBe('acme');
  });
});

describe('registry hygiene', () => {
  it('flags facts that expire with no successor', () => {
    const rows = [claim({ id: 'x', effectiveTo: '2026-08-25T00:00:00.000Z', supersededById: null })];
    expect(expiringClaims(rows, new Date('2026-08-19')).map((c) => c.id)).toEqual(['x']);
  });
  it('does not flag facts already superseded', () => {
    const rows = [claim({ id: 'x', effectiveTo: '2026-08-25T00:00:00.000Z', supersededById: 'y' })];
    expect(expiringClaims(rows, new Date('2026-08-19'))).toHaveLength(0);
  });
});
