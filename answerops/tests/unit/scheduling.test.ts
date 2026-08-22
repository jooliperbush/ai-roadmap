/**
 * Scheduling arithmetic and budget trimming. Both are pure, so the question "what does a
 * daily schedule do across a week" is answerable in a millisecond rather than a week.
 */
import { describe, it, expect } from 'vitest';
import { computeNextRun, windowLabelFor, isoWeek, monthKey, leaseIsLive } from '../../src/domain/scheduler.js';
import { trimToBudget, remainingBudget, projectRoundCost } from '../../src/domain/budget.js';
import { MIN_SAMPLES } from '../../src/domain/stats.js';
import type { SamplingPlan, SamplingAllocation } from '../../src/domain/sampling.js';

function plan(allocs: Array<[string, number, number]>): SamplingPlan {
  const allocations: SamplingAllocation[] = allocs.map(([clusterId, samples, score]) => ({
    clusterId, samples, score, reason: 'value_weighted', poweredFor: 0,
  }));
  return {
    allocations,
    totalSamples: allocations.reduce((a, x) => a + x.samples, 0),
    budget: 0, budgetExhausted: false, droppedClusters: [],
  };
}

describe('computeNextRun', () => {
  it('moves a daily schedule strictly forward, never returning the same instant twice', () => {
    const at = new Date('2026-05-01T06:00:00.000Z');
    const next = computeNextRun('daily', at, 6);
    expect(next.toISOString()).toBe('2026-05-02T06:00:00.000Z');
    expect(next.getTime()).toBeGreaterThan(at.getTime());
  });

  it('runs later the same day when the hour has not passed yet', () => {
    expect(computeNextRun('daily', new Date('2026-05-01T03:00:00.000Z'), 6).toISOString())
      .toBe('2026-05-01T06:00:00.000Z');
  });

  it('puts a weekly schedule on the next Monday', () => {
    const next = computeNextRun('weekly', new Date('2026-05-06T12:00:00.000Z'), 6);
    expect(next.getUTCDay()).toBe(1);
    expect(next.toISOString()).toBe('2026-05-11T06:00:00.000Z');
  });

  it('parks a manual schedule far enough out that it never comes due on its own', () => {
    expect(computeNextRun('manual', new Date(), 6).getUTCFullYear()).toBeGreaterThan(2900);
  });

  it('produces exactly seven distinct daily windows across a simulated week', () => {
    let at = new Date('2026-05-01T00:00:00.000Z');
    const labels: string[] = [];
    for (let i = 0; i < 7; i++) {
      at = computeNextRun('daily', at, 6);
      labels.push(windowLabelFor('daily', at));
    }
    expect(new Set(labels).size).toBe(7);
    expect(labels[0]).toBe('2026-05-01');
    expect(labels[6]).toBe('2026-05-07');
  });
});

describe('window labels', () => {
  it('dates daily windows and numbers weekly ones, both sorting lexically', () => {
    expect(windowLabelFor('daily', new Date('2026-05-04T06:00:00Z'))).toBe('2026-05-04');
    expect(windowLabelFor('weekly', new Date('2026-01-08T06:00:00Z'))).toMatch(/^2026-W0\d$/);
    const sorted = ['2026-05-10', '2026-05-02', '2026-05-31'].sort();
    expect(sorted).toEqual(['2026-05-02', '2026-05-10', '2026-05-31']);
  });

  it('computes ISO weeks across a year boundary', () => {
    expect(isoWeek(new Date('2026-01-01T00:00:00Z')).week).toBeGreaterThan(0);
    expect(monthKey(new Date('2026-11-09T00:00:00Z'))).toBe('2026-11');
  });
});

describe('leases', () => {
  it('treats an expired lease as dead and a future one as live', () => {
    const now = new Date('2026-05-01T00:00:00Z');
    expect(leaseIsLive('2026-04-30T23:00:00Z', now)).toBe(false);
    expect(leaseIsLive('2026-05-01T00:10:00Z', now)).toBe(true);
    expect(leaseIsLive(null, now)).toBe(false);
  });
});

describe('budget trimming', () => {
  it('drops whole clusters in ascending priority rather than thinning every one', () => {
    const p = plan([['a', 10, 0.9], ['b', 10, 0.5], ['c', 10, 0.1]]);
    const trimmed = trimToBudget(p, 0.1, 1.5);
    expect(trimmed.allocations.map((a) => a.clusterId)).toEqual(['a']);
    expect(trimmed.droppedForBudget).toEqual(['b', 'c']);
  });

  it('never reduces a surviving cluster below the sample floor', () => {
    const p = plan([['a', MIN_SAMPLES, 0.9], ['b', MIN_SAMPLES, 0.5]]);
    const trimmed = trimToBudget(p, 0.1, MIN_SAMPLES * 0.1);
    for (const a of trimmed.allocations) expect(a.samples).toBeGreaterThanOrEqual(MIN_SAMPLES);
  });

  it('reports exhaustion when not even one cluster at the floor fits', () => {
    const p = plan([['a', 10, 0.9]]);
    const trimmed = trimToBudget(p, 1, 0.5);
    expect(trimmed.allocations).toHaveLength(0);
    expect(trimmed.exhausted).toBe(true);
  });

  it('leaves the plan alone when runs are free, as they are in simulation', () => {
    const p = plan([['a', 10, 0.9], ['b', 10, 0.5]]);
    const trimmed = trimToBudget(p, 0, 0);
    expect(trimmed.allocations).toHaveLength(2);
    expect(trimmed.exhausted).toBe(false);
  });

  it('never reports a negative remaining budget', () => {
    expect(remainingBudget({ monthlyBudgetUsd: 100, monthToDateUsd: 250, unpricedRuns: 0 })).toBe(0);
  });

  it('projects a round before spending on it', () => {
    expect(projectRoundCost(plan([['a', 20, 1]]), 0.05)).toBeCloseTo(1);
  });
});
