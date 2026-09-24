/**
 * TypeSafe's Jev model over HTTP: the transport for the model check in domain/jev.ts.
 *
 * Active only when TYPESAFE_API_KEY is set and MISCITED_JEV is not `off`. The key is read at call
 * time and never logged; the token usage is, because that is what the check costs. A failure of
 * any kind is the caller's cue to keep the rules verdict alone and say so.
 */

import type { JevChoiceAnswer, JevChoiceQuestion, JevResponse, JevState } from '../domain/jev.js';
import { DEFAULT_POLICY, ProviderHttpError, backoffDelay, isRetryable, type ResiliencePolicy } from './resilience.js';

export const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

/** One request, then up to two retries on 429, 5xx or a dropped connection. */
const MAX_ATTEMPTS = 3;
/** After this many answers in a row fail, stop asking for a while instead of waiting on each. */
const PAUSE_AFTER_FAILURES = 3;
const PAUSE_MS = 5 * 60_000;

export interface JevSettings {
  enabled: boolean;
  model: string;
  /** a model verdict at or above this confidence is final */
  minConfidence: number;
  timeoutMs: number;
}

export function jevSettings(env: NodeJS.ProcessEnv = process.env): JevSettings {
  const threshold = Number(env.MISCITED_JEV_MIN_CONFIDENCE);
  return {
    enabled: Boolean(env.TYPESAFE_API_KEY) && env.MISCITED_JEV !== 'off',
    model: env.MISCITED_JEV_MODEL?.trim() || 'jev-latest',
    minConfidence:
      env.MISCITED_JEV_MIN_CONFIDENCE?.trim() && Number.isFinite(threshold) && threshold >= 0 && threshold <= 1 ? threshold : 0.8,
    timeoutMs: 20_000,
  };
}

/** What the evidence step needs from the model check; tests substitute their own. */
export interface JevChecker {
  model: string;
  minConfidence: number;
  evaluate(request: { state: JevState; questions: Record<string, JevChoiceQuestion> }): Promise<JevResponse>;
}

export class TypeSafeClient implements JevChecker {
  readonly model: string;
  readonly minConfidence: number;
  private failures = 0;
  private pausedUntil = 0;
  constructor(
    private settings: JevSettings = jevSettings(),
    private fetchImpl: typeof fetch = fetch,
    private policy: ResiliencePolicy = DEFAULT_POLICY,
    private log: (line: string) => void = (line) => console.log(line),
  ) {
    this.model = settings.model;
    this.minConfidence = settings.minConfidence;
  }

  async evaluate(request: { state: JevState; questions: Record<string, JevChoiceQuestion> }): Promise<JevResponse> {
    const credential = process.env.TYPESAFE_API_KEY;
    if (!credential) throw new Error('Jev model check requires TYPESAFE_API_KEY');
    if (this.pausedUntil > Date.now()) throw new Error('Jev model check paused after repeated failures');
    let failure: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.post(credential, request);
        this.failures = 0;
        this.log(
          `[jev] model=${response.model} questions=${Object.keys(request.questions).length} ` +
            `input_tokens=${response.usage.input_tokens} output_tokens=${response.usage.output_tokens}`,
        );
        return response;
      } catch (error) {
        failure = error;
        // A timeout is not retried: the request may still complete, and bill, upstream.
        if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) break;
        await this.policy.sleep(
          backoffDelay(attempt, this.policy, error instanceof ProviderHttpError ? error.retryAfterSec : undefined),
        );
      }
    }
    if (++this.failures >= PAUSE_AFTER_FAILURES) {
      this.failures = 0;
      this.pausedUntil = Date.now() + PAUSE_MS;
    }
    throw failure;
  }

  private async post(
    credential: string,
    request: { state: JevState; questions: Record<string, JevChoiceQuestion> },
  ): Promise<JevResponse> {
    const response = await this.fetchImpl(TYPESAFE_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, state: request.state, questions: request.questions }),
      signal: AbortSignal.timeout(this.settings.timeoutMs),
    });
    if (!response.ok) {
      const seconds = Number(response.headers.get('retry-after'));
      throw new ProviderHttpError(
        response.status,
        'Jev model check failed: ' + response.status,
        Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
      );
    }
    return parseResponse(await response.json(), this.model);
  }
}

/** The response, checked field by field; an answer that is not a well-formed choice is dropped. */
function parseResponse(json: any, requested: string): JevResponse {
  if (!json || typeof json !== 'object' || !json.answers || typeof json.answers !== 'object')
    throw new Error('Jev model check returned no answers');
  const answers: Record<string, JevChoiceAnswer> = {};
  for (const [id, answer] of Object.entries<any>(json.answers))
    if (answer && typeof answer.choice === 'string' && typeof answer.confidence === 'number')
      answers[id] = {
        type: String(answer.type ?? 'choice'),
        choice: answer.choice,
        confidence: answer.confidence,
        ...(answer.probabilities && typeof answer.probabilities === 'object' ? { probabilities: answer.probabilities } : {}),
      };
  return {
    model: typeof json.model === 'string' && json.model ? json.model : requested,
    answers,
    usage: { input_tokens: Number(json.usage?.input_tokens) || 0, output_tokens: Number(json.usage?.output_tokens) || 0 },
  };
}

let shared: { signature: string; client: TypeSafeClient } | null = null;

/** The configured model check, or null when it is off; one client per process keeps its pause state. */
export function jevCheckerFromEnv(): JevChecker | null {
  const settings = jevSettings();
  if (!settings.enabled) return null;
  const signature = JSON.stringify(settings);
  if (shared?.signature !== signature) shared = { signature, client: new TypeSafeClient(settings) };
  return shared.client;
}
