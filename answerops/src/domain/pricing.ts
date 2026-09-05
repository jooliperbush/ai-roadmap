/**
 * What a measurement actually cost.
 *
 * The live adapters used to report `costUsd: 0`, which made an unpriced run
 * indistinguishable from a free one and made budget enforcement impossible. A number we do
 * not know is null, not zero, everywhere in this file.
 */

export interface ModelPrice {
  /** USD per million input tokens */
  inputPerMTok: number;
  /** USD per million output tokens */
  outputPerMTok: number;
  /** USD per grounded search tool call */
  searchPerCall: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  searchCalls: number;
}

/**
 * List prices as published at the time of writing. They move, so `/methodology` shows the
 * date this table was last reviewed rather than implying it is live.
 */
export const PRICE_TABLE: Record<string, ModelPrice> = {
  'gpt-5.1': { inputPerMTok: 1.25, outputPerMTok: 10.0, searchPerCall: 0.01 },
  'claude-opus-4-5': { inputPerMTok: 5.0, outputPerMTok: 25.0, searchPerCall: 0.01 },
  'sonar-pro': { inputPerMTok: 3.0, outputPerMTok: 15.0, searchPerCall: 0.005 },
  'gemini-2.5-pro': { inputPerMTok: 1.25, outputPerMTok: 10.0, searchPerCall: 0.0 },
  simulated: { inputPerMTok: 0, outputPerMTok: 0, searchPerCall: 0 },
};

export const PRICE_TABLE_REVIEWED = '2026-08-21';

/** Pull a usage block out of whatever shape the provider returned. Null means unknown. */
export function usageOf(providerKey: string, json: any): Usage | null {
  if (json === null || typeof json !== 'object') return null;
  const usage = providerKey === 'google' ? json.usageMetadata : json.usage;
  if (!usage) return null;
  const readers: Record<string, () => Usage> = {
    openai: () => ({
      inputTokens: num(usage.input_tokens ?? usage.prompt_tokens),
      outputTokens: num(usage.output_tokens ?? usage.completion_tokens),
      searchCalls: countToolCalls(json, 'web_search'),
    }),
    anthropic: () => ({
      inputTokens: num(usage.input_tokens),
      outputTokens: num(usage.output_tokens),
      searchCalls: num(usage.server_tool_use?.web_search_requests) || countToolCalls(json, 'web_search'),
    }),
    perplexity: () => ({
      inputTokens: num(usage.prompt_tokens),
      outputTokens: num(usage.completion_tokens),
      searchCalls: num(usage.num_search_queries),
    }),
    google: () => ({
      inputTokens: num(usage.promptTokenCount),
      outputTokens: num(usage.candidatesTokenCount),
      searchCalls: (json.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? []).length,
    }),
  };
  return readers[providerKey]?.() ?? null;
}

/** Null in, null out. An unknown usage block must not become a confident $0.00. */
export function costOf(modelId: string, usage: Usage | null): number | null {
  const price = PRICE_TABLE[modelId];
  if (usage === null || !price) return null;
  const charges = [
    (usage.inputTokens / 1_000_000) * price.inputPerMTok,
    (usage.outputTokens / 1_000_000) * price.outputPerMTok,
    usage.searchCalls * price.searchPerCall,
  ];
  return charges.reduce((sum, charge) => sum + charge, 0);
}

/**
 * What one run of this model is expected to cost, used to project a round before spending on
 * it. Based on a typical grounded answer: ~2k in, ~700 out, one search call.
 */
export function estimatedRunCost(modelId: string): number {
  return costOf(modelId, { inputTokens: 2000, outputTokens: 700, searchCalls: 1 }) ?? 0.02;
}

function num(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}

function countToolCalls(json: any, name: string): number {
  const pending: unknown[] = [json];
  let calls = 0;
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    const tag = record.type ?? record.name;
    if (typeof tag === 'string' && tag.includes(name)) calls++;
    pending.push(...Object.values(record).filter((value) => value !== null && typeof value === 'object'));
  }
  return calls;
}
