import { describe, it, expect } from 'vitest';
import { SimulatedProvider, SIMULATED_SURFACES } from '../../src/providers/simulated.js';
import { hashSeed, mulberry32 } from '../../src/providers/prng.js';
import { VANAR_BEFORE, VANAR_AFTER } from '../../seed/simulation.js';
import type { RunRequest } from '../../src/providers/types.js';

const provider = new SimulatedProvider();

function req(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    prompt: 'What are Vanar transaction fees?',
    brandName: 'Vanar',
    brandDomain: 'vanarchain.com',
    geo: 'US',
    language: 'en',
    personalization: 'logged_out',
    temperature: 0.7,
    seed: 42,
    beliefs: VANAR_BEFORE,
    surface: SIMULATED_SURFACES[0],
    intentFamily: 'factual',
    ...overrides,
  };
}

describe('deterministic stand-in upstream', () => {
  it('returns identical output for identical inputs', async () => {
    const a = await provider.run(req());
    const b = await provider.run(req());
    expect(a.answerText).toBe(b.answerText);
  });

  it('varies with the seed — a single sample is a draw, not a measurement', async () => {
    const texts = new Set<string>();
    for (let s = 0; s < 12; s++) texts.add((await provider.run(req({ seed: s }))).answerText);
    expect(texts.size).toBeGreaterThan(1);
  });

  it('varies by surface, because the surface is part of the measurement', async () => {
    const a = await provider.run(req({ surface: SIMULATED_SURFACES[0] }));
    const b = await provider.run(req({ surface: SIMULATED_SURFACES[2] }));
    expect(a.answerText).not.toBe(b.answerText);
  });

  it('labels every run as simulated', async () => {
    expect((await provider.run(req())).simulated).toBe(true);
  });

  it('exposes search queries only on grounded surfaces', async () => {
    const grounded = await provider.run(req({ surface: SIMULATED_SURFACES[0] }));
    const ungrounded = await provider.run(req({ surface: SIMULATED_SURFACES[1] }));
    expect(grounded.searchQueries.length).toBeGreaterThan(0);
    expect(ungrounded.searchQueries).toEqual([]);
  });

  it('produces answers that omit the brand on unaided discovery questions', async () => {
    let absent = 0;
    for (let s = 0; s < 40; s++) {
      const r = await provider.run(req({ seed: s, intentFamily: 'unaided_discovery', prompt: 'best l1 for payments' }));
      if (!/Vanar/i.test(r.answerText)) absent++;
    }
    expect(absent).toBeGreaterThan(10);
  });

  it('repeats the stale acquisition claim materially less often after the fix', async () => {
    const count = async (profile: typeof VANAR_BEFORE) => {
      let n = 0;
      for (let s = 0; s < 60; s++) {
        const r = await provider.run(req({ seed: s, beliefs: profile, intentFamily: 'factual' }));
        if (/acquired by Terra Virtua/i.test(r.answerText)) n++;
      }
      return n;
    };
    expect(await count(VANAR_AFTER)).toBeLessThan(await count(VANAR_BEFORE));
  });

  /**
   * This assertion used to demand the opposite, and the stand-in obliged by inventing a figure
   * between $0.003 and $0.012 a run. That number reached a public audit report as "Cost of the
   * sample: $0.37" for a sample that spent nothing. Unit economics stay honest by refusing to
   * price a run that never happened, not by putting a plausible number on it.
   */
  it('reports no cost at all, because a stand-in run spent nothing', async () => {
    expect((await provider.run(req())).costUsd).toBeNull();
  });

  it('reports null on the absent-answer and no-profile paths too', async () => {
    expect((await provider.run(req({ beliefs: undefined }))).costUsd).toBeNull();
    const many = await Promise.all(Array.from({ length: 25 }, (_, i) => provider.run(req({ seed: i }))));
    expect(many.every((r) => r.costUsd === null), 'every stand-in path must be unpriced').toBe(true);
  });

  it('degrades to an explicit non-answer when no belief profile is configured', async () => {
    const r = await provider.run(req({ beliefs: undefined }));
    expect(r.answerText).toMatch(/don't have enough information/i);
  });
});

describe('surface catalogue', () => {
  it('distinguishes grounded from ungrounded access to the same model', () => {
    const openai = SIMULATED_SURFACES.filter((s) => s.provider === 'openai');
    expect(new Set(openai.map((s) => s.grounding)).size).toBeGreaterThan(1);
  });
});

describe('prng', () => {
  it('is stable for a given seed and different across seeds', () => {
    expect(mulberry32(hashSeed('a'))()).toBe(mulberry32(hashSeed('a'))());
    expect(mulberry32(hashSeed('a'))()).not.toBe(mulberry32(hashSeed('b'))());
  });
});
