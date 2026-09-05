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
  private instant: Date;
  constructor(start: string | number | Date = '2026-01-01T00:00:00.000Z') {
    this.instant = new Date(start);
  }
  now(): Date {
    return new Date(+this.instant);
  }
  advance(ms: number): void {
    this.instant = new Date(+this.instant + ms);
  }
  advanceHours(h: number): void {
    this.advance(h * 60 * 60 * 1000);
  }
  advanceDays(d: number): void {
    this.advanceHours(d * 24);
  }
  set(at: string | number | Date): void {
    this.instant = new Date(at);
  }
}
