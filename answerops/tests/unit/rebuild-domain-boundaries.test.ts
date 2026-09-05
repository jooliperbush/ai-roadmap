import { describe, it, expect } from 'vitest';
import { wilson, benjaminiHochberg, didTest, requiredSampleSize } from '../../src/domain/stats.js';
import { planSampling } from '../../src/domain/sampling.js';
import { trimToBudget } from '../../src/domain/budget.js';
import { computeNextRun, isoWeek } from '../../src/domain/scheduler.js';
import { resolveTruth, type CanonicalClaim } from '../../src/domain/truth.js';
import { ModelProposer, proposeClaims } from '../../src/domain/extractor.js';
import { checkCitation } from '../../src/domain/verifier.js';
import { TestClock } from '../../src/domain/clock.js';
import { ResilientProvider, ProviderHttpError, DEFAULT_POLICY } from '../../src/providers/resilience.js';
import { SimulatedProvider, SIMULATED_SURFACES } from '../../src/providers/simulated.js';
import { usageOf, costOf } from '../../src/domain/pricing.js';
import { liveProviders } from '../../src/providers/live.js';
import type { RunRequest } from '../../src/providers/types.js';

const request: RunRequest = {
  prompt: 'Does Acme support SSO?',
  brandName: 'Acme',
  brandDomain: 'acme.test',
  geo: 'US',
  language: 'en',
  personalization: 'none',
  seed: 42,
  temperature: 0.7,
  surface: SIMULATED_SURFACES[0],
};

describe('rebuild mathematical and scheduling contracts', () => {
  it('keeps Wilson intervals complementary for every count including endpoints', () => {
    for (const n of [1, 5, 20, 100, 10000])
      for (const k of [0, 1, Math.floor(n / 2), n]) {
        const left = wilson(k, n),
          right = wilson(n - k, n);
        expect(left.low).toBeCloseTo(1 - right.high, 12);
        expect(left.high).toBeCloseTo(1 - right.low, 12);
      }
  });
  it('restores BH input order, treats ties equally and does not mutate input', () => {
    const input = [0.4, 0.01, 0.01, 1, 0];
    const out = benjaminiHochberg(input);
    expect(out.map((x) => x.pValue)).toEqual(input);
    expect(out[1]).toEqual(out[2]);
    expect(out[4].qValue).toBe(0);
    expect(out[3].rejected).toBe(false);
  });
  it('retains uncertainty for all-zero control and infinite sample requirements for zero effect', () => {
    const arm = { preK: 0, preN: 20, postK: 0, postN: 20 };
    expect(didTest(arm, arm).se).toBeGreaterThan(0);
    expect(didTest(arm, arm).effect).toBe(0);
    expect(requiredSampleSize(0.2, 0)).toBe(Infinity);
  });
  it('allocates whole floors in deterministic priority order without mutating candidates', () => {
    const inputs = ['z', 'a', 'm'].map((clusterId) => ({
      clusterId,
      demandWeight: 1,
      economicValue: 1,
      volatility: 0,
      defectRisk: 0,
    }));
    const plan = planSampling(inputs, 12);
    expect(plan.allocations.map((x) => [x.clusterId, x.samples])).toEqual([
      ['a', 6],
      ['m', 6],
    ]);
    expect(plan.droppedClusters).toEqual(['z']);
    expect(inputs.map((x) => x.clusterId)).toEqual(['z', 'a', 'm']);
    const trimmed = trimToBudget(plan, 0.1, 0.7);
    expect(trimmed.allocations.map((x) => x.clusterId)).toEqual(['a']);
    expect(trimmed.droppedForBudget).toEqual(['m']);
  });
  it('calculates strict UTC boundaries across leap days and ISO-year transitions', () => {
    expect(computeNextRun('daily', new Date('2024-02-28T06:00:00Z')).toISOString()).toBe(
      '2024-02-29T06:00:00.000Z',
    );
    expect(computeNextRun('weekly', new Date('2024-12-30T06:00:00Z')).toISOString()).toBe(
      '2025-01-06T06:00:00.000Z',
    );
    expect(isoWeek(new Date('2024-12-30T00:00:00Z'))).toEqual({ year: 2025, week: 1 });
  });
});

