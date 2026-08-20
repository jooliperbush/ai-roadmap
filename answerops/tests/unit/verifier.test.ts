import { describe, it, expect } from 'vitest';
import {
  extractClaims, verifyClaim, classifyBrandRole, checkCitation, classifySource,
  splitSentences, adjudicate, misconception,
} from '../../src/domain/verifier.js';
import type { CanonicalClaim } from '../../src/domain/truth.js';

function claim(p: Partial<CanonicalClaim>): CanonicalClaim {
  return {
    id: p.id ?? 'c', tenantId: 't', brandId: 'b',
    subject: p.subject ?? 'Vanar', predicate: p.predicate ?? 'acquired_by',
    object: p.object ?? 'Vanar Foundation', claimText: p.claimText ?? 'canonical',
    effectiveFrom: p.effectiveFrom ?? '2023-11-01T00:00:00.000Z',
    effectiveTo: p.effectiveTo ?? null, supersededById: null, sourceId: null,
    sensitivity: p.sensitivity ?? 'material', approvedBy: 'a', approvedAt: 'x',
  };
}

const REGISTRY: CanonicalClaim[] = [
  claim({ id: 'acq_old', object: 'Terra Virtua', effectiveFrom: '2021-01-01T00:00:00.000Z', effectiveTo: '2023-11-01T00:00:00.000Z' }),
  claim({ id: 'acq_new', object: 'Vanar Foundation', effectiveFrom: '2023-11-01T00:00:00.000Z' }),
  claim({ id: 'fees', predicate: 'fees', object: '$0.0002', effectiveFrom: '2025-01-15T00:00:00.000Z', sensitivity: 'material' }),
  claim({ id: 'staking', predicate: 'feature_support', object: 'staking', effectiveFrom: '2024-06-01T00:00:00.000Z', sensitivity: 'material' }),
  claim({ id: 'supply', predicate: 'token_supply', object: '2.4 billion', effectiveFrom: '2024-01-01T00:00:00.000Z', sensitivity: 'regulated' }),
  claim({ id: 'hq', predicate: 'headquarters', object: 'London', effectiveFrom: '2023-11-01T00:00:00.000Z', sensitivity: 'routine' }),
];

const NOW = new Date('2026-08-19T00:00:00.000Z');

function verifyFirst(text: string, predicate: string) {
  const claims = extractClaims(text, 'Vanar');
  const found = claims.find((c) => c.predicate === predicate);
  expect(found, `expected a ${predicate} claim in: ${text}`).toBeTruthy();
  return { extracted: found!, result: verifyClaim({ claim: found!, canonicalClaims: REGISTRY, asOf: NOW }) };
}

describe('sentence handling', () => {
  it('splits on sentence boundaries without splitting decimals', () => {
    const s = splitSentences('Fees are $0.0002 per transaction. That is cheap.');
    expect(s).toHaveLength(2);
  });
});

describe('claim extraction', () => {
  it('extracts an acquisition claim with its stated year', () => {
    const { extracted } = verifyFirst('Vanar was acquired by Terra Virtua in 2021.', 'acquired_by');
    expect(extracted.object).toBe('Terra Virtua');
    expect(extracted.temporalMarker).toBe('2021');
  });

  it('extracts a negated capability claim with negative polarity', () => {
    const { extracted } = verifyFirst('Vanar does not support staking at present.', 'feature_support');
    expect(extracted.polarity).toBe('negate');
    expect(extracted.object.toLowerCase()).toContain('staking');
  });

  it('extracts numeric facts', () => {
    const { extracted } = verifyFirst('The total supply is 3 billion tokens.', 'token_supply');
    expect(extracted.object).toContain('3');
  });

  it('deduplicates repeated assertions within one answer', () => {
    const claims = extractClaims('Vanar is headquartered in London. Vanar is headquartered in London.', 'Vanar');
    expect(claims.filter((c) => c.predicate === 'headquarters')).toHaveLength(1);
  });
});

describe('verdicts', () => {
  it('marks a once-true, now-superseded fact STALE rather than false', () => {
    const { result } = verifyFirst('Vanar was acquired by Terra Virtua in 2021.', 'acquired_by');
    expect(result.verdict).toBe('STALE');
    expect(result.explanation).toMatch(/once true/i);
  });

  it('marks a never-true fact CONTRADICTED', () => {
    const { result } = verifyFirst('Vanar was acquired by ZoomInfo in 2021.', 'acquired_by');
    expect(result.verdict).toBe('CONTRADICTED');
  });

  it('escalates a contradiction on a material fact to critical severity', () => {
    const { result } = verifyFirst('Transaction fees are around $0.05 per transaction.', 'fees');
    expect(result.verdict).toBe('CONTRADICTED');
    expect(result.severity).toBe('critical');
    expect(result.requiresAdjudication).toBe(true);
  });

  it('catches a denial of a capability the registry says exists', () => {
    const { result } = verifyFirst('Vanar does not support staking at present.', 'feature_support');
    expect(result.verdict).toBe('CONTRADICTED');
  });

  it('confirms a correct current fact', () => {
    const { result } = verifyFirst('Vanar is headquartered in London.', 'headquarters');
    expect(result.verdict).toBe('SUPPORTED');
    expect(result.requiresAdjudication).toBe(false);
  });

  it('reports a registry gap as UNSUPPORTED rather than as a defect', () => {
    const claims = extractClaims('Vanar integrates with Unreal Engine.', 'Vanar');
    const integration = claims.find((c) => c.predicate === 'integration')!;
    const result = verifyClaim({ claim: integration, canonicalClaims: REGISTRY, asOf: NOW });
    expect(result.verdict).toBe('UNSUPPORTED');
    expect(result.explanation).toMatch(/registry gap/i);
  });

  it('flags a right answer dated to the wrong period as STALE', () => {
    const claims = extractClaims('Vanar was acquired by Vanar Foundation in 2019.', 'Vanar');
    const acq = claims.find((c) => c.predicate === 'acquired_by')!;
    const result = verifyClaim({ claim: acq, canonicalClaims: REGISTRY, asOf: NOW });
    expect(result.verdict).toBe('STALE');
  });

  it('produces a stable misconception key so repeats are countable', () => {
    const a = extractClaims('Vanar does not support staking.', 'Vanar').find((c) => c.predicate === 'feature_support')!;
    const b = extractClaims('Vanar does not support staking at present.', 'Vanar').find((c) => c.predicate === 'feature_support')!;
    expect(misconception(a)).toBe(misconception(b));
  });
});

