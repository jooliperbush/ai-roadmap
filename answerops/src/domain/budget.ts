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
  const ranked = plan.allocations
    .slice()
    .sort((a, b) => b.score - a.score || a.clusterId.localeCompare(b.clusterId));
  const result: TrimResult = { allocations: [], droppedForBudget: [], projectedCost: 0, exhausted: false };
  if (perRunCost <= 0) return { ...result, allocations: ranked };
  for (const allocation of ranked) {
    const projected = result.projectedCost + allocation.samples * perRunCost;
    if (projected > remainingUsd || Number.isNaN(projected) || Number.isNaN(remainingUsd))
      result.droppedForBudget.push(allocation.clusterId);
    else {
      result.allocations.push(allocation);
      result.projectedCost = projected;
    }
  }
  result.exhausted =
    !result.allocations.length || remainingUsd - result.projectedCost < MIN_SAMPLES * perRunCost;
  return result;
}
