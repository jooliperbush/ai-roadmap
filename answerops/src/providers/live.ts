/**
 * Live provider adapters.
 *
 * Each is activated only when its API key is present, so a workspace can run entirely on
 * the deterministic stand-in until a customer is paying for real coverage. The shape is
 * intentionally identical to the simulation: the pipeline downstream cannot tell which
 * upstream produced a run except by the `simulated` flag, which is exactly the property
 * that makes the simulation safe to rely on in CI.
 *
 * These call official grounded-search endpoints. Prompt-level costs are recorded per run so
 * the unit economics in /methodology stay honest rather than aspirational.
 */

import type { ProviderAdapter, RunRequest, RunResult, SurfaceDescriptor } from './types.js';
import { costOf, usageOf } from '../domain/pricing.js';
import { ProviderHttpError } from './resilience.js';

interface LiveConfig {
  key: string;
  displayName: string;
  envKey: string;
  endpoint: string;
  surfaces: SurfaceDescriptor[];
  buildBody: (req: RunRequest) => unknown;
  parse: (json: any) => { answerText: string; citations: { url: string; title: string }[]; searchQueries: string[] };
  headers: (apiKey: string) => Record<string, string>;
}

const CONFIGS: LiveConfig[] = [
  {
    key: 'openai',
    displayName: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    endpoint: 'https://api.openai.com/v1/responses',
    surfaces: [
      { provider: 'openai', modelId: 'gpt-5.1', modelVersion: 'gpt-5.1', surface: 'api', grounding: 'grounded_search', searchMode: 'web_search', label: 'OpenAI · API · web search' },
    ],
    headers: (k) => ({ authorization: `Bearer ${k}`, 'content-type': 'application/json' }),
    buildBody: (req) => ({
      model: req.surface.modelId,
      input: req.prompt,
      tools: [{ type: 'web_search' }],
      temperature: req.temperature,
    }),
    parse: (json) => ({
      answerText: extractText(json),
      citations: extractUrls(json).map((url) => ({ url, title: '' })),
      searchQueries: [],
    }),
  },
  {
    key: 'anthropic',
    displayName: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    endpoint: 'https://api.anthropic.com/v1/messages',
    surfaces: [
      { provider: 'anthropic', modelId: 'claude-opus-4-5', modelVersion: 'claude-opus-4-5', surface: 'api', grounding: 'grounded_search', searchMode: 'web_search', label: 'Anthropic · API · web search' },
    ],
    headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }),
    buildBody: (req) => ({
      model: req.surface.modelId,
      max_tokens: 1500,
      messages: [{ role: 'user', content: req.prompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    }),
    parse: (json) => ({
      answerText: extractText(json),
      citations: extractUrls(json).map((url) => ({ url, title: '' })),
      searchQueries: [],
    }),
  },
  {
    key: 'perplexity',
    displayName: 'Perplexity',
    envKey: 'PERPLEXITY_API_KEY',
    endpoint: 'https://api.perplexity.ai/chat/completions',
    surfaces: [
      { provider: 'perplexity', modelId: 'sonar-pro', modelVersion: 'sonar-pro', surface: 'search_product', grounding: 'grounded_search', searchMode: 'always', label: 'Perplexity · Sonar Pro' },
    ],
    headers: (k) => ({ authorization: `Bearer ${k}`, 'content-type': 'application/json' }),
    buildBody: (req) => ({ model: req.surface.modelId, messages: [{ role: 'user', content: req.prompt }] }),
    parse: (json) => ({
      answerText: json?.choices?.[0]?.message?.content ?? '',
      citations: (json?.citations ?? []).map((url: string) => ({ url, title: '' })),
      searchQueries: [],
    }),
  },
  {
    key: 'google',
    displayName: 'Google Gemini',
    envKey: 'GEMINI_API_KEY',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    surfaces: [
      { provider: 'google', modelId: 'gemini-2.5-pro', modelVersion: 'gemini-2.5-pro', surface: 'api', grounding: 'hybrid', searchMode: 'google_search', label: 'Google · Gemini · grounded' },
    ],
    headers: (k) => ({ 'x-goog-api-key': k, 'content-type': 'application/json' }),
    buildBody: (req) => ({
      contents: [{ parts: [{ text: req.prompt }] }],
      tools: [{ google_search: {} }],
    }),
    parse: (json) => ({
      answerText: json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join(' ') ?? '',
      citations: extractUrls(json).map((url) => ({ url, title: '' })),
      searchQueries: json?.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [],
    }),
  },
];

function extractText(json: any): string {
  if (typeof json?.output_text === 'string') return json.output_text;
  const chunks: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.text === 'string') chunks.push(node.text);
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(json);
  return chunks.join(' ').trim();
}

function extractUrls(json: any): string[] {
  const urls = new Set<string>();
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if ((k === 'url' || k === 'uri') && typeof v === 'string' && /^https?:/.test(v)) urls.add(v);
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(json);
  return [...urls];
}

export class LiveProvider implements ProviderAdapter {
  key: string;
  displayName: string;
  surfaces: SurfaceDescriptor[];

  constructor(private cfg: LiveConfig, private fetchImpl: typeof fetch = fetch) {
    this.key = cfg.key;
    this.displayName = cfg.displayName;
    this.surfaces = cfg.surfaces;
  }

  available(): boolean {
    return Boolean(process.env[this.cfg.envKey]);
  }

  async run(req: RunRequest): Promise<RunResult> {
    const apiKey = process.env[this.cfg.envKey];
    if (!apiKey) throw new Error(`${this.cfg.displayName} adapter requires ${this.cfg.envKey}`);
    const started = Date.now();
    const url =
      this.cfg.key === 'google'
        ? `${this.cfg.endpoint}/${req.surface.modelId}:generateContent`
        : this.cfg.endpoint;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.cfg.headers(apiKey),
      body: JSON.stringify(this.cfg.buildBody(req)),
    });
    if (!res.ok) {
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new ProviderHttpError(
        res.status,
        `${this.cfg.displayName} run failed: ${res.status}`,
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    const json = await res.json();
    const parsed = this.cfg.parse(json);
    // Cost comes from the provider's own usage block. If it did not send one, the run is
    // unpriced and says so, rather than reporting a confident zero.
    const cost = costOf(this.cfg.surfaces[0].modelId, usageOf(this.cfg.key, json));
    return {
      answerText: parsed.answerText,
      citations: parsed.citations.map((c) => ({ ...c, snapshotText: null })),
      searchQueries: parsed.searchQueries,
      latencyMs: Date.now() - started,
      costUsd: cost,
      simulated: false,
      systemConfigHash: `${this.cfg.key}:${req.surface.modelVersion}:${req.temperature}:${req.personalization}`,
      modelVersion: req.surface.modelVersion,
    };
  }
}

export function liveProviders(fetchImpl: typeof fetch = fetch): LiveProvider[] {
  return CONFIGS.map((cfg) => new LiveProvider(cfg, fetchImpl));
}
