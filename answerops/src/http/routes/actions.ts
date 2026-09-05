import { jsonParse } from '../../db/index.js';
import * as repo from '../../db/repo/index.js';
import {
  ActionState,
  ALLOWED_TRANSITIONS,
  IllegalTransitionError,
  MissingEvidenceError,
} from '../../domain/actions.js';
import { BOT_CLASS_LABEL, relevantBotClassFor } from '../../domain/crawlers.js';
import { analyzeExperiment } from '../../domain/experiments.js';
import { formatP } from '../../domain/stats.js';
import { predicateLabel } from '../../domain/verifier.js';
import {
  analyzeExperimentForAction,
  createAction,
  transitionAction,
  UnknownActionTypeError,
  InvalidActionReferenceError,
} from '../../services/actionEngine.js';
import { buildDashboard } from '../../services/dashboard.js';
import { defectDetailView } from '../../web/views/dashboard.js';
import {
  actionDetailView,
  actionsView,
  experimentDetailView,
  experimentsView,
} from '../../web/views/pages.js';

import type { Runtime } from '../context.js';
export function actionRoutes(r: Runtime): void {
  const { db } = r;
  r.get('/defect/:key', (c) => {
    const key = c.params.key,
      data = buildDashboard(db, c.a.tenantId, c.brand.id);
    const item = data.defects.find((d) => d.misconceptionKey === key);
    if (!item) return c.missing();
    const runs = repo.runsWithMisconception(db, c.a.tenantId, c.brand.id, key, data.window).slice(0, 6);
    const bundles = runs.map((run) => ({
      run,
      statements: repo.observedForRun(db, c.a.tenantId, run.id).filter((o) => o.misconception_key === key),
      citations: repo.citationsForRun(db, c.a.tenantId, run.id),
    }));
    const grounding = runs[0]?.grounding ?? 'grounded_search';
    return c.show(
      'Defect',
      'dashboard',
      defectDetailView({
        headline: item.headline,
        verdict: item.verdict,
        severity: item.severity,
        measurement: item.measurement,
        priorityExplanation: item.priorityExplanation,
        canonical: item.canonicalClaimId
          ? repo.getCanonicalClaim(db, c.a.tenantId, item.canonicalClaimId)
          : null,
        runs: bundles,
        suggestedActionType: item.suggestedActionType,
        misconceptionKey: key,
        defectSubject: predicateLabel(key.split('.')[1] ?? ''),
        clusterId: item.clusterIds[0] ?? null,
        clusterLabel: item.clusterLabels[0] ?? null,
        treatmentClusterIds: item.clusterIds,
        evidenceIds: bundles.flatMap((b) => b.statements.map((s) => s.id)).slice(0, 12),
        actions: repo
          .listActions(db, c.a.tenantId, c.brand.id)
          .filter((ac) => jsonParse<any>(ac.priority_factors, {}).misconceptionKey === key),
        expected: null,
        crawlerNote: `These answers were produced with grounding "${grounding}", so the crawler class that can affect them is ${BOT_CLASS_LABEL[relevantBotClassFor(grounding)]} — not training ingestion.`,
      }),
    );
  });
  r.get('/actions', (c) =>
    c.show('Actions', 'actions', actionsView({ actions: repo.listActions(db, c.a.tenantId, c.brand.id) })),
  );
  r.post('/actions', (c) => {
    const b = c.body,
      list = (s: unknown) =>
        String(s ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    try {
      const action = createAction(db, {
        tenantId: c.a.tenantId,
        brandId: c.brand.id,
        clusterId: b.cluster_id || null,
        treatmentClusterIds: list(b.treatment_clusters),
        actionType: b.action_type,
        title: b.title?.trim() || 'Untitled action',
        rationale: b.rationale?.trim() || '',
        evidence: b.drop_evidence === '1' ? [] : list(b.evidence),
        assumptions: [],
        misconceptionKey: b.misconception_key || null,
        grounding: 'grounded_search',
        actor: c.a.email,
      });
      return c.redirect(`/actions/${action.id}`, 'Action created with evidence attached.');
    } catch (e) {
      if (
        e instanceof MissingEvidenceError ||
        e instanceof UnknownActionTypeError ||
        e instanceof InvalidActionReferenceError
      )
        return c.redirect(
          b.misconception_key ? `/defect/${encodeURIComponent(b.misconception_key)}` : '/actions',
          e.message,
          'error',
        );
      throw e;
    }
  });
  r.get('/actions/:id', (c) => {
    const action = repo.getAction(db, c.a.tenantId, c.params.id);
    if (!action) return c.missing('actions');
    return c.show(
      action.title,
      'actions',
      actionDetailView({
        action,
        transitions: repo.listTransitions(db, c.a.tenantId, action.id),
        evidence: jsonParse<string[]>(action.evidence, []),
        assumptions: jsonParse<string[]>(action.assumptions, []),
        factors: jsonParse<any>(action.priority_factors, {}),
        experiment: action.experiment_id ? repo.getExperiment(db, c.a.tenantId, action.experiment_id) : null,
        next: ALLOWED_TRANSITIONS[action.state as ActionState] ?? [],
      }),
    );
  });
  r.post('/actions/:id/transition', (c) => {
    try {
      transitionAction(db, {
        tenantId: c.a.tenantId,
        actionId: c.params.id,
        to: c.body.to as ActionState,
        actor: c.a.email,
        note: c.body.note ?? '',
      });
      return c.redirect(`/actions/${c.params.id}`, `Advanced to ${c.body.to}.`);
    } catch (e) {
      if (e instanceof IllegalTransitionError)
        return c.redirect(`/actions/${c.params.id}`, e.message, 'error');
      throw e;
    }
  });
  r.get('/experiments', (c) => {
    const experiments = repo.listExperiments(db, c.a.tenantId, c.brand.id);
    const actionsById = Object.fromEntries(
      repo.listActions(db, c.a.tenantId, c.brand.id).map((a) => [a.id, a]),
    );
    return c.show('Experiments', 'experiments', experimentsView({ experiments, actionsById }));
  });
  r.get('/experiments/:id', (c) => {
    const exp = repo.getExperiment(db, c.a.tenantId, c.params.id);
    if (!exp) return c.missing('experiments');
    const analysis = analyzeExperiment(
      {
        baselineK: exp.baseline_k ?? 0,
        baselineN: exp.baseline_n ?? 0,
        postK: exp.post_k ?? 0,
        postN: exp.post_n ?? 0,
        controlBaselineK: exp.control_baseline_k,
        controlBaselineN: exp.control_baseline_n,
        controlPostK: exp.control_post_k,
        controlPostN: exp.control_post_n,
      },
      Boolean(exp.control_baseline_n),
    );
    const labels = new Map(repo.listClusters(db, c.a.tenantId, exp.brand_id).map((v) => [v.id, v.label]));
    const names = (value: string) => jsonParse<string[]>(value, []).map((id) => labels.get(id) ?? id);
    return c.show(
      'Experiment',
      'experiments',
      experimentDetailView({
        experiment: exp,
        action: repo.getAction(db, c.a.tenantId, exp.action_id) ?? null,
        analysis: {
          narrative:
            exp.verdict === 'pending'
              ? 'Not analyzed yet — press “Analyze from stored runs”.'
              : analysis.narrative,
          alternatives: jsonParse<string[]>(exp.alternative_explanations, analysis.alternativeExplanations),
        },
        outcomes: repo.outcomesForExperiment(db, c.a.tenantId, exp.id),
        treatmentLabels: names(exp.treatment_clusters),
        controlLabels: names(exp.control_clusters),
      }),
    );
  });
  r.post('/experiments/:id/analyze', (c) => {
    if (!repo.getExperiment(db, c.a.tenantId, c.params.id)) return c.reply.code(404).send('not found');
    const updated = analyzeExperimentForAction(db, c.a.tenantId, c.params.id, c.a.email);
    return c.redirect(
      `/experiments/${c.params.id}`,
      `Analyzed: ${updated.verdict} (p=${formatP(Number(updated.p_value))}).`,
    );
  });
}
