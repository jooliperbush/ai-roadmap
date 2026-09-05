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
  demandWeight: number; // 0..1
  economicValue: number; // 0..1
  volatility: number; // 0..1 observed variance of the indicator over trailing window
  defectRisk: number; // 0..1 prior probability this cluster holds a defect
  observedRate?: number; // for power-based floor
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
  const bounded = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : 0);
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score:
        bounded(candidate.demandWeight) *
        bounded(candidate.economicValue) *
        (0.5 + bounded(candidate.volatility)) *
        (0.5 + bounded(candidate.defectRisk)),
    }))
    .sort((a, b) => b.score - a.score || a.candidate.clusterId.localeCompare(b.candidate.clusterId));
  const capacity = Math.max(0, Math.floor(budget / MIN_SAMPLES));
  const selected = ranked.slice(0, capacity);
  const totalWeight = selected.reduce((sum, item) => sum + item.score, 0);
  const surplus = budget - selected.length * MIN_SAMPLES;
  let available = surplus;
  const allocations: SamplingAllocation[] = selected.map(({ candidate, score }) => {
    const requested =
      totalWeight > 0 ? Math.min(MAX_SAMPLES - MIN_SAMPLES, Math.floor((score / totalWeight) * surplus)) : 0;
    const extra = Math.max(0, Math.min(requested, available));
    available -= extra;
    const samples = MIN_SAMPLES + extra;
    const reason: SamplingAllocation['reason'] =
      samples >= MAX_SAMPLES
        ? 'budget_capped'
        : extra > 0
          ? candidate.volatility >= 0.5
            ? 'volatility'
            : 'value_weighted'
          : 'floor';
    return {
      clusterId: candidate.clusterId,
      samples,
      reason,
      score,
      poweredFor: requiredSampleSize(candidate.observedRate ?? 0.2, 0.2),
    };
  });
  const totalSamples = allocations.reduce((sum, allocation) => sum + allocation.samples, 0);
  return {
    allocations,
    totalSamples,
    budget,
    budgetExhausted: candidates.length > 0 && totalSamples >= budget,
    droppedClusters: ranked.slice(capacity).map((item) => item.candidate.clusterId),
  };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/** Observed volatility of a binary indicator across a trailing window of runs. */
export function volatilityOf(indicators: boolean[]): number {
  if (indicators.length < 2) return 0.5;
  const rate = indicators.reduce((sum, present) => sum + Number(present), 0) / indicators.length;
  return 4 * rate * (1 - rate);
}