describe('rebuild provenance and grounding contracts', () => {
  it('resolves temporal intervals as start-inclusive, end-exclusive with latest overlap winning', () => {
    const base = { subject: 'Acme', predicate: 'ceo', object: 'Alice', effectiveTo: null };
    const claims = [
      { ...base, id: 'old', effectiveFrom: '2020-01-01', effectiveTo: '2024-01-01' },
      { ...base, id: 'new', effectiveFrom: '2024-01-01' },
      { ...base, id: 'overlap', effectiveFrom: '2024-06-01' },
    ] as CanonicalClaim[];
    expect(resolveTruth(claims, ' ACME ', 'CEO', new Date('2024-01-01'))?.id).toBe('new');
    expect(resolveTruth(claims, 'Acme', 'ceo', new Date('2025-01-01'))?.id).toBe('overlap');
    expect(claims.map((x) => x.id)).toEqual(['old', 'new', 'overlap']);
  });
  it('drops invented model objects and vocabulary while retaining grounded proposals', async () => {
    const proposer = new ModelProposer(async () => [
      { predicate: 'acquired_by', object: 'Microsoft' },
      { predicate: 'secret', object: 'SSO' },
      { predicate: 'feature_support', object: 'SSO' },
    ]);
    const claims = await proposer.proposeAsync('Acme supports SSO.', 'Acme');
    expect(claims.map((x) => [x.predicate, x.object])).toEqual([['feature_support', 'SSO']]);
    expect(claims[0].subject).toBe('Acme');
  });
  it('keeps pattern attribution when multiple proposers find the same grounded claim', () => {
    const claims = proposeClaims('Acme supports SSO.', 'Acme');
    expect(claims.filter((x) => x.claim.predicate === 'feature_support')).toHaveLength(1);
    expect(claims[0].stage).toBe('pattern');
  });
  it('requires both subject and object on a retrieved citation and distinguishes unavailable pages', () => {
    const input = {
      url: 'https://docs.acme.test',
      claimSubject: 'Acme',
      claimObject: 'SSO',
      ownedDomains: ['acme.test'],
    };
    expect(checkCitation({ ...input, snapshotText: 'Another tool supports SSO.' }).support).toBe('absent');
    expect(checkCitation({ ...input, snapshotText: 'Acme no longer supports SSO.' }).support).toBe(
      'contradicts',
    );
    expect(checkCitation({ ...input, snapshotText: null }).support).toBe('unreachable');
    expect(checkCitation({ ...input, snapshotText: 'Subscribe to read Acme SSO.' }).support).toBe(
      'paywalled',
    );
  });
});

describe('rebuild offline provider contracts', () => {
  it('waits Retry-After then opens and recovers the circuit at the exact boundary', async () => {
    const clock = new TestClock();
    let calls = 0;
    const delays: number[] = [];
    const inner = {
      key: 'stub',
      displayName: 'Stub',
      surfaces: [],
      available: () => true,
      run: async () => {
        calls++;
        if (calls <= 2) throw new ProviderHttpError(429, 'limited', 2);
        return new SimulatedProvider().run(request);
      },
    };
    const wrapped = new ResilientProvider(
      inner,
      {
        ...DEFAULT_POLICY,
        maxAttempts: 2,
        failureThreshold: 1,
        openMs: 1000,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
      clock,
    );
    await expect(wrapped.run(request)).rejects.toThrow('limited');
    expect(delays).toEqual([2000]);
    await expect(wrapped.run(request)).rejects.toThrow('circuit open');
    expect(calls).toBe(2);
    clock.advance(1000);
    await expect(wrapped.run(request)).resolves.toMatchObject({ simulated: true, costUsd: null });
  });
  it('keeps missing usage unpriced and counts nested provider search calls', () => {
    expect(costOf('gpt-5.1', usageOf('openai', {}))).toBeNull();
    const usage = usageOf('openai', {
      usage: { input_tokens: 2000, output_tokens: 700 },
      output: [{ type: 'web_search_call' }],
    });
    expect(usage).toEqual({ inputTokens: 2000, outputTokens: 700, searchCalls: 1 });
    expect(costOf('gpt-5.1', usage)).toBeCloseTo(0.0195, 10);
  });
  it('parses live responses with injected transport, attaches unknown snapshots and preserves provenance', async () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'offline-test';
    try {
      const adapter = liveProviders(
        async () =>
          new Response(
            JSON.stringify({
              output_text: 'Acme supports SSO.',
              output: [{ annotations: [{ url: 'https://acme.test/docs' }] }],
            }),
            { status: 200 },
          ),
      )[0];
      const output = await adapter.run({ ...request, surface: adapter.surfaces[0] });
      expect(output).toMatchObject({
        answerText: 'Acme supports SSO.',
        simulated: false,
        costUsd: null,
        modelVersion: 'gpt-5.1',
        citations: [{ url: 'https://acme.test/docs', title: '', snapshotText: null }],
      });
      expect(output.systemConfigHash).toBe('openai:gpt-5.1:0.7:none');
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });
});

describe('rebuild resilience regressions', () => {
  it('fails closed when a model proposer returns malformed runtime JSON', async () => {
    const malformed = [null, {}, { predicate: 'fees', object: null }, { predicate: 'fees', object: '$1' }];
    const proposer = new ModelProposer(async () => malformed as never);
    await expect(proposer.proposeAsync('Acme fees are $1.', 'Acme')).resolves.toHaveLength(1);
    const invalidEnvelope = new ModelProposer(async () => null as never);
    await expect(invalidEnvelope.proposeAsync('Acme fees are $1.', 'Acme')).resolves.toEqual([]);
  });
  it('keeps sequential evidence finite through repeated overwhelming observations', async () => {
    const { SequentialTest } = await import('../../src/domain/sequential.js');
    const test = new SequentialTest(0.01);
    for (let i = 0; i < 10; i++) test.observe({ k: 1000, n: 1000 });
    expect(Number.isFinite(test.value)).toBe(true);
    expect(test.firedAtLook).toBe(1);
    expect(test.pValueAnytime).toBeGreaterThanOrEqual(0);
  });
  it('handles an explicitly empty simulation profile without inventing content or costs', async () => {
    const output = await new SimulatedProvider().run({
      ...request,
      beliefs: { brandName: 'Acme', brandDomain: 'acme.test', opening: [], closing: [], beliefs: [] },
    });
    expect(output.answerText).toBe('');
    expect(output.costUsd).toBeNull();
    expect(output.simulated).toBe(true);
  });
});
