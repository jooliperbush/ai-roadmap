/**
 * Action engine + experiment ledger.
 *
 * Two rules do the heavy lifting here:
 *   1. No evidence, no action. A recommendation without an observation id is an opinion.
 *   2. No invented impact numbers. An expected range comes from a cohort of this workspace's
 *      own confirmed experiments, or it is null and the UI says "ships as an experiment".
 */

import type { DB } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import { ActionState, assertTransition, assertEvidence } from '../domain/actions.js';
import { ActionType, isActionType, deriveExpectedRange, computePriority, CohortObservation, ACTION_LABEL } from '../domain/priority.js';
import { IntentFamily } from '../domain/intent.js';
import { measure } from '../domain/stats.js';
import { analyzeExperiment, OUTCOME_CAVEAT } from '../domain/experiments.js';
import { relevantBotClassFor } from '../domain/crawlers.js';

export type ExperimentMetric = 'clean_answer_rate' | 'supported_citation_rate' | 'brand_presence_rate';

export const METRIC_LABEL: Record<ExperimentMetric, string> = {
  clean_answer_rate: 'Answers free of this defect',
  supported_citation_rate: 'Answers citing a source that actually supports the claim',
  brand_presence_rate: 'Answers that mention the brand at all',
};

export interface CreateActionInput {
  tenantId: string;
  brandId: string;
  clusterId: string | null;
  /**
   * Every cluster the defect was observed in. A defect is a claim, not a page: if a model
   * repeats it across five clusters, the fix is tested across five clusters, and the
   * experiment gets the sample size that conclusion actually requires.
   */
  treatmentClusterIds?: string[];
  actionType: string;
  title: string;
  rationale: string;
  evidence: string[];
  assumptions: string[];
  misconceptionKey?: string | null;
  grounding?: 'grounded_search' | 'training_memory' | 'hybrid';
  actor: string;
}

export class UnknownActionTypeError extends Error {
  constructor(t: string) {
    super(
      `"${t}" is not a permitted action type. The catalogue is closed by design: synthetic mentions, ` +
        'automated third-party posting and incentivised reviews are not products we will ship.',
    );
    this.name = 'UnknownActionTypeError';
  }
}

export function createAction(db: DB, input: CreateActionInput): repo.Row {
  if (!isActionType(input.actionType)) throw new UnknownActionTypeError(input.actionType);
  assertEvidence(input.evidence);

  const actionType = input.actionType as ActionType;
  const cluster = input.clusterId ? repo.getCluster(db, input.tenantId, input.clusterId) : undefined;

  const cohort = confirmedCohort(db, input.tenantId, input.brandId);
  const expected = deriveExpectedRange(actionType, cohort);

  const defectMeasurement = input.misconceptionKey
    ? defectMeasurementFor(db, input.tenantId, input.brandId, input.misconceptionKey)
    : measure(0, 0);

  const priority = cluster
    ? computePriority({
        demandWeight: cluster.demand_weight,
        intentFamily: cluster.intent_family as IntentFamily,
        economicValue: cluster.economic_value,
        defect: defectMeasurement,
        actionType,
      })
    : null;

  const row = repo.insertAction(db, input.tenantId, {
    brand_id: input.brandId,
    cluster_id: input.clusterId,
    action_type: actionType,
    title: input.title,
    rationale: input.rationale,
    evidence: JSON.stringify(input.evidence),
    assumptions: JSON.stringify(input.assumptions.length ? input.assumptions : defaultAssumptions(actionType)),
    expected_low: expected?.low ?? null,
    expected_high: expected?.high ?? null,
    expected_basis:
      expected?.basis ??
      'No comparable prior in this workspace — this ships as an experiment rather than a prediction.',
    crawler_class: input.grounding ? relevantBotClassFor(input.grounding) : null,
    priority: priority?.score ?? 0,
    priority_factors: JSON.stringify(
      priority
        ? {
            ...priority,
            misconceptionKey: input.misconceptionKey ?? null,
            treatmentClusterIds: dedupe([...(input.treatmentClusterIds ?? []), ...(input.clusterId ? [input.clusterId] : [])]),
          }
        : {
            note: 'No cluster attached; priority is not computed for unattached actions.',
            misconceptionKey: input.misconceptionKey ?? null,
            treatmentClusterIds: dedupe(input.treatmentClusterIds ?? []),
          },
    ),
    state: 'detected',
    experiment_id: null,
  });

  repo.insertTransition(db, input.tenantId, row.id, 'detected', 'detected', input.actor, 'Detected from sampled evidence');
  repo.audit(db, input.tenantId, input.actor, 'action_created', 'action', row.id, `${ACTION_LABEL[actionType]}: ${input.title}`);
  return row;
}

