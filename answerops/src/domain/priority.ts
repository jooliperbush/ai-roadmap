/**
 * Prioritisation. The formula is published, every factor is stored, and the UI shows all six.
 * A ranking a customer cannot reconstruct is a ranking they are right not to trust.
 *
 *   Priority = Demand x BuyerIntent x EconomicValue x DefectProbability x Fixability x Confidence
 */

import { IntentFamily, INTENT_WEIGHT } from './intent.js';
import { Measurement, confidenceFactor, wilson, MIN_SAMPLES } from './stats.js';

export const ACTION_TYPES = [
  'update_owned_page',
  'create_comparison_page',
  'create_evidence_page',
  'fix_fact_inconsistency',
  'fix_crawler_access',
  'update_product_feed',
  'open_github_pr',
  'create_cms_draft',
  'publisher_correction_packet',
  'request_genuine_reviews',
  'update_structured_data',
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

/** Fixability priors: how much of the outcome is actually within the customer's control. */
export const FIXABILITY: Record<ActionType, number> = {
  update_owned_page: 0.9,
  create_evidence_page: 0.85,
  create_comparison_page: 0.8,
  fix_fact_inconsistency: 0.85,
  update_structured_data: 0.6,
  fix_crawler_access: 0.75,
  update_product_feed: 0.7,
  open_github_pr: 0.8,
  create_cms_draft: 0.8,
  publisher_correction_packet: 0.35,
  request_genuine_reviews: 0.4,
};

export const ACTION_LABEL: Record<ActionType, string> = {
  update_owned_page: 'Update an owned page',
  create_comparison_page: 'Create a comparison page',
  create_evidence_page: 'Create an evidence page',
  fix_fact_inconsistency: 'Fix inconsistent facts across docs',
  fix_crawler_access: 'Repair crawler access',
  update_product_feed: 'Update a product feed',
  open_github_pr: 'Open a GitHub PR',
  create_cms_draft: 'Create a CMS draft',
  publisher_correction_packet: 'Send a publisher correction packet',
  request_genuine_reviews: 'Request reviews from genuine customers',
  update_structured_data: 'Update structured data',
};

export function isActionType(x: string): x is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(x);
}

export interface PriorityFactors {
  demand: number;
  buyerIntent: number;
  economicValue: number;
  defectProbability: number;
  fixability: number;
  confidence: number;
}

export interface PriorityResult extends PriorityFactors {
  score: number;
  explanation: string;
}

export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export interface PriorityInput {
  demandWeight: number;        // 0..1 normalised cluster volume
  intentFamily: IntentFamily;
  economicValue: number;       // 0..1 customer supplied
  defect: Measurement;         // observed defect rate for this cluster
  actionType: ActionType;
}

/**
 * DefectProbability uses the Wilson LOWER bound, not the point estimate. One defect in two
 * samples must not outrank thirty in a hundred; the lower bound enforces that automatically.
 */
export function computePriority(input: PriorityInput): PriorityResult {
  const demand = clamp01(input.demandWeight);
  const buyerIntent = INTENT_WEIGHT[input.intentFamily];
  const economicValue = clamp01(input.economicValue);
  const defectProbability =
    input.defect.n > 0 ? clamp01(wilson(input.defect.k, input.defect.n).low) : 0;
  const fixability = FIXABILITY[input.actionType];
  const confidence = input.defect.sufficient ? confidenceFactor(input.defect) : confidenceFactor(input.defect) * 0.5;

  const score = demand * buyerIntent * economicValue * defectProbability * fixability * confidence;

  const explanation =
    `Priority = demand ${demand.toFixed(2)} x intent ${buyerIntent.toFixed(2)} x value ${economicValue.toFixed(2)} ` +
    `x defect(lower bound) ${defectProbability.toFixed(2)} x fixability ${fixability.toFixed(2)} ` +
    `x confidence ${confidence.toFixed(2)} = ${score.toFixed(4)}` +
    (input.defect.n < MIN_SAMPLES ? ` — sample of ${input.defect.n} is below the ${MIN_SAMPLES}-run floor, so confidence is halved.` : '');

  return { demand, buyerIntent, economicValue, defectProbability, fixability, confidence, score, explanation };
}

/**
 * Expected range for a recommendation. Derived from a comparable cohort of previously
 * confirmed experiments, never invented. No cohort -> null, and the UI says so.
 */
export interface CohortObservation {
  experimentId: string;
  actionType: ActionType;
  baselineRate: number;
  postRate: number;
}

export interface ExpectedRange {
  low: number;
  high: number;
  basis: string;
  cohortSize: number;
}

export function deriveExpectedRange(
  actionType: ActionType,
  cohort: CohortObservation[],
  minCohort = 3,
): ExpectedRange | null {
  const matching = cohort.filter((c) => c.actionType === actionType);
  if (matching.length < minCohort) return null;
  const deltas = matching.map((c) => c.postRate - c.baselineRate).sort((a, b) => a - b);
  const low = quantile(deltas, 0.25);
  const high = quantile(deltas, 0.75);
  return {
    low,
    high,
    basis: `Interquartile range of ${matching.length} previously confirmed "${actionType}" experiments in this workspace.`,
    cohortSize: matching.length,
  };
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next !== undefined ? sorted[base] + rest * (next - sorted[base]) : sorted[base];
}
