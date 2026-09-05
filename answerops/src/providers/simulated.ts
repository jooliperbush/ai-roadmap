/**
 * Deterministic stand-in upstream.
 *
 * This is NOT a mock of our own code. It stands in for the external model providers so the
 * whole pipeline — sampling, extraction, verification, prioritisation, experiments — can be
 * exercised reproducibly in CI and in demos without spend or rate limits. Every run it
 * produces is flagged `simulated: true` in the database and in the UI, and simulated runs
 * are excluded from any customer-facing claim.
 *
 * It reports `costUsd: null`, never a number. It used to invent one — 0.003 to 0.012 per run —
 * which put "Cost of the sample: $0.37" on a public audit report for a sample that spent
 * nothing. A stand-in can fabricate an answer, because producing an answer is its job. It
 * cannot fabricate a measurement of the real world, and what a run cost is such a measurement.
 * Null flows through the existing machinery as `cost_known = 0` and reads as "partly unpriced",
 * which is the truth.
 */

import { hashSeed, mulberry32 } from './prng.js';
import type { ProviderAdapter, RunRequest, RunResult, SurfaceDescriptor, ProviderCitation } from './types.js';

export const SIMULATED_SURFACES: SurfaceDescriptor[] = [
  {
    provider: 'openai',
    modelId: 'sim-gpt',
    modelVersion: 'sim-2026-05',
    surface: 'api',
    grounding: 'grounded_search',
    searchMode: 'web_search_preview',
    label: 'OpenAI · API · grounded',
  },
  {
    provider: 'openai',
    modelId: 'sim-gpt',
    modelVersion: 'sim-2026-05',
    surface: 'consumer_app',
    grounding: 'training_memory',
    searchMode: 'off',
    label: 'OpenAI · consumer app · ungrounded',
  },
  {
    provider: 'anthropic',
    modelId: 'sim-claude',
    modelVersion: 'sim-2026-04',
    surface: 'api',
    grounding: 'grounded_search',
    searchMode: 'web_search',
    label: 'Anthropic · API · grounded',
  },
  {
    provider: 'google',
    modelId: 'sim-gemini',
    modelVersion: 'sim-2026-03',
    surface: 'api',
    grounding: 'hybrid',
    searchMode: 'google_search_retrieval',
    label: 'Google · API · hybrid',
  },
  {
    provider: 'perplexity',
    modelId: 'sim-sonar',
    modelVersion: 'sim-2026-05',
    surface: 'search_product',
    grounding: 'grounded_search',
    searchMode: 'always',
    label: 'Perplexity · search product · grounded',
  },
];

export class SimulatedProvider implements ProviderAdapter {
  key = 'simulated';
  displayName = 'Deterministic simulation';
  surfaces = SIMULATED_SURFACES;
  available(): boolean {
    return true;
  }
  async run(req: RunRequest): Promise<RunResult> {
    const random = mulberry32(
      hashSeed(
        req.surface.provider,
        req.surface.modelId,
        req.surface.surface,
        req.surface.grounding,
        req.prompt,
        req.geo,
        req.language,
        req.seed,
      ),
    );
    const result: RunResult = {
      answerText: '',
      citations: [],
      searchQueries: [],
      latencyMs: 400,
      costUsd: null,
      simulated: true,
      systemConfigHash: configHash(req),
      modelVersion: req.surface.modelVersion,
    };
    const profile = req.beliefs;
    if (!profile)
      return {
        ...result,
        answerText: "I don't have enough information about " + req.brandName + ' to answer that reliably.',
      };
    const chanceAbsent = profile.absenceByFamily?.[req.intentFamily ?? ''] ?? 0;
    const grounded = req.surface.grounding !== 'training_memory';
    if (chanceAbsent > 0 && random() < chanceAbsent) {
      result.answerText = absentAnswer(req, random);
      result.searchQueries = grounded ? [firstWords(req.prompt, 6)] : [];
      result.latencyMs = 300 + Math.floor(random() * 1800);
      return result;
    }
    const sentences: string[] = [];
    const append = (sentence: string | undefined) => {
      if (sentence !== undefined) sentences.push(sentence.replace(/\{brand\}/g, profile.brandName));
    };
    append(pick(profile.opening, random));
    const citations: ProviderCitation[] = [];
    for (const belief of profile.beliefs) {
      const bias =
        belief.surfaceBias?.[req.surface.provider] ?? belief.surfaceBias?.[req.surface.grounding] ?? 1;
      const probability = Math.min(0.98, belief.probability * bias * (grounded ? 0.85 : 1.25));
      if (random() >= probability) continue;
      append(belief.text);
      citations.push(...(belief.citations ?? []));
    }
    append(pick(profile.closing, random));
    result.answerText = sentences.join(' ');
    result.citations = dedupeCitations(citations);
    result.searchQueries = grounded ? [profile.brandName + ' ' + firstWords(req.prompt, 5)] : [];
    result.latencyMs = 300 + Math.floor(random() * 2200);
    return result;
  }
}

const ALTERNATIVES = ['Base', 'Polygon', 'Solana', 'Avalanche', 'Arbitrum', 'Stellar'];

function absentAnswer(req: RunRequest, rnd: () => number): string {
  const picks = [...ALTERNATIVES].sort(() => rnd() - 0.5).slice(0, 3);
  return (
    `For that use case the options people most often shortlist are ${picks[0]}, ${picks[1]} and ${picks[2]}. ` +
    `${picks[0]} is generally the default recommendation on cost, and ${picks[1]} has the widest tooling support. ` +
    'Which fits depends on your settlement requirements and where your users already hold funds.'
  );
}

function pick<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

function firstWords(s: string, n: number): string {
  return s.split(/\s+/).slice(0, n).join(' ');
}

function dedupeCitations(cits: ProviderCitation[]): ProviderCitation[] {
  const seen = new Set<string>();
  return cits.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}

function configHash(req: RunRequest): string {
  return `sim:${hashSeed(req.surface.provider, req.surface.modelId, req.temperature, req.personalization, req.geo).toString(16)}`;
}