function defaultAssumptions(t: ActionType): string[] {
  const shared = [
    'The sampled surfaces remain on the same model versions for the duration of the experiment.',
    'No competing content change lands on the same pages during the measurement window.',
  ];
  const specific: Partial<Record<ActionType, string[]>> = {
    update_owned_page: ['The page is reachable by the retrieval-class crawlers that ground these answers.'],
    fix_crawler_access: ['The block is in robots.txt or the CDN edge rules rather than upstream of them.'],
    publisher_correction_packet: ['The publisher is willing to issue a correction; we control the request, not the outcome.'],
    request_genuine_reviews: ['Reviews are solicited from real customers with no incentive attached to sentiment.'],
  };
  return [...(specific[t] ?? []), ...shared];
}

function confirmedCohort(db: DB, tenantId: string, brandId: string): CohortObservation[] {
  const out: CohortObservation[] = [];
  for (const e of repo.listExperiments(db, tenantId, brandId)) {
    if (e.verdict !== 'confirmed' || !e.baseline_n || !e.post_n) continue;
    const action = repo.getAction(db, tenantId, e.action_id);
    if (!action || !isActionType(action.action_type)) continue;
    out.push({
      experimentId: e.id,
      actionType: action.action_type as ActionType,
      baselineRate: e.baseline_k / e.baseline_n,
      postRate: e.post_k / e.post_n,
    });
  }
  return out;
}

function defectMeasurementFor(db: DB, tenantId: string, brandId: string, misconceptionKey: string) {
  const rows = db
    .prepare(
      `SELECT r.window_label AS w, COUNT(DISTINCT r.id) AS n FROM model_runs r WHERE r.tenant_id = ? AND r.brand_id = ? GROUP BY r.window_label ORDER BY MAX(r.requested_at) DESC LIMIT 1`,
    )
    .get(tenantId, brandId) as repo.Row | undefined;
  if (!rows) return measure(0, 0);
  const k = repo.runsWithMisconception(db, tenantId, brandId, misconceptionKey, rows.w).length;
  return measure(k, rows.n);
}

// ------------------------------------------------------------------ lifecycle

export interface TransitionInput {
  tenantId: string;
  actionId: string;
  to: ActionState;
  actor: string;
  note?: string;
}

export function transitionAction(db: DB, input: TransitionInput): repo.Row {
  const action = repo.getAction(db, input.tenantId, input.actionId);
  if (!action) throw new Error('action not found');
  assertTransition(action.state as ActionState, input.to);
  repo.setActionState(db, input.tenantId, input.actionId, input.to);
  repo.insertTransition(db, input.tenantId, input.actionId, action.state, input.to, input.actor, input.note ?? '');
  repo.audit(db, input.tenantId, input.actor, 'action_transition', 'action', input.actionId, `${action.state} -> ${input.to}`);

  // Shipping an action always opens an experiment. There is no "just ship it" path.
  if (input.to === 'shipped' && !action.experiment_id) {
    const exp = createExperimentForAction(db, input.tenantId, action, input.actor);
    repo.setActionExperiment(db, input.tenantId, input.actionId, exp.id);
  }
  return repo.getAction(db, input.tenantId, input.actionId)!;
}

