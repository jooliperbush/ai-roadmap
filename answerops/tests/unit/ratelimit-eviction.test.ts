/**
 * The limiter keeps one window per route and address in memory. Expired windows are swept as calls arrive, at
 * most once a minute, so memory follows recent callers rather than every caller the process has seen.
 */
import { describe, expect, it } from 'vitest';
import { TestClock } from '../../src/domain/clock.js';
import { LIMITS, RateLimiter } from '../../src/domain/ratelimit.js';

describe('rate limiter memory', () => {
  it('forgets windows once they expire', () => {
    const clock = new TestClock();
    const limiter = new RateLimiter(clock);
    for (let i = 0; i < 100; i++) limiter.check('POST /launch-event', `203.0.113.${i}`);
    expect(limiter.size).toBe(100);
    clock.advance(LIMITS['POST /launch-event'].windowMs);
    limiter.check('POST /launch-event', '198.51.100.1');
    expect(limiter.size).toBe(1);
  });

  it('keeps a live window through a sweep, so a blocked caller stays blocked', () => {
    const clock = new TestClock();
    const limiter = new RateLimiter(clock);
    const { limit, windowMs } = LIMITS['POST /audit-request'];
    for (let i = 0; i <= limit; i++) limiter.check('POST /audit-request', '203.0.113.9');
    limiter.check('POST /launch-event', '203.0.113.9');

    clock.advance(10 * 60_000); // past the event window, inside the audit one
    limiter.check('POST /launch-event', '198.51.100.1');
    expect(limiter.size, 'the audit window and the new event window').toBe(2);
    expect(limiter.peek('POST /audit-request', '203.0.113.9').ok).toBe(false);

    clock.advance(windowMs);
    limiter.check('POST /launch-event', '198.51.100.2');
    expect(limiter.size).toBe(1);
    expect(limiter.check('POST /audit-request', '203.0.113.9').ok).toBe(true);
  });
});