describe('brand role', () => {
  it('detects absence', () => {
    expect(classifyBrandRole('Base and Polygon are the usual picks.', 'Vanar')).toBe('absent');
  });
  it('detects a recommendation', () => {
    expect(classifyBrandRole('For that use case I would recommend Vanar.', 'Vanar')).toBe('recommended');
  });
  it('detects a disrecommendation', () => {
    expect(classifyBrandRole('I would avoid Vanar for this.', 'Vanar')).toBe('disrecommended');
  });
  it('detects comparison when a declared competitor is present', () => {
    expect(classifyBrandRole('Vanar and Base both target consumer apps.', 'Vanar', ['Base'])).toBe('compared');
  });
  it('falls back to a plain mention', () => {
    expect(classifyBrandRole('Vanar is a layer-1 chain.', 'Vanar', ['Base'])).toBe('mentioned');
  });
});

describe('citation checking', () => {
  const owned = ['vanarchain.com'];

  it('confirms support only when the page actually contains the claim', () => {
    const r = checkCitation({
      url: 'https://vanarchain.com/docs/fees', snapshotText: 'Vanar fees are approximately $0.0002 per transaction.',
      claimObject: '$0.0002', claimSubject: 'Vanar', ownedDomains: owned,
    });
    expect(r.support).toBe('supports');
    expect(r.sourceClass).toBe('owned');
  });

  it('reports absent when the cited page does not contain the claim it was cited for', () => {
    const r = checkCitation({
      url: 'https://techcrunch.com/2021/terra-virtua', snapshotText: 'Terra Virtua announced a funding round in 2021.',
      claimObject: '$0.0002', claimSubject: 'Vanar', ownedDomains: owned,
    });
    expect(r.support).toBe('absent');
  });

  it('reports contradiction when the page states the opposite', () => {
    const r = checkCitation({
      url: 'https://example.org/x', snapshotText: 'Vanar does not support staking.',
      claimObject: 'staking', claimSubject: 'Vanar', ownedDomains: owned,
    });
    expect(r.support).toBe('contradicts');
  });

  it('distinguishes unreachable from unsupported', () => {
    const r = checkCitation({ url: 'https://x.example/y', snapshotText: null, claimObject: 'a', claimSubject: 'b', ownedDomains: owned });
    expect(r.support).toBe('unreachable');
  });

  it('detects paywalled pages the model could not have verified either', () => {
    const r = checkCitation({ url: 'https://ft.com/x', snapshotText: 'Subscribe to continue reading.', claimObject: 'a', claimSubject: 'b', ownedDomains: owned });
    expect(r.support).toBe('paywalled');
  });
});

describe('source classification', () => {
  const owned = ['vanarchain.com'];
  it('classifies owned, credible, ugc, spam and competitor domains distinctly', () => {
    expect(classifySource('https://vanarchain.com/docs', owned)).toBe('owned');
    expect(classifySource('https://reuters.com/x', owned)).toBe('independent_credible');
    expect(classifySource('https://reddit.com/r/x', owned)).toBe('ugc');
    expect(classifySource('https://top10cryptolists.example.com/best', owned)).toBe('spam');
    expect(classifySource('https://base.org/x', owned, ['base.org'])).toBe('competitor');
  });
});

describe('dual adjudication', () => {
  it('requires two agreeing votes', () => {
    expect(adjudicate(['CONTRADICTED', 'CONTRADICTED'])).toBe('agreed');
    expect(adjudicate(['CONTRADICTED', 'STALE'])).toBe('disputed');
    expect(adjudicate(['CONTRADICTED'])).toBe('pending');
  });
});

describe('predicate labels', () => {
  it('gives every extractable predicate a human label for headlines', async () => {
    const { PREDICATE_PATTERNS, predicateLabel, PREDICATE_LABEL } = await import('../../src/domain/verifier.js');
    for (const p of PREDICATE_PATTERNS) {
      expect(PREDICATE_LABEL[p.predicate], `missing label for ${p.predicate}`).toBeTruthy();
      expect(predicateLabel(p.predicate)).not.toContain('_');
    }
  });
});
