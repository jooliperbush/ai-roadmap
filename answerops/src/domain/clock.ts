/**
 * Injectable time.
 *
 * A scheduler you cannot fast-forward is a scheduler you cannot test, and an untested
 * scheduler is the component most likely to silently stop collecting the time series the
 * whole product is made of. Nothing in the scheduling or budget path calls Date.now().
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export class TestClock implements Clock {
  private t: number;
  constructor(start: string | number | Date = '2026-01-01T00:00:00.000Z') {
    this.t = new Date(start).getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t += ms;
  }
  advanceHours(h: number): void {
    this.advance(h * 3600_000);
  }
  advanceDays(d: number): void {
    this.advance(d * 86_400_000);
  }
  set(at: string | number | Date): void {
    this.t = new Date(at).getTime();
  }
}
