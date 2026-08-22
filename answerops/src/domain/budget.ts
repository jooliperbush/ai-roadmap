/**
 * Monthly spend ledger.
 *
 * A round that would blow the budget drops whole clusters rather than thinning every cluster,
 * because a thinned cluster produces a number below MIN_SAMPLES that we would then have to
 * suppress. Dropping is visible; thinning is a silent downgrade.
 */

import { MIN_SAMPLES } from './stats.js';
import type { SamplingPlan, SamplingAllocation } from './sampling.js';

export interface BudgetState {
  monthlyBudgetUsd: number;
  monthToDateUsd: number;
  unpricedRuns: number;
}

export function remainingBudget(state: BudgetState): number {
  return Math.max(0, state.monthlyBudgetUsd - state.monthToDateUsd);
}

/** Projected cost of a plan, given the mean cost of one run across the surfaces in play. */
export function projectRoundCost(plan: SamplingPlan, perRunCost: number): number {
  return plan.totalSamples * perRunCost;
}

export interface TrimResult {
  allocations: SamplingAllocation[];
  droppedForBudget: string[];
  projectedCost: number;
  exhausted: boolean;
}

/**
 * Drop from the bottom of the priority order until the round fits. Surviving clusters keep
 * their full allocation; nothing is reduced below MIN_SAMPLES; if even one cluster at the
 * floor does not fit, the round is empty and `exhausted` is true.
 */
export function trimToBudget(plan: SamplingPlan, perRunCost: number, remainingUsd: number): TrimResult {
  const ordered = [...plan.allocations].sort((a, b) => b.score - a.score || a.clusterId.localeCompare(b.clusterId));
  if (perRunCost <= 0) {
    return {
      allocations: ordered,
      droppedForBudget: [],
      projectedCost: 0,
      exhausted: false,
    };
  }
  const kept: SamplingAllocation[] = [];
  const dropped: string[] = [];
  let cost = 0;
  for (const alloc of ordered) {
    const next = cost + alloc.samples * perRunCost;
    if (next <= remainingUsd) {
      kept.push(alloc);
      cost = next;
    } else {
      dropped.push(alloc.clusterId);
    }
  }
  const floorCost = MIN_SAMPLES * perRunCost;
  return {
    allocations: kept,
    droppedForBudget: dropped,
    projectedCost: cost,
    exhausted: kept.length === 0 || remainingUsd - cost < floorCost,
  };
}
