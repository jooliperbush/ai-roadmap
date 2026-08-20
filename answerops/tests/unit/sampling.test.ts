import { describe, it, expect } from 'vitest';
import { planSampling, volatilityOf } from '../../src/domain/sampling.js';
import { MIN_SAMPLES, MAX_SAMPLES } from '../../src/domain/stats.js';

const c = (id: string, demand: number, value: number, volatility = 0.2, risk = 0.3) => ({
  clusterId: id, demandWeight: demand, economicValue: value, volatility, defectRisk: risk,
});

describe('adaptive sampling planner', () => {
  it('never allocates fewer than the floor to a sampled cluster', () => {
    const plan = planSampling([c('a', 0.5, 0.5), c('b', 0.1, 0.1)], 40);
    for (const a of plan.allocations) expect(a.samples).toBeGreaterThanOrEqual(MIN_SAMPLES);
  });

  it('gives more runs to high-value, volatile clusters', () => {
    const plan = planSampling([c('hot', 0.9, 0.9, 0.9, 0.9), c('cold', 0.05, 0.1, 0.05, 0.05)], 60);
    const hot = plan.allocations.find((a) => a.clusterId === 'hot')!;
    const cold = plan.allocations.find((a) => a.clusterId === 'cold')!;
    expect(hot.samples).toBeGreaterThan(cold.samples);
  });

  it('drops clusters it cannot afford to sample properly, and says which', () => {
    const plan = planSampling([c('a', 0.9, 0.9), c('b', 0.5, 0.5), c('c', 0.1, 0.1)], 10);
    expect(plan.allocations).toHaveLength(2);
    expect(plan.droppedClusters).toEqual(['c']);
  });

  it('never exceeds the budget', () => {
    const plan = planSampling([c('a', 0.9, 0.9), c('b', 0.8, 0.8), c('c', 0.7, 0.7)], 45);
    expect(plan.totalSamples).toBeLessThanOrEqual(45);
  });

  it('caps any single cluster at the maximum', () => {
    const plan = planSampling([c('a', 1, 1, 1, 1)], 500);
    expect(plan.allocations[0].samples).toBeLessThanOrEqual(MAX_SAMPLES);
  });

  it('reports the sample size each cluster would need for a 20-point effect', () => {
    const plan = planSampling([c('a', 0.5, 0.5)], 40);
    expect(plan.allocations[0].poweredFor).toBeGreaterThan(0);
  });

  it('handles an empty candidate list', () => {
    expect(planSampling([], 100).allocations).toEqual([]);
  });
});

describe('volatility', () => {
  it('is maximal for a coin-flip indicator and zero for a constant one', () => {
    expect(volatilityOf([true, false, true, false])).toBeCloseTo(1, 6);
    expect(volatilityOf([true, true, true, true])).toBe(0);
  });
  it('treats an unknown history as moderately volatile rather than stable', () => {
    expect(volatilityOf([])).toBe(0.5);
  });
});
