/**
 * Retry and circuit breaking around a provider adapter.
 *
 * A provider that rate-limits mid-round used to take the round down with it. Now the round
 * loses that surface, records the loss as a gap, and keeps the rest of the measurement. A gap
 * you can see is a different thing from a number that quietly got smaller.
 */

import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import type { ProviderAdapter, RunRequest, RunResult, SurfaceDescriptor } from './types.js';

export class CircuitOpenError extends Error {
  constructor(
    public providerKey: string,
    public until: Date,
  ) {
    super(`circuit open for ${providerKey} until ${until.toISOString()}`);
    this.name = 'CircuitOpenError';
  }
}

export class ProviderHttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

export interface ResiliencePolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  failureThreshold: number;
  openMs: number;
  /**
   * Ceiling for a provider-supplied Retry-After, which is honoured well past our own backoff
   * ceiling: when a provider says wait a minute, clamping that to eight seconds is how you get
   * blocked rather than rate limited.
   */
  maxRetryAfterMs: number;
  /** deterministic in tests: return 0..1 */
  jitter: () => number;
  /** injected so tests do not actually wait */
  sleep: (ms: number) => Promise<void>;
}

export const DEFAULT_POLICY: ResiliencePolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  failureThreshold: 5,
  openMs: 15 * 60_000,
  maxRetryAfterMs: 60_000,
  jitter: Math.random,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export function isRetryable(err: unknown): boolean {
  if (err instanceof ProviderHttpError) return err.status >= 500 || err.status === 429;
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'socket hang up', 'fetch failed'].some((fragment) =>
    (err instanceof Error ? err.message : String(err)).toLowerCase().includes(fragment.toLowerCase()),
  );
}

/** Full jitter: delay is uniform in [0, exponential backoff], which spreads a thundering herd. */
export function backoffDelay(attempt: number, policy: ResiliencePolicy, retryAfterSec?: number): number {
  if (retryAfterSec !== undefined && retryAfterSec > 0)
    return Math.min(policy.maxRetryAfterMs, retryAfterSec * 1000);
  return Math.floor(
    Math.min(policy.maxDelayMs, policy.baseDelayMs * Math.pow(2, attempt - 1)) * policy.jitter(),
  );
}

export class ResilientProvider implements ProviderAdapter {
  key: string;
  displayName: string;
  surfaces: SurfaceDescriptor[];
  private failures = 0;
  private blockedUntil = 0;
  constructor(
    private inner: ProviderAdapter,
    private policy: ResiliencePolicy = DEFAULT_POLICY,
    private clock: Clock = systemClock,
  ) {
    this.key = inner.key;
    this.displayName = inner.displayName;
    this.surfaces = inner.surfaces;
  }
  available(): boolean {
    return this.inner.available();
  }
  get circuitOpen(): boolean {
    return this.blockedUntil > +this.clock.now();
  }
  async run(req: RunRequest): Promise<RunResult> {
    if (this.circuitOpen) throw new CircuitOpenError(this.key, new Date(this.blockedUntil));
    let failure: unknown;
    let attempt = 0;
    while (attempt < this.policy.maxAttempts) {
      attempt++;
      try {
        const result = await this.inner.run(req);
        this.failures = 0;
        this.blockedUntil = 0;
        return result;
      } catch (error) {
        failure = error;
        if (attempt >= this.policy.maxAttempts || !isRetryable(error)) break;
        await this.policy.sleep(
          backoffDelay(
            attempt,
            this.policy,
            error instanceof ProviderHttpError ? error.retryAfterSec : undefined,
          ),
        );
      }
    }
    if (++this.failures >= this.policy.failureThreshold)
      this.blockedUntil = +this.clock.now() + this.policy.openMs;
    throw failure;
  }
}

export function withResilience(
  adapters: ProviderAdapter[],
  policy: ResiliencePolicy = DEFAULT_POLICY,
  clock: Clock = systemClock,
): ResilientProvider[] {
  return adapters.map((a) => new ResilientProvider(a, policy, clock));
}