export function createExperimentForAction(db: DB, tenantId: string, action: repo.Row, actor: string): repo.Row {
  const factors = repo.jsonParse<any>(action.priority_factors, {});
  const declared: string[] = Array.isArray(factors.treatmentClusterIds) ? factors.treatmentClusterIds : [];
  const treatment = declared.length ? declared : action.cluster_id ? [action.cluster_id] : [];
  const controls = matchedControlsFor(db, tenantId, action.brand_id, treatment);
  const metric: ExperimentMetric = factors.misconceptionKey ? 'clean_answer_rate' : 'supported_citation_rate';

  const exp = repo.insertExperiment(db, tenantId, {
    brand_id: action.brand_id,
    action_id: action.id,
    metric,
    treatment_clusters: JSON.stringify(treatment),
    control_clusters: JSON.stringify(controls),
    baseline_window: 'baseline',
    post_window: 'post',
    published_at: new Date().toISOString(),
    crawled_at: null,
    indexed_at: null,
    baseline_k: null, baseline_n: null, post_k: null, post_n: null,
    control_baseline_k: null, control_baseline_n: null, control_post_k: null, control_post_n: null,
    p_value: null, probability_real: null, did_effect: null,
    verdict: 'pending',
    alternative_explanations: '[]',
  });
  repo.audit(db, tenantId, actor, 'experiment_opened', 'experiment', exp.id, `metric=${metric} controls=${controls.length}`);
  return exp;
}

/** Controls for a whole treatment set: matched per cluster, then deduped and de-overlapped. */
export function matchedControlsFor(db: DB, tenantId: string, brandId: string, treatmentClusterIds: string[]): string[] {
  const treated = new Set(treatmentClusterIds);
  const out: string[] = [];
  for (const cid of treatmentClusterIds) {
    for (const control of matchedControls(db, tenantId, brandId, cid)) {
      if (!treated.has(control) && !out.includes(control)) out.push(control);
    }
  }
  return out;
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}

/** Controls matched on intent family and demand decile, and untouched by this action. */
export function matchedControls(db: DB, tenantId: string, brandId: string, treatmentClusterId: string | null): string[] {
  if (!treatmentClusterId) return [];
  const treatment = repo.getCluster(db, tenantId, treatmentClusterId);
  if (!treatment) return [];
  const decile = Math.floor(treatment.demand_weight * 10);
  return repo
    .listClusters(db, tenantId, brandId)
    .filter(
      (c) =>
        c.id !== treatmentClusterId &&
        c.intent_family === treatment.intent_family &&
        Math.abs(Math.floor(c.demand_weight * 10) - decile) <= 1,
    )
    .slice(0, 3)
    .map((c) => c.id);
}

// -------------------------------------------------------------------- analysis

