/**
 * Fixed-window rate limiting, in memory.
 *
 * In memory because there is one process today; the interface is the part that matters, and
 * it moves to a shared store when there is more than one. The routes that matter are the ones
 * that spend money and the one that accepts anonymous input.
 */

import type { Clock } from './clock.js';

export interface LimitPolicy {
  limit: number;
  windowMs: number;
}

/**
 * Routes counted only when the attempt fails.
 *
 * Limiting successful sign-ins punishes a shared office IP for using the product. Limiting
 * failed ones is what actually stops credential stuffing, so the login handler calls the
 * limiter itself rather than the request hook doing it blind.
 */
export const LIMIT_ON_FAILURE = new Set(['POST /login']);

export const LIMITS: Record<string, LimitPolicy> = {
  'POST /launch-event': { limit: 30, windowMs: 60_000 },
  'POST /login': { limit: 10, windowMs: 15 * 60_000 },
  'POST /audit-request': { limit: 5, windowMs: 60 * 60_000 },
  'POST /sampling/run': { limit: 20, windowMs: 60 * 60_000 },
  'POST /api/runs/sample': { limit: 20, windowMs: 60 * 60_000 },
  'POST /schedules/:id/run': { limit: 20, windowMs: 60 * 60_000 },
  'POST /citations/:id/recheck': { limit: 60, windowMs: 60 * 60_000 },
};

export interface LimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export class RateLimiter {
  private windows = new Map<string, { used: number; expires: number }>();
  constructor(private clock: Clock) {}
  check(routeKey: string, ip: string): LimitResult {
    const policy = LIMITS[routeKey];
    if (!policy) return { ok: true, remaining: Infinity, retryAfterSec: 0 };
    const key = routeKey + '|' + ip,
      now = +this.clock.now();
    const previous = this.windows.get(key);
    const window =
      previous && previous.expires > now ? previous : { used: 0, expires: now + policy.windowMs };
    window.used++;
    this.windows.set(key, window);
    const ok = window.used <= policy.limit;
    return {
      ok,
      remaining: Math.max(0, policy.limit - window.used),
      retryAfterSec: ok ? 0 : Math.ceil((window.expires - now) / 1000),
    };
  }
  /** Observe a lockout without consuming another attempt or extending its window. */
  peek(routeKey: string, ip: string): LimitResult {
    const policy = LIMITS[routeKey];
    if (!policy) return { ok: true, remaining: Infinity, retryAfterSec: 0 };
    const window = this.windows.get(routeKey + '|' + ip);
    const now = +this.clock.now();
    if (!window || window.expires <= now) return { ok: true, remaining: policy.limit, retryAfterSec: 0 };
    const ok = window.used < policy.limit;
    return {
      ok,
      remaining: Math.max(0, policy.limit - window.used),
      retryAfterSec: ok ? 0 : Math.ceil((window.expires - now) / 1000),
    };
  }
  reset(): void {
    this.windows.clear();
  }
}
