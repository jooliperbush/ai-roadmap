/**
 * Two-stage extraction. The rules that matter: a proposer widens recall, a proposer never
 * decides a verdict, and nothing survives that is not actually present in the text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  proposeClaims, patternProposer, heuristicProposer, ModelProposer, groundProposal, isGrounded,
  levenshtein, PREDICATE_VOCAB, mergeProposals, EXTRACTOR_VERSION,
} from '../../src/domain/extractor.js';

describe('grounding', () => {
  it('measures edit distance and stops early past the bound', () => {
    expect(levenshtein('kitten', 'kitten')).toBe(0);
    expect(levenshtein('kitten', 'sitten', 2)).toBe(1);
    expect(levenshtein('kitten', 'sitting', 2)).toBeLessThanOrEqual(3);
    expect(levenshtein('short', 'a much longer string', 2)).toBeGreaterThan(2);
  });

  it('accepts an object present verbatim', () => {
    expect(isGrounded('Contoso', 'They were acquired by Contoso in 2021.')).toBe(true);
  });

  it('tolerates a near miss but not an invention', () => {
    expect(isGrounded('Contosa', 'They were acquired by Contoso.')).toBe(true);
    expect(isGrounded('Meta Platforms', 'They were acquired by Contoso.')).toBe(false);
  });

  it('rejects a predicate outside the closed vocabulary', () => {
    const claim = { statement: 'x', subject: 'B', predicate: 'vibes', object: 'good', polarity: 'affirm' as const, temporalMarker: null };
    expect(groundProposal(claim, 'the vibes are good')).toBe(false);
  });

  it('rejects an empty object', () => {
    expect(isGrounded('', 'anything')).toBe(false);
  });
});

describe('the heuristic proposer widens recall', () => {
  const cases: Array<[string, string, string]> = [
    ['They were bought out by Fabrikam a few years back.', 'acquired_by', 'Fabrikam'],
    ['Northwind is run by Priya Raman these days.', 'ceo', 'Priya Raman'],
    ['Northwind raised $40 million in its Series B.', 'funding', '$40 million'],
    ['Northwind employs 240 people.', 'employee_count', '240'],
    ['Northwind was founded in 2017.', 'founded_year', '2017'],
    ['Northwind is licensed by the FCA.', 'certification', 'FCA'],
    ['Northwind partnered with Contoso on distribution.', 'partnership', 'Contoso'],
  ];
  for (const [text, predicate, object] of cases) {
    it(`reads "${text.slice(0, 40)}..."`, () => {
      const pattern = proposeClaims(text, 'Northwind', { proposers: [patternProposer] });
      const both = proposeClaims(text, 'Northwind', { proposers: [patternProposer, heuristicProposer] });
      const found = both.find((p) => p.claim.predicate === predicate && p.claim.object.includes(object));
      expect(found, `${predicate}/${object} should be found by the two-stage extractor`).toBeTruthy();
      expect(both.length).toBeGreaterThanOrEqual(pattern.length);
    });
  }
});

describe('polarity', () => {
  it('reads a denial as a denial, not as an assertion', () => {
    const claims = proposeClaims('Northwind does not support SAML.', 'Northwind').map((p) => p.claim);
    const saml = claims.find((c) => c.predicate === 'feature_support');
    expect(saml?.polarity).toBe('negate');
  });

  it('agrees between the two layers on the same sentence', () => {
    const text = 'There is no native integration with Workday.';
    const byLayer = proposeClaims(text, 'Northwind').filter((p) => p.claim.predicate === 'integration');
    const polarities = new Set(byLayer.map((p) => p.claim.polarity));
    expect(polarities, 'two layers reading one sentence differently is worse than missing it').toEqual(new Set(['negate']));
  });
});

describe('attribution', () => {
  it('credits the more conservative layer when both find the same claim', () => {
    const found = proposeClaims('Northwind was acquired by Contoso.', 'Northwind');
    const acq = found.find((p) => p.claim.predicate === 'acquired_by')!;
    expect(acq.stage).toBe('pattern');
  });

  it('marks a heuristic-only claim as heuristic', () => {
    const found = proposeClaims('Northwind raised $40 million.', 'Northwind');
    const funding = found.find((p) => p.claim.predicate === 'funding')!;
    expect(funding.stage).toBe('heuristic');
  });

  it('merges lists without duplicating a claim', () => {
    const a = proposeClaims('Northwind was acquired by Contoso.', 'Northwind');
    const merged = mergeProposals(a, a, a);
    expect(merged.length).toBe(a.length);
  });

  it('names its own version so a regression is attributable', () => {
    expect(EXTRACTOR_VERSION).toMatch(/^v\d/);
  });
});

describe('the model proposer may propose and may not decide', () => {
  it('keeps a grounded proposal', async () => {
    const proposer = new ModelProposer(async () => [
      { predicate: 'acquired_by', object: 'Contoso', polarity: 'affirm' },
    ]);
    const out = await proposer.proposeAsync('Northwind was acquired by Contoso last year.', 'Northwind');
    expect(out).toHaveLength(1);
  });

  it('discards an invention that is not in the text', async () => {
    const proposer = new ModelProposer(async () => [
      { predicate: 'acquired_by', object: 'Meta Platforms', polarity: 'affirm' },
    ]);
    const out = await proposer.proposeAsync('Northwind is an independent company.', 'Northwind');
    expect(out, 'a model that helpfully infers an acquisition must not create a defect').toHaveLength(0);
  });

  it('discards a predicate outside the vocabulary', async () => {
    const proposer = new ModelProposer(async () => [{ predicate: 'sentiment', object: 'positive', polarity: 'affirm' }]);
    expect(await proposer.proposeAsync('positive things', 'Northwind')).toHaveLength(0);
  });

  it('returns nothing rather than throwing when the model call fails', async () => {
    const proposer = new ModelProposer(async () => { throw new Error('rate limited'); });
    await expect(proposer.proposeAsync('anything', 'Northwind')).resolves.toEqual([]);
  });

  it('never carries a verdict field, because verdicts are not its job', async () => {
    const proposer = new ModelProposer(async () => [
      { predicate: 'pricing', object: '$49 per month', polarity: 'affirm', ...( { verdict: 'CONTRADICTED' } as any) },
    ]);
    const out = await proposer.proposeAsync('Northwind pricing starts at $49 per month.', 'Northwind');
    expect(Object.keys(out[0])).toEqual(['statement', 'subject', 'predicate', 'object', 'polarity', 'temporalMarker']);
  });
});

describe('only the verifier assigns a verdict', () => {
  it('no module other than verifier.ts writes a Verdict literal', () => {
    const roots = ['src/domain', 'src/services', 'src/providers'];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of readdirSync(root).filter((f) => f.endsWith('.ts'))) {
        if (file === 'verifier.ts') continue;
        const source = readFileSync(join(root, file), 'utf8');
        // Assigning a verdict looks like `verdict: 'CONTRADICTED'`. Reading one, or comparing
        // against one, is fine and is what the rest of the system does all day.
        const assigns = source.match(/verdict:\s*'(SUPPORTED|CONTRADICTED|STALE|UNSUPPORTED|UNVERIFIABLE)'/g);
        if (assigns) offenders.push(`${root}/${file}: ${assigns.join(', ')}`);
      }
    }
    expect(offenders, 'a proposer that can set a verdict is a proposer that can invent a defect').toEqual([]);
  });
});

describe('the vocabulary is closed', () => {
  it('covers the original predicates plus the five the pattern layer never had', () => {
    for (const p of ['acquired_by', 'ceo', 'pricing', 'fees', 'feature_support', 'integration', 'availability',
      'product_status', 'compliance', 'token_supply', 'headquarters', 'funding', 'employee_count',
      'founded_year', 'certification', 'partnership']) {
      expect(PREDICATE_VOCAB, p).toContain(p);
    }
  });
});
