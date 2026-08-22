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
  if (!json || typeof json !== 'object') return null;
  switch (providerKey) {
    case 'openai': {
      const u = json.usage;
      if (!u) return null;
      return {
        inputTokens: num(u.input_tokens ?? u.prompt_tokens),
        outputTokens: num(u.output_tokens ?? u.completion_tokens),
        searchCalls: countToolCalls(json, 'web_search'),
      };
    }
    case 'anthropic': {
      const u = json.usage;
      if (!u) return null;
      return {
        inputTokens: num(u.input_tokens),
        outputTokens: num(u.output_tokens),
        searchCalls: num(u.server_tool_use?.web_search_requests) || countToolCalls(json, 'web_search'),
      };
    }
    case 'perplexity': {
      const u = json.usage;
      if (!u) return null;
      return {
        inputTokens: num(u.prompt_tokens),
        outputTokens: num(u.completion_tokens),
        searchCalls: num(u.num_search_queries),
      };
    }
    case 'google': {
      const u = json.usageMetadata;
      if (!u) return null;
      return {
        inputTokens: num(u.promptTokenCount),
        outputTokens: num(u.candidatesTokenCount),
        searchCalls: (json?.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? []).length,
      };
    }
    default:
      return null;
  }
}

/** Null in, null out. An unknown usage block must not become a confident $0.00. */
export function costOf(modelId: string, usage: Usage | null): number | null {
  if (!usage) return null;
  const price = PRICE_TABLE[modelId];
  if (!price) return null;
  return (
    (usage.inputTokens / 1_000_000) * price.inputPerMTok +
    (usage.outputTokens / 1_000_000) * price.outputPerMTok +
    usage.searchCalls * price.searchPerCall
  );
}

/**
 * What one run of this model is expected to cost, used to project a round before spending on
 * it. Based on a typical grounded answer: ~2k in, ~700 out, one search call.
 */
export function estimatedRunCost(modelId: string): number {
  const price = PRICE_TABLE[modelId];
  if (!price) return 0.02;
  return (2000 / 1_000_000) * price.inputPerMTok + (700 / 1_000_000) * price.outputPerMTok + price.searchPerCall;
}

function num(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}

function countToolCalls(json: any, name: string): number {
  let n = 0;
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    const type = node.type ?? node.name;
    if (typeof type === 'string' && type.includes(name)) n++;
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(json);
  return n;
}
