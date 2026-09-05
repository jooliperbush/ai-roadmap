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
import {
  ActionType,
  isActionType,
  deriveExpectedRange,
  computePriority,
  CohortObservation,
  ACTION_LABEL,
} from '../domain/priority.js';
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

export class InvalidActionReferenceError extends Error {
  constructor() {
    super('Action clusters and stored evidence must belong to this brand.');
    this.name = 'InvalidActionReferenceError';
  }
}

function validateActionReferences(db: DB, input: CreateActionInput): void {
  const clusters = dedupe([
    ...(input.treatmentClusterIds ?? []),
    ...(input.clusterId ? [input.clusterId] : []),
  ]);
  for (const id of clusters) {
    const cluster = repo.getCluster(db, input.tenantId, id);
    if (!cluster || cluster.brand_id !== input.brandId) throw new InvalidActionReferenceError();
  }
  if (!input.evidence.length) return;
  // Detached evidence labels are part of the public action contract. When a reference resolves
  // to stored evidence, its ownership is mandatory and cannot be borrowed from another brand.
  const placeholders = input.evidence.map(() => '?').join(',');
  const references = db
    .prepare(
      `SELECT evidence.tenant_id, evidence.brand_id FROM (
    SELECT o.id, r.tenant_id, r.brand_id FROM observed_claims o JOIN model_runs r ON r.id = o.run_id AND r.tenant_id = o.tenant_id
    UNION ALL SELECT c.id, r.tenant_id, r.brand_id FROM citations c JOIN model_runs r ON r.id = c.run_id AND r.tenant_id = c.tenant_id
    UNION ALL SELECT id, tenant_id, brand_id FROM model_runs
    UNION ALL SELECT id, tenant_id, brand_id FROM canonical_claims
  ) AS evidence WHERE evidence.id IN (${placeholders})`,
    )
    .all(...input.evidence) as repo.Row[];
  if (
    references.some(
      (reference) => reference.tenant_id !== input.tenantId || reference.brand_id !== input.brandId,
    )
  )
    throw new InvalidActionReferenceError();
}

export function createAction(db: DB, input: CreateActionInput): repo.Row {
  if (!isActionType(input.actionType)) throw new UnknownActionTypeError(input.actionType);
  assertEvidence(input.evidence);
  const type = input.actionType;
  return db.transaction(() => {
    validateActionReferences(db, input);
    const cluster = input.clusterId ? repo.getCluster(db, input.tenantId, input.clusterId) : undefined;
    const expected = deriveExpectedRange(type, confirmedCohort(db, input.tenantId, input.brandId));
    const measurement = input.misconceptionKey
      ? defectMeasurementFor(db, input.tenantId, input.brandId, input.misconceptionKey)
      : measure(0, 0);
    const priority = cluster
      ? computePriority({
          demandWeight: cluster.demand_weight,
          intentFamily: cluster.intent_family,
          economicValue: cluster.economic_value,
          defect: measurement,
          actionType: type,
        })
      : null;
    const factors = {
      ...(priority ?? { note: 'No cluster attached; priority is not computed for unattached actions.' }),
      misconceptionKey: input.misconceptionKey ?? null,
      treatmentClusterIds: dedupe([
        ...(input.treatmentClusterIds ?? []),
        ...(priority && input.clusterId ? [input.clusterId] : []),
      ]),
    };
    const action = repo.insertAction(db, input.tenantId, {
      brand_id: input.brandId,
      cluster_id: input.clusterId,
      action_type: type,
      title: input.title,
      rationale: input.rationale,
      evidence: JSON.stringify(input.evidence),
      assumptions: JSON.stringify(input.assumptions.length ? input.assumptions : defaultAssumptions(type)),
      expected_low: expected?.low ?? null,
      expected_high: expected?.high ?? null,
      expected_basis:
        expected?.basis ??
        'No comparable prior in this workspace — this ships as an experiment rather than a prediction.',
      crawler_class: input.grounding ? relevantBotClassFor(input.grounding) : null,
      priority: priority?.score ?? 0,
      priority_factors: JSON.stringify(factors),
      state: 'detected',
      experiment_id: null,
    });
    repo.insertTransition(
      db,
      input.tenantId,
      action.id,
      'detected',
      'detected',
      input.actor,
      'Detected from sampled evidence',
    );
    repo.audit(
      db,
      input.tenantId,
      input.actor,
      'action_created',
      'action',
      action.id,
      `${ACTION_LABEL[type]}: ${input.title}`,
    );
    return action;
  })();
}

