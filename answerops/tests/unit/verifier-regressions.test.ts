import { describe, it, expect } from 'vitest';
import { extractClaims, verifyClaim, type ExtractedClaim } from '../../src/domain/verifier.js';
import { proposeClaims } from '../../src/domain/extractor.js';
import { objectMatches, type CanonicalClaim } from '../../src/domain/truth.js';

function row(id: string, predicate: string, object: string, effectiveFrom: string, effectiveTo: string | null = null): CanonicalClaim {
  return {
    id, tenantId: 't', brandId: 'b', subject: 'Northwind', predicate, object, claimText: `Northwind ${predicate} ${object}`,
    effectiveFrom, effectiveTo, supersededById: null, sourceId: null, sensitivity: 'material', approvedBy: 'a', approvedAt: 'x',
  };
}

const REGISTRY: CanonicalClaim[] = [
  row('ceo1', 'ceo', 'Dana Whitfield', '2023-06-01'),
  row('ceo0', 'ceo', 'Marcus Oyelaran', '2016-03-01', '2023-06-01'),
  row('isf', 'integration', 'Salesforce', '2023-01-01'),
  row('ihs', 'integration', 'HubSpot', '2024-06-01'),
  row('izd', 'integration', 'Zendesk', '2020-01-01', '2025-05-01'),
  row('sso', 'feature_support', 'SAML single sign-on (SSO)', '2022-01-01'),
  row('scim', 'feature_support', 'SCIM user provisioning', '2024-01-01'),
  row('soc1', 'compliance', 'SOC 2 Type II', '2024-03-01'),
  row('soc0', 'compliance', 'SOC 2 Type I', '2022-01-01', '2024-03-01'),
];
const NOW = new Date('2026-09-24T00:00:00.000Z');

function tuple(predicate: string, object: string, polarity: 'affirm' | 'negate' = 'affirm'): ExtractedClaim {
  return { statement: object, subject: 'Northwind', predicate, object, polarity, temporalMarker: null };
}
const verify = (claim: ExtractedClaim) => verifyClaim({ claim, canonicalClaims: REGISTRY, asOf: NOW });

describe('multi-valued predicates keep every row in force', () => {
  it('supports an integration that is current alongside a newer one', () => {
    const result = verify(tuple('integration', 'Salesforce'));
    expect(result.verdict).toBe('SUPPORTED');
    expect(result.canonicalClaimId).toBe('isf');
  });
  it('supports a feature that is current alongside a newer one', () => {
    const result = verify(tuple('feature_support', 'SSO'));
    expect(result.verdict).toBe('SUPPORTED');
    expect(result.canonicalClaimId).toBe('sso');
  });
  it('contradicts a denial of any in-force entity, not only the newest', () => {
    const result = verify(tuple('integration', 'Salesforce', 'negate'));
    expect(result.verdict).toBe('CONTRADICTED');
    expect(result.canonicalClaimId).toBe('isf');
  });
  it('marks an ended entity stale when affirmed and supported when denied', () => {
    expect(verify(tuple('integration', 'Zendesk'))).toMatchObject({ verdict: 'STALE', canonicalClaimId: 'izd' });
    expect(verify(tuple('integration', 'Zendesk', 'negate'))).toMatchObject({ verdict: 'SUPPORTED', canonicalClaimId: 'izd' });
  });
  it('treats an entity the registry never lists as a registry gap, not a contradiction', () => {
    expect(verify(tuple('integration', 'Jira')).verdict).toBe('UNSUPPORTED');
  });
  it('matches the claim to its own entity when several rows overlap on any predicate', () => {
    const overlapping = [row('a1', 'availability', 'Coinbase', '2024-01-01'), row('a2', 'availability', 'Kraken', '2025-01-01')];
    const result = verifyClaim({ claim: tuple('availability', 'Coinbase'), canonicalClaims: overlapping, asOf: NOW });
    expect(result).toMatchObject({ verdict: 'SUPPORTED', canonicalClaimId: 'a1' });
  });
});

