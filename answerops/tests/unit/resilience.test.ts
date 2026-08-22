/**
 * A provider that fails mid-round used to take the round with it. These are the rules that
 * turn a failure into a visible gap instead of a smaller number.
 */
import { describe, it, expect } from 'vitest';
import {
  ResilientProvider, ProviderHttpError, CircuitOpenError, isRetryable, backoffDelay, type ResiliencePolicy,
} from '../../src/providers/resilience.js';
import { TestClock } from '../../src/domain/clock.js';
import type { ProviderAdapter, RunRequest, RunResult } from '../../src/providers/types.js';

const SURFACE = {
  provider: 'test', modelId: 'test-1', modelVersion: 'test-1', surface: 'api' as const,
  grounding: 'grounded_search' as const, searchMode: 'web', label: 'test',
};

function policy(over: Partial<ResiliencePolicy> = {}): ResiliencePolicy {
  return {
    maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, failureThreshold: 5, openMs: 60_000,
    maxRetryAfterMs: 60_000, jitter: () => 0.5, sleep: async () => undefined, ...over,
  };
}

class Flaky implements ProviderAdapter {
  key = 'flaky';
  displayName = 'Flaky';
  surfaces = [SURFACE];
  calls = 0;
  constructor(private script: Array<'ok' | number | 'boom'>) {}
  available() { return true; }
  async run(_req: RunRequest): Promise<RunResult> {
    const step = this.script[Math.min(this.calls, this.script.length - 1)];
    this.calls++;
    if (step === 'ok') {
      return {
        answerText: 'fine', citations: [], searchQueries: [], latencyMs: 1, costUsd: 0.01,
        simulated: false, systemConfigHash: 'h', modelVersion: 'test-1',
      };
    }
    if (step === 'boom') throw new Error('unrecoverable');
    throw new ProviderHttpError(step, `http ${step}`);
  }
}

const REQ: RunRequest = {
  prompt: 'p', brandName: 'B', brandDomain: 'b.com', geo: 'US', language: 'en',
  personalization: 'logged_out', temperature: 0.7, seed: 1, surface: SURFACE,
};

describe('retry classification', () => {
  it('retries rate limits and server errors, not client errors', () => {
    expect(isRetryable(new ProviderHttpError(429, 'x'))).toBe(true);
    expect(isRetryable(new ProviderHttpError(503, 'x'))).toBe(true);
    expect(isRetryable(new ProviderHttpError(400, 'x'))).toBe(false);
    expect(isRetryable(new ProviderHttpError(401, 'x'))).toBe(false);
  });

  it('retries transient network errors', () => {
    expect(isRetryable(new Error('fetch failed: ECONNRESET'))).toBe(true);
    expect(isRetryable(new Error('nonsense'))).toBe(false);
  });

  it('honours Retry-After over its own backoff', () => {
    const p = policy();
    expect(backoffDelay(1, p, 3)).toBe(3000);
    // A provider asking for an hour still does not get an hour, but it gets far more than our
    // own ceiling, because ignoring Retry-After is how you get blocked rather than throttled.
    expect(backoffDelay(1, p, 3600)).toBe(p.maxRetryAfterMs);
  });

  it('grows the backoff ceiling exponentially and jitters inside it', () => {
    const p = policy({ jitter: () => 1 });
    expect(backoffDelay(1, p)).toBe(10);
    expect(backoffDelay(2, p)).toBe(20);
    expect(backoffDelay(3, p)).toBe(40);
    expect(backoffDelay(9, p)).toBe(p.maxDelayMs);
  });
});

describe('ResilientProvider', () => {
  it('retries a 429 and succeeds without the caller noticing', async () => {
    const inner = new Flaky([429, 429, 'ok']);
    const p = new ResilientProvider(inner, policy(), new TestClock());
    const out = await p.run(REQ);
    expect(out.answerText).toBe('fine');
    expect(inner.calls).toBe(3);
  });

  it('gives up after the attempt limit', async () => {
    const inner = new Flaky([500, 500, 500, 500]);
    const p = new ResilientProvider(inner, policy(), new TestClock());
    await expect(p.run(REQ)).rejects.toThrow(/http 500/);
    expect(inner.calls).toBe(3);
  });

  it('does not retry a non-retryable failure', async () => {
    const inner = new Flaky(['boom']);
    const p = new ResilientProvider(inner, policy(), new TestClock());
    await expect(p.run(REQ)).rejects.toThrow(/unrecoverable/);
    expect(inner.calls).toBe(1);
  });

  it('opens the circuit after five consecutive failures and stops calling the network', async () => {
    const clock = new TestClock();
    const inner = new Flaky(['boom']);
    const p = new ResilientProvider(inner, policy(), clock);
    for (let i = 0; i < 5; i++) await expect(p.run(REQ)).rejects.toThrow();
    expect(p.circuitOpen).toBe(true);
    const callsBefore = inner.calls;
    await expect(p.run(REQ)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(inner.calls, 'an open circuit must not reach the provider').toBe(callsBefore);
  });

  it('closes the circuit again once the open period has passed', async () => {
    const clock = new TestClock();
    const inner = new Flaky(['boom', 'boom', 'boom', 'boom', 'boom', 'ok']);
    const p = new ResilientProvider(inner, policy(), clock);
    for (let i = 0; i < 5; i++) await expect(p.run(REQ)).rejects.toThrow();
    expect(p.circuitOpen).toBe(true);
    clock.advance(60_001);
    expect(p.circuitOpen).toBe(false);
    await expect(p.run(REQ)).resolves.toMatchObject({ answerText: 'fine' });
  });

  it('resets the failure count on any success, so intermittent errors never trip it', async () => {
    const inner = new Flaky(['boom', 'ok', 'boom', 'ok', 'boom', 'ok', 'boom', 'ok', 'boom', 'ok']);
    const p = new ResilientProvider(inner, policy(), new TestClock());
    for (let i = 0; i < 5; i++) {
      await expect(p.run(REQ)).rejects.toThrow();
      await expect(p.run(REQ)).resolves.toBeTruthy();
    }
    expect(p.circuitOpen).toBe(false);
  });
});
