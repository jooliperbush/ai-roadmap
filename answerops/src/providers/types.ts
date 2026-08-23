/**
 * Provider adapter contract.
 *
 * "ChatGPT" is not a measurement surface. A surface is a specific provider, model, model
 * version, access mode, grounding mode, geo, language and personalization state. Every run
 * this system stores names all of them, because a number that cannot be attributed to a
 * surface cannot be reproduced, and a number that cannot be reproduced is decoration.
 */

export type Surface = 'api' | 'consumer_app' | 'search_product';
export type Grounding = 'grounded_search' | 'training_memory' | 'hybrid';
export type Personalization = 'none' | 'logged_out' | 'logged_in_default';

export interface SurfaceDescriptor {
  provider: string;
  modelId: string;
  modelVersion: string;
  surface: Surface;
  grounding: Grounding;
  searchMode: string;
  label: string;
}

export interface RunRequest {
  prompt: string;
  brandName: string;
  brandDomain: string;
  geo: string;
  language: string;
  personalization: Personalization;
  /** intent family of the cluster being sampled — the stand-in upstream uses it for absence rates */
  intentFamily?: string;
  temperature: number;
  seed: number;
  /** simulation-only: the belief profile the stand-in upstream draws from */
  beliefs?: BeliefProfile;
  surface: SurfaceDescriptor;
}

export interface ProviderCitation {
  url: string;
  title: string;
  /** snapshot of the cited page at sampling time; null means we could not retrieve it */
  snapshotText: string | null;
}

export interface RunResult {
  answerText: string;
  citations: ProviderCitation[];
  searchQueries: string[];
  latencyMs: number;
  /** null means the provider told us nothing about usage. Never coerce it to 0. */
  costUsd: number | null;
  simulated: boolean;
  systemConfigHash: string;
  modelVersion: string;
}

export interface ProviderAdapter {
  key: string;
  displayName: string;
  surfaces: SurfaceDescriptor[];
  available(): boolean;
  run(req: RunRequest): Promise<RunResult>;
}

/**
 * Belief profile for the deterministic stand-in upstream. Each belief carries the
 * probability that a given surface asserts it, so the pipeline can be exercised against
 * realistic, reproducible defect rates without spending money or waiting on rate limits.
 */
export interface Belief {
  /** sentence template; {brand} is substituted */
  text: string;
  probability: number;
  citations?: ProviderCitation[];
  /** which surfaces are more prone to this belief, e.g. {'anthropic': 1.4} */
  surfaceBias?: Record<string, number>;
  /** only emitted for these intent families (omitted = all) */
  families?: string[];
}

export interface BeliefProfile {
  brandName: string;
  brandDomain: string;
  opening: string[];
  beliefs: Belief[];
  closing: string[];
  /** probability the brand is not mentioned at all, by intent family */
  absenceByFamily?: Record<string, number>;
}