export function analyzeExperimentForAction(db: DB, tenantId: string, experimentId: string, actor: string): repo.Row {
  const exp = repo.getExperiment(db, tenantId, experimentId);
  if (!exp) throw new Error('experiment not found');
  const action = repo.getAction(db, tenantId, exp.action_id);
  const factors = repo.jsonParse<any>(action?.priority_factors ?? '{}', {});
  const metric = exp.metric as ExperimentMetric;
  const treatment = repo.jsonParse<string[]>(exp.treatment_clusters, []);
  const controls = repo.jsonParse<string[]>(exp.control_clusters, []);

  const t0 = countMetric(db, tenantId, exp.brand_id, treatment, exp.baseline_window, metric, factors.misconceptionKey);
  const t1 = countMetric(db, tenantId, exp.brand_id, treatment, exp.post_window, metric, factors.misconceptionKey);
  const c0 = countMetric(db, tenantId, exp.brand_id, controls, exp.baseline_window, metric, factors.misconceptionKey);
  const c1 = countMetric(db, tenantId, exp.brand_id, controls, exp.post_window, metric, factors.misconceptionKey);

  const analysis = analyzeExperiment(
    {
      baselineK: t0.k, baselineN: t0.n, postK: t1.k, postN: t1.n,
      controlBaselineK: c0.n ? c0.k : null, controlBaselineN: c0.n || null,
      controlPostK: c1.n ? c1.k : null, controlPostN: c1.n || null,
    },
    c0.n > 0 && c1.n > 0,
  );

  repo.updateExperimentAnalysis(db, tenantId, experimentId, {
    baseline_k: t0.k, baseline_n: t0.n, post_k: t1.k, post_n: t1.n,
    control_baseline_k: c0.n ? c0.k : null, control_baseline_n: c0.n || null,
    control_post_k: c1.n ? c1.k : null, control_post_n: c1.n || null,
    p_value: analysis.pValue,
    probability_real: analysis.probabilityReal,
    did_effect: analysis.didEffect,
    verdict: analysis.verdict,
    alternative_explanations: JSON.stringify(analysis.alternativeExplanations),
    crawled_at: exp.crawled_at ?? new Date().toISOString(),
    indexed_at: exp.indexed_at ?? new Date().toISOString(),
  });

  if (action) {
    const current = action.state as ActionState;
    // Walk the action forward only through legal states, and only as far as the evidence allows.
    const path: ActionState[] = ['crawled', 'observed', analysis.verdict === 'confirmed' ? 'confirmed' : 'rejected'];
    let state = current;
    for (const next of path) {
      if (next === 'rejected' && analysis.verdict === 'inconclusive') break;
      try {
        assertTransition(state, next);
      } catch {
        continue;
      }
      repo.setActionState(db, tenantId, action.id, next);
      repo.insertTransition(db, tenantId, action.id, state, next, actor, `experiment ${analysis.verdict}`);
      state = next;
    }
  }

  repo.audit(db, tenantId, actor, 'experiment_analyzed', 'experiment', experimentId, `verdict=${analysis.verdict} p=${analysis.pValue.toFixed(4)}`);
  return repo.getExperiment(db, tenantId, experimentId)!;
}

export function countMetric(
  db: DB,
  tenantId: string,
  brandId: string,
  clusterIds: string[],
  windowLabel: string,
  metric: ExperimentMetric,
  misconceptionKey?: string | null,
): { k: number; n: number } {
  if (clusterIds.length === 0) return { k: 0, n: 0 };
  const placeholders = clusterIds.map(() => '?').join(',');
  const runs = db
    .prepare(
      `SELECT * FROM model_runs WHERE tenant_id = ? AND brand_id = ? AND window_label = ? AND cluster_id IN (${placeholders})`,
    )
    .all(tenantId, brandId, windowLabel, ...clusterIds) as repo.Row[];
  let k = 0;
  for (const r of runs) {
    if (metric === 'clean_answer_rate') {
      const obs = repo.observedForRun(db, tenantId, r.id);
      const hasDefect = misconceptionKey
        ? obs.some((o) => o.misconception_key === misconceptionKey)
        : obs.some((o) => o.verdict === 'CONTRADICTED' || o.verdict === 'STALE');
      if (!hasDefect) k++;
    } else if (metric === 'supported_citation_rate') {
      const cits = repo.citationsForRun(db, tenantId, r.id);
      if (cits.some((c) => c.support === 'supports')) k++;
    } else {
      const obs = repo.observedForRun(db, tenantId, r.id);
      if (obs.some((o) => o.brand_role !== 'absent')) k++;
    }
  }
  return { k, n: runs.length };
}

export function attachBusinessOutcome(
  db: DB,
  tenantId: string,
  brandId: string,
  experimentId: string,
  o: { source: string; metric: string; baselineValue: number; postValue: number; unit: string },
  actor: string,
): repo.Row {
  const row = repo.insertBusinessOutcome(db, tenantId, {
    brand_id: brandId,
    experiment_id: experimentId,
    source: o.source,
    metric: o.metric,
    baseline_value: o.baselineValue,
    post_value: o.postValue,
    unit: o.unit,
    interpretation: 'correlational',
    caveat: OUTCOME_CAVEAT,
  });
  repo.audit(db, tenantId, actor, 'outcome_attached', 'experiment', experimentId, `${o.source} ${o.metric}`);
  return row;
}
