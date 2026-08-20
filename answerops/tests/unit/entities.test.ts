import { describe, it, expect } from 'vitest';
import { resolveRelation, comentionCandidate, extractCandidateEntities, WeakBasisError, RELATIONS } from '../../src/domain/entities.js';

describe('entity relationships', () => {
  it('refuses to call something a competitor on co-mention alone', () => {
    expect(() => resolveRelation('competitor', 'observed_comention')).toThrow(WeakBasisError);
  });

  it('accepts a competitor edge on a declared, registry or contractual basis', () => {
    expect(resolveRelation('competitor', 'customer_declared')).toBe('competitor');
    expect(resolveRelation('partner', 'contract')).toBe('partner');
    expect(resolveRelation('competitor', 'market_registry')).toBe('competitor');
  });

  it('allows an unrelated co-mention edge from co-mention', () => {
    expect(resolveRelation('unrelated_comention', 'observed_comention')).toBe('unrelated_comention');
  });

  it('produces low-confidence candidates awaiting human classification', () => {
    const c = comentionCandidate('Slack', 4);
    expect(c.relation).toBe('unrelated_comention');
    expect(c.confidence).toBeLessThanOrEqual(0.5);
    expect(c.note).toMatch(/not a market relationship/i);
  });

  it('models every relation type the graph needs', () => {
    expect(RELATIONS).toContain('integration');
    expect(RELATIONS).toContain('publisher');
    expect(RELATIONS).toContain('review_site');
    expect(RELATIONS).toContain('parent');
  });
});

describe('candidate extraction', () => {
  it('finds organisation-shaped names and excludes the brand itself', () => {
    const names = extractCandidateEntities('Vanar competes with Base and Polygon in this space.', 'Vanar');
    expect(names).toContain('Base');
    expect(names).toContain('Polygon');
    expect(names).not.toContain('Vanar');
  });

  it('does not treat sentence-initial common words as entities', () => {
    const names = extractCandidateEntities('The answer is unclear. However, Base is popular.', 'Vanar');
    expect(names).not.toContain('The');
    expect(names).not.toContain('However');
  });
});
