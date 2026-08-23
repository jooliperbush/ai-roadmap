/**
 * The foundation Phase 1 rests on: real costs, a route-role table nobody can forget, rate
 * limits, and an injectable clock.
 */
import { describe, it, expect } from 'vitest';
import { PRICE_TABLE, costOf, usageOf, estimatedRunCost } from '../../src/domain/pricing.js';
import { ROUTE_ROLES, PUBLIC_ROUTES, allows, rankOf, routeKey } from '../../src/domain/roles.js';
import { RateLimiter, LIMITS } from '../../src/domain/ratelimit.js';
import { TestClock } from '../../src/domain/clock.js';

describe('cost accounting', () => {
  it('reads usage from each provider shape', () => {
    expect(usageOf('openai', { usage: { input_tokens: 1000, output_tokens: 500 } })).toMatchObject({ inputTokens: 1000, outputTokens: 500 });
    expect(usageOf('anthropic', { usage: { input_tokens: 10, output_tokens: 20, server_tool_use: { web_search_requests: 2 } } }))
      .toMatchObject({ inputTokens: 10, outputTokens: 20, searchCalls: 2 });
    expect(usageOf('perplexity', { usage: { prompt_tokens: 7, completion_tokens: 8, num_search_queries: 3 } }))
      .toMatchObject({ inputTokens: 7, outputTokens: 8, searchCalls: 3 });
    expect(usageOf('google', { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6 } }))
      .toMatchObject({ inputTokens: 5, outputTokens: 6 });
  });

  it('returns null rather than zero when the provider sent no usage block', () => {
    expect(usageOf('openai', { choices: [] })).toBeNull();
    expect(costOf('gpt-5.1', null)).toBeNull();
  });

  it('returns null for a model with no price, instead of guessing', () => {
    expect(costOf('some-model-we-have-never-priced', { inputTokens: 1, outputTokens: 1, searchCalls: 0 })).toBeNull();
  });

  it('prices a known model from its own usage block', () => {
    const price = PRICE_TABLE['gpt-5.1'];
    const cost = costOf('gpt-5.1', { inputTokens: 1_000_000, outputTokens: 0, searchCalls: 0 });
    expect(cost).toBeCloseTo(price.inputPerMTok, 6);
  });

  it('estimates a run cost for budgeting even when nothing has run yet', () => {
    expect(estimatedRunCost('gpt-5.1')).toBeGreaterThan(0);
    expect(estimatedRunCost('simulated')).toBe(0);
  });
});

describe('route roles', () => {
  it('ranks roles so a viewer cannot do an editor action', () => {
    expect(allows('viewer', 'editor')).toBe(false);
    expect(allows('editor', 'editor')).toBe(true);
    expect(allows('owner', 'editor')).toBe(true);
    expect(allows('owner', 'owner')).toBe(true);
    expect(allows('editor', 'owner')).toBe(false);
  });

  it('treats an unknown role as less than a viewer', () => {
    expect(rankOf('made-up')).toBeLessThan(0);
    expect(allows('made-up', 'viewer')).toBe(false);
  });

  it('requires owner for the two actions that change who can do what and what is true', () => {
    expect(ROUTE_ROLES[routeKey('POST', '/truth/:id/approve')]).toBe('owner');
    expect(ROUTE_ROLES[routeKey('POST', '/index-consent')]).toBe('owner');
  });

  it('keeps the pre-session routes explicit rather than implicit', () => {
    expect(PUBLIC_ROUTES.has('POST /login')).toBe(true);
    expect(PUBLIC_ROUTES.has('POST /audit-request')).toBe(true);
    expect(PUBLIC_ROUTES.has('POST /sampling/run')).toBe(false);
  });
});

describe('rate limiting', () => {
  it('allows up to the limit and then refuses with a retry hint', () => {
    const clock = new TestClock();
    const limiter = new RateLimiter(clock);
    const policy = LIMITS['POST /login'];
    for (let i = 0; i < policy.limit; i++) {
      expect(limiter.check('POST /login', '1.2.3.4').ok, `attempt ${i}`).toBe(true);
    }
    const blocked = limiter.check('POST /login', '1.2.3.4');
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('is per IP, so one abuser cannot lock everyone out', () => {
    const limiter = new RateLimiter(new TestClock());
    for (let i = 0; i < LIMITS['POST /login'].limit + 2; i++) limiter.check('POST /login', 'noisy');
    expect(limiter.check('POST /login', 'quiet').ok).toBe(true);
  });

  it('forgets the window once it has passed', () => {
    const clock = new TestClock();
    const limiter = new RateLimiter(clock);
    for (let i = 0; i < LIMITS['POST /login'].limit + 1; i++) limiter.check('POST /login', 'ip');
    expect(limiter.check('POST /login', 'ip').ok).toBe(false);
    clock.advance(LIMITS['POST /login'].windowMs + 1);
    expect(limiter.check('POST /login', 'ip').ok).toBe(true);
  });

  it('does not limit a route with no policy', () => {
    const limiter = new RateLimiter(new TestClock());
    for (let i = 0; i < 500; i++) expect(limiter.check('POST /something/else', 'ip').ok).toBe(true);
  });
});

describe('test clock', () => {
  it('moves only when told to', () => {
    const clock = new TestClock('2026-03-01T00:00:00.000Z');
    const first = clock.now().toISOString();
    expect(clock.now().toISOString()).toBe(first);
    clock.advanceDays(2);
    expect(clock.now().toISOString()).toBe('2026-03-03T00:00:00.000Z');
  });
});
