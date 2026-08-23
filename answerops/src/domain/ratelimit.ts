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
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private clock: Clock) {}

  check(routeKey: string, ip: string): LimitResult {
    const policy = LIMITS[routeKey];
    if (!policy) return { ok: true, remaining: Infinity, retryAfterSec: 0 };
    const now = this.clock.now().getTime();
    const key = `${routeKey}|${ip}`;
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + policy.windowMs });
      return { ok: true, remaining: policy.limit - 1, retryAfterSec: 0 };
    }
    bucket.count++;
    if (bucket.count > policy.limit) {
      return { ok: false, remaining: 0, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
    }
    return { ok: true, remaining: policy.limit - bucket.count, retryAfterSec: 0 };
  }

  /** Test seam: forget everything, so one test's attempts do not exhaust another's budget. */
  reset(): void {
    this.buckets.clear();
  }
}
