/**
 * Adaptive sampling planner.
 *
 * Repeating every prompt the same number of times is either wasteful or underpowered —
 * usually both. Allocation follows value and uncertainty, subject to a hard budget, with a
 * floor that guarantees no displayed number is built on fewer than MIN_SAMPLES runs.
 */

import { MIN_SAMPLES, MAX_SAMPLES, requiredSampleSize } from './stats.js';

export interface SamplingCandidate {
  clusterId: string;
  demandWeight: number;     // 0..1
  economicValue: number;    // 0..1
  volatility: number;       // 0..1 observed variance of the indicator over trailing window
  defectRisk: number;       // 0..1 prior probability this cluster holds a defect
  observedRate?: number;    // for power-based floor
}

export interface SamplingAllocation {
  clusterId: string;
  samples: number;
  reason: 'floor' | 'value_weighted' | 'volatility' | 'power_target' | 'budget_capped';
  score: number;
  poweredFor: number;
}

export interface SamplingPlan {
  allocations: SamplingAllocation[];
  totalSamples: number;
  budget: number;
  budgetExhausted: boolean;
  droppedClusters: string[];
}

/**
 * @param budget total runs available across all clusters for this round (per surface)
 */
export function planSampling(candidates: SamplingCandidate[], budget: number): SamplingPlan {
  if (candidates.length === 0) {
    return { allocations: [], totalSamples: 0, budget, budgetExhausted: false, droppedClusters: [] };
  }

  const scored = candidates.map((c) => ({
    c,
    score: clamp01(c.demandWeight) * clamp01(c.economicValue) * (0.5 + clamp01(c.volatility)) * (0.5 + clamp01(c.defectRisk)),
  }));
  scored.sort((a, b) => b.score - a.score || a.c.clusterId.localeCompare(b.c.clusterId));

  const dropped: string[] = [];
  // A cluster we cannot afford to sample MIN_SAMPLES times is not sampled at all. Half a
  // sample is worse than none: it produces a number we would then have to suppress.
  const affordable = Math.floor(budget / MIN_SAMPLES);
  const active = scored.slice(0, Math.max(0, affordable));
  for (const s of scored.slice(Math.max(0, affordable))) dropped.push(s.c.clusterId);

  const allocations: SamplingAllocation[] = active.map((s) => ({
    clusterId: s.c.clusterId,
    samples: MIN_SAMPLES,
    reason: 'floor' as const,
    score: s.score,
    poweredFor: 0,
  }));

  let spent = allocations.length * MIN_SAMPLES;
  const totalScore = active.reduce((acc, s) => acc + s.score, 0);

  if (totalScore > 0) {
    let remaining = budget - spent;
    for (let i = 0; i < allocations.length && remaining > 0; i++) {
      const s = active[i];
      const share = s.score / totalScore;
      const extraWanted = Math.min(MAX_SAMPLES - MIN_SAMPLES, Math.floor(share * (budget - spent)));
      const extra = Math.max(0, Math.min(extraWanted, remaining));
      if (extra > 0) {
        allocations[i].samples += extra;
        allocations[i].reason = s.c.volatility >= 0.5 ? 'volatility' : 'value_weighted';
        remaining -= extra;
      }
    }
    spent = allocations.reduce((acc, a) => acc + a.samples, 0);
  }

  // Report the minimum-detectable-effect power target so customers can see what a cluster buys them.
  for (let i = 0; i < allocations.length; i++) {
    const base = active[i].c.observedRate ?? 0.2;
    allocations[i].poweredFor = requiredSampleSize(base, 0.2);
    if (allocations[i].samples >= MAX_SAMPLES) allocations[i].reason = 'budget_capped';
  }

  return {
    allocations,
    totalSamples: allocations.reduce((acc, a) => acc + a.samples, 0),
    budget,
    budgetExhausted: spent >= budget,
    droppedClusters: dropped,
  };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/** Observed volatility of a binary indicator across a trailing window of runs. */
export function volatilityOf(indicators: boolean[]): number {
  const n = indicators.length;
  if (n < 2) return 0.5; // unknown volatility is treated as moderately volatile, not as zero
  const p = indicators.filter(Boolean).length / n;
  // Bernoulli variance peaks at 0.25; normalise to 0..1.
  return (p * (1 - p)) / 0.25;
}