function defaultAssumptions(t: ActionType): string[] {
  const shared = [
    'The sampled surfaces remain on the same model versions for the duration of the experiment.',
    'No competing content change lands on the same pages during the measurement window.',
  ];
  const specific: Partial<Record<ActionType, string[]>> = {
    update_owned_page: ['The page is reachable by the retrieval-class crawlers that ground these answers.'],
    fix_crawler_access: ['The block is in robots.txt or the CDN edge rules rather than upstream of them.'],
    publisher_correction_packet: [
      'The publisher is willing to issue a correction; we control the request, not the outcome.',
    ],
    request_genuine_reviews: [
      'Reviews are solicited from real customers with no incentive attached to sentiment.',
    ],
  };
  return (specific[t] ?? []).concat(shared);
}

function confirmedCohort(db: DB, tenantId: string, brandId: string): CohortObservation[] {
  const out: CohortObservation[] = [];
  const actions = new Map(repo.listActions(db, tenantId, brandId).map((a) => [a.id, a]));
  for (const e of repo.listExperiments(db, tenantId, brandId)) {
    if (e.verdict !== 'confirmed' || !e.baseline_n || !e.post_n) continue;
    const action = actions.get(e.action_id);
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
  const totals = db
    .prepare(
      `WITH latest AS (
    SELECT window_label FROM model_runs WHERE tenant_id = @tenantId AND brand_id = @brandId
    GROUP BY window_label ORDER BY MAX(requested_at) DESC LIMIT 1)
    SELECT COUNT(*) AS n, COALESCE(SUM(EXISTS (SELECT 1 FROM observed_claims o
      WHERE o.run_id = r.id AND o.tenant_id = r.tenant_id AND o.misconception_key = @misconceptionKey)), 0) AS k
    FROM model_runs r WHERE r.tenant_id = @tenantId AND r.brand_id = @brandId
      AND r.window_label = (SELECT window_label FROM latest)`,
    )
    .get({ tenantId, brandId, misconceptionKey }) as { k: number; n: number };
  return measure(totals.k, totals.n);
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
  return db.transaction(() => {
    const { tenantId, actionId, to, actor } = input;
    const action = repo.getAction(db, tenantId, actionId);
    if (!action) throw new Error('action not found');
    assertTransition(action.state as ActionState, to);
    repo.setActionState(db, tenantId, actionId, to);
    repo.insertTransition(db, tenantId, actionId, action.state, to, actor, input.note ?? '');
    repo.audit(db, tenantId, actor, 'action_transition', 'action', actionId, `${action.state} -> ${to}`);
    if (to === 'shipped' && !action.experiment_id) {
      const experiment = createExperimentForAction(db, tenantId, action, actor);
      repo.setActionExperiment(db, tenantId, actionId, experiment.id);
    }
    return repo.getAction(db, tenantId, actionId)!;
  })();
}

export function createExperimentForAction(
  db: DB,
  tenantId: string,
  action: repo.Row,
  actor: string,
): repo.Row {
  return db.transaction(() => {
    const factors = repo.jsonParse<any>(action.priority_factors, {});
    const declared = Array.isArray(factors.treatmentClusterIds) ? factors.treatmentClusterIds : [];
    const treatment = declared.length ? declared : action.cluster_id ? [action.cluster_id] : [];
    const controls = matchedControlsFor(db, tenantId, action.brand_id, treatment);
    const metric: ExperimentMetric = factors.misconceptionKey
      ? 'clean_answer_rate'
      : 'supported_citation_rate';
    const experiment = repo.insertExperiment(db, tenantId, {
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
      baseline_k: null,
      baseline_n: null,
      post_k: null,
      post_n: null,
      control_baseline_k: null,
      control_baseline_n: null,
      control_post_k: null,
      control_post_n: null,
      p_value: null,
      probability_real: null,
      did_effect: null,
      verdict: 'pending',
      alternative_explanations: '[]',
    });
    repo.audit(
      db,
      tenantId,
      actor,
      'experiment_opened',
      'experiment',
      experiment.id,
      `metric=${metric} controls=${controls.length}`,
    );
    return experiment;
  })();
}

/** Controls for a whole treatment set: matched per cluster, then deduped and de-overlapped. */
export function matchedControlsFor(
  db: DB,
  tenantId: string,
  brandId: string,
  treatmentClusterIds: string[],
): string[] {
  const clusters = repo.listClusters(db, tenantId, brandId);
  const byId = new Map(clusters.map((c) => [c.id, c]));
  const treated = new Set(treatmentClusterIds);
  const selected = new Set<string>();
  for (const id of treatmentClusterIds) {
    const treatment = byId.get(id);
    if (!treatment) continue;
    for (const control of controlsFrom(clusters, treatment)) {
      if (!treated.has(control)) selected.add(control);
    }
  }
  return [...selected];
}

function controlsFrom(clusters: repo.Row[], treatment: repo.Row): string[] {
  const decile = Math.floor(treatment.demand_weight * 10);
  return clusters
    .filter(
      (c) =>
        c.id !== treatment.id &&
        c.intent_family === treatment.intent_family &&
        Math.abs(Math.floor(c.demand_weight * 10) - decile) <= 1,
    )
    .slice(0, 3)
    .map((c) => c.id);
}

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  return xs.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/** Controls matched on intent family and demand decile, and untouched by this action. */
export function matchedControls(
  db: DB,
  tenantId: string,
  brandId: string,
  treatmentClusterId: string | null,
): string[] {
  if (!treatmentClusterId) return [];
  const treatment = repo.getCluster(db, tenantId, treatmentClusterId);
  return treatment ? controlsFrom(repo.listClusters(db, tenantId, brandId), treatment) : [];
}

// -------------------------------------------------------------------- analysis

function advanceAnalyzedAction(
  db: DB,
  tenantId: string,
  action: repo.Row,
  actor: string,
  verdict: string,
): void {
  const path: ActionState[] = ['crawled', 'observed'];
  if (verdict !== 'inconclusive') path.push(verdict === 'confirmed' ? 'confirmed' : 'rejected');
  let state = action.state as ActionState;
  for (const next of path) {
    try {
      assertTransition(state, next);
    } catch {
      continue;
    }
    repo.setActionState(db, tenantId, action.id, next);
    repo.insertTransition(db, tenantId, action.id, state, next, actor, `experiment ${verdict}`);
    state = next;
  }
}

export function analyzeExperimentForAction(
  db: DB,
  tenantId: string,
  experimentId: string,
  actor: string,
): repo.Row {
  return db.transaction(() => {
    const experiment = repo.getExperiment(db, tenantId, experimentId);
    if (!experiment) throw new Error('experiment not found');
    const action = repo.getAction(db, tenantId, experiment.action_id);
    const factors = repo.jsonParse<any>(action?.priority_factors ?? '{}', {});
    const treatment = repo.jsonParse<string[]>(experiment.treatment_clusters, []);
    const controls = repo.jsonParse<string[]>(experiment.control_clusters, []);
    const count = (clusters: string[], window: string) =>
      countMetric(
        db,
        tenantId,
        experiment.brand_id,
        clusters,
        window,
        experiment.metric as ExperimentMetric,
        factors.misconceptionKey,
      );
    const before = count(treatment, experiment.baseline_window),
      after = count(treatment, experiment.post_window);
    const controlBefore = count(controls, experiment.baseline_window),
      controlAfter = count(controls, experiment.post_window);
    const counts = {
      baselineK: before.k,
      baselineN: before.n,
      postK: after.k,
      postN: after.n,
      controlBaselineK: controlBefore.n ? controlBefore.k : null,
      controlBaselineN: controlBefore.n || null,
      controlPostK: controlAfter.n ? controlAfter.k : null,
      controlPostN: controlAfter.n || null,
    };
    const analysis = analyzeExperiment(counts, controlBefore.n > 0 && controlAfter.n > 0);
    repo.updateExperimentAnalysis(db, tenantId, experimentId, {
      baseline_k: before.k,
      baseline_n: before.n,
      post_k: after.k,
      post_n: after.n,
      control_baseline_k: counts.controlBaselineK,
      control_baseline_n: counts.controlBaselineN,
      control_post_k: counts.controlPostK,
      control_post_n: counts.controlPostN,
      p_value: analysis.pValue,
      probability_real: analysis.probabilityReal,
      did_effect: analysis.didEffect,
      verdict: analysis.verdict,
      alternative_explanations: JSON.stringify(analysis.alternativeExplanations),
      crawled_at: experiment.crawled_at ?? new Date().toISOString(),
      indexed_at: experiment.indexed_at ?? new Date().toISOString(),
    });
    if (action) advanceAnalyzedAction(db, tenantId, action, actor, analysis.verdict);
    repo.audit(
      db,
      tenantId,
      actor,
      'experiment_analyzed',
      'experiment',
      experimentId,
      `verdict=${analysis.verdict} p=${analysis.pValue.toFixed(4)}`,
    );
    return repo.getExperiment(db, tenantId, experimentId)!;
  })();
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
  if (!clusterIds.length) return { k: 0, n: 0 };
  let predicate: string;
  const values: unknown[] = [];
  if (metric === 'supported_citation_rate') {
    predicate = `EXISTS (SELECT 1 FROM citations c WHERE c.run_id = r.id AND c.tenant_id = r.tenant_id AND c.support = 'supports')`;
  } else {
    const condition =
      metric === 'clean_answer_rate'
        ? misconceptionKey
          ? 'o.misconception_key = ?'
          : "o.verdict IN ('CONTRADICTED', 'STALE')"
        : "o.brand_role != 'absent'";
    if (metric === 'clean_answer_rate' && misconceptionKey) values.push(misconceptionKey);
    predicate = `${metric === 'clean_answer_rate' ? 'NOT ' : ''}EXISTS
      (SELECT 1 FROM observed_claims o WHERE o.run_id = r.id AND o.tenant_id = r.tenant_id AND ${condition})`;
  }
  return db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN ${predicate} THEN 1 ELSE 0 END), 0) AS k, COUNT(*) AS n
    FROM model_runs r WHERE r.tenant_id = ? AND r.brand_id = ? AND r.window_label = ?
    AND r.cluster_id IN (${clusterIds.map(() => '?').join(',')})`,
    )
    .get(...values, tenantId, brandId, windowLabel, ...clusterIds) as { k: number; n: number };
}

export function attachBusinessOutcome(
  db: DB,
  tenantId: string,
  brandId: string,
  experimentId: string,
  outcome: { source: string; metric: string; baselineValue: number; postValue: number; unit: string },
  actor: string,
): repo.Row {
  return db.transaction(() => {
    const row = repo.insertBusinessOutcome(db, tenantId, {
      brand_id: brandId,
      experiment_id: experimentId,
      source: outcome.source,
      metric: outcome.metric,
      baseline_value: outcome.baselineValue,
      post_value: outcome.postValue,
      unit: outcome.unit,
      interpretation: 'correlational',
      caveat: OUTCOME_CAVEAT,
    });
    repo.audit(
      db,
      tenantId,
      actor,
      'outcome_attached',
      'experiment',
      experimentId,
      `${outcome.source} ${outcome.metric}`,
    );
    return row;
  })();
}