describe('object matching compares every distinguishing token', () => {
  it('distinguishes grades written as roman numerals or digits', () => {
    expect(objectMatches('SOC 2 Type I', 'SOC 2 Type II')).toBe(false);
    expect(objectMatches('SOC 2 Type II', 'SOC 2 Type 2')).toBe(true);
    expect(objectMatches('PCI DSS Level 1', 'PCI DSS Level 2')).toBe(false);
  });
  it('treats an unstated grade as compatible', () => {
    expect(objectMatches('SOC 2 Type II', 'SOC 2')).toBe(true);
  });
  it('compares all numbers, not only the first', () => {
    expect(objectMatches('ISO 27001:2022', 'ISO 27001:2013')).toBe(false);
    expect(objectMatches('$29 per user per month', '$29 per user')).toBe(true);
    expect(objectMatches('$29 per user per month', '$39 per user')).toBe(false);
  });
  it('respects magnitude words', () => {
    expect(objectMatches('$48 million', '$48 billion')).toBe(false);
    expect(objectMatches('$48 million', '$48M')).toBe(true);
  });
  it('marks a superseded SOC 2 type stale instead of supporting it', () => {
    const [claim] = extractClaims('Northwind is SOC 2 Type I certified.', 'Northwind').filter((c) => c.predicate === 'compliance');
    expect(claim.object).toBe('SOC 2 Type I');
    expect(verify(claim)).toMatchObject({ verdict: 'STALE', canonicalClaimId: 'soc0' });
  });
});

describe('temporal markers only attach when the year governs the claim', () => {
  const A07 = '**Founded:** Northwind was founded in 2016.\n\n**CEO:** The company is led by CEO Dana Whitfield.';
  it('ignores a founding year in a neighbouring bolded item', () => {
    for (const { claim } of proposeClaims(A07, 'Northwind').filter((p) => p.claim.predicate === 'ceo')) {
      expect(claim.temporalMarker).toBeNull();
      expect(verify(claim).verdict).toBe('SUPPORTED');
    }
    expect(proposeClaims(A07, 'Northwind').some((p) => p.claim.predicate === 'ceo')).toBe(true);
  });
  it('ignores a year that belongs to another clause', () => {
    for (const text of [
      'Founded in 2016, Northwind is led by Dana Whitfield.',
      'Northwind raised $12 million in 2019; today it is led by Dana Whitfield.',
      'Northwind, which raised $12 million in 2019, is led by Dana Whitfield.',
    ]) {
      const claim = extractClaims(text, 'Northwind').find((c) => c.predicate === 'ceo');
      expect(claim, text).toBeTruthy();
      expect(claim!.temporalMarker, text).toBeNull();
    }
  });
  it('keeps a year a preposition ties to the claim', () => {
    const cases: Array<[string, string]> = [
      ['Northwind was acquired by Contoso in 2021.', '2021'],
      ['In 2019 Northwind was led by Marcus Oyelaran.', '2019'],
      ['In 2019, Northwind was led by Marcus Oyelaran.', '2019'],
      ['Until 2023, Northwind was led by Marcus Oyelaran.', '2023'],
      ['As of 2022, Northwind is headquartered in Boulder, Colorado.', '2022'],
      ['Northwind has been led by Dana Whitfield since 2020.', '2020'],
    ];
    for (const [text, year] of cases) {
      const [claim] = extractClaims(text, 'Northwind');
      expect(claim?.temporalMarker, text).toBe(year);
    }
  });
  it('applies the same rule to heuristic proposals', () => {
    const heuristic = proposeClaims('Founded in 2016, Northwind is run by Dana Whitfield.', 'Northwind').find(
      (p) => p.claim.predicate === 'ceo',
    );
    expect(heuristic?.stage).toBe('heuristic');
    expect(heuristic!.claim.temporalMarker).toBeNull();
    const dated = proposeClaims('They were bought out by Fabrikam back in 2019.', 'Northwind').find((p) => p.claim.predicate === 'acquired_by');
    expect(dated?.claim.temporalMarker).toBe('2019');
  });
});
