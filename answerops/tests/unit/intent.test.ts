import { describe, it, expect } from 'vitest';
import { classifyIntent, clusterDemand, assertNoBlending, jaccard, tokenize, promptVariantsFor, INTENT_WEIGHT } from '../../src/domain/intent.js';

const BRAND = ['Vanar', 'vanarchain'];

describe('intent classification', () => {
  it('separates unaided discovery from branded reputation for the same shape of question', () => {
    expect(classifyIntent('best l1 blockchain for payments')).toBe('unaided_discovery');
    expect(classifyIntent('is Vanar legitimate', BRAND)).toBe('branded_reputation');
  });

  it('recognises comparison regardless of branding', () => {
    expect(classifyIntent('vanar vs base', BRAND)).toBe('comparison');
    expect(classifyIntent('polygon versus solana')).toBe('comparison');
    expect(classifyIntent('alternatives to stripe')).toBe('comparison');
  });

  it('recognises transactional intent', () => {
    expect(classifyIntent('where can I buy VANRY', BRAND)).toBe('transactional');
    expect(classifyIntent('how much does it cost')).toBe('transactional');
  });

  it('recognises support and navigational intent', () => {
    expect(classifyIntent('how do I migrate my tokens', BRAND)).toBe('support');
    expect(classifyIntent('vanar docs', BRAND)).toBe('navigational');
  });

  it('recognises factual intent', () => {
    expect(classifyIntent('what is the total supply of VANRY', BRAND)).toBe('factual');
  });

  it('weights transactional above navigational — the ranking is fixed and published', () => {
    expect(INTENT_WEIGHT.transactional).toBeGreaterThan(INTENT_WEIGHT.comparison);
    expect(INTENT_WEIGHT.comparison).toBeGreaterThan(INTENT_WEIGHT.navigational);
  });
});

describe('assertNoBlending', () => {
  it('throws when asked to aggregate across families', () => {
    expect(() => assertNoBlending(['branded_reputation', 'unaided_discovery'])).toThrow(/Refusing to aggregate/);
  });

  it('permits aggregation within one family', () => {
    expect(() => assertNoBlending(['comparison', 'comparison'])).not.toThrow();
  });
});

describe('clustering', () => {
  const inputs = [
    { id: '1', question: 'best l1 blockchain for payments', volume: 880 },
    { id: '2', question: 'best layer 1 blockchain for payments 2026', volume: 300 },
    { id: '3', question: 'vanar vs base', volume: 320 },
    { id: '4', question: 'where can I buy VANRY', volume: 260 },
  ];

  it('groups paraphrases of the same question', () => {
    const clusters = clusterDemand(inputs, BRAND);
    const payments = clusters.find((c) => c.memberIds.includes('1'));
    expect(payments?.memberIds).toContain('2');
  });

  it('never merges across intent families even when wording overlaps', () => {
    const clusters = clusterDemand(
      [
        { id: 'a', question: 'vanar chain fees', volume: 10 },
        { id: 'b', question: 'vanar chain fees vs base fees', volume: 10 },
      ],
      BRAND,
    );
    expect(clusters).toHaveLength(2);
  });

  it('sums volume into the cluster', () => {
    const clusters = clusterDemand(inputs, BRAND);
    const payments = clusters.find((c) => c.memberIds.includes('1'));
    expect(payments?.volume).toBe(1180);
  });

  it('is deterministic across runs', () => {
    const a = JSON.stringify(clusterDemand(inputs, BRAND));
    const b = JSON.stringify(clusterDemand(inputs, BRAND));
    expect(a).toBe(b);
  });
});

describe('token similarity', () => {
  it('ignores stopwords', () => {
    expect(tokenize('what is the best chain for payments')).not.toContain('the');
  });
  it('scores identical token sets at 1', () => {
    expect(jaccard(['a', 'b'], ['b', 'a'])).toBe(1);
  });
});

describe('prompt variants', () => {
  it('produces more than one wording for high-value families', () => {
    expect(promptVariantsFor('Vanar vs Base', 'comparison').length).toBeGreaterThan(1);
  });
});
