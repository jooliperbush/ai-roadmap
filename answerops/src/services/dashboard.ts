/**
 * The dashboard service produces exactly three sections. Not nine. Not a Kanban of
 * AI-generated advice. Three questions a CMO actually has: what is wrong, what are we
 * missing, and did the last fix work.
 */

import type { DB } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import {
  Measurement,
  measure,
  formatMeasurement,
  benjaminiHochberg,
  twoProportionTest,
} from '../domain/stats.js';
import { IntentFamily, INTENT_WEIGHT, FAMILY_LABEL, assertNoBlending } from '../domain/intent.js';
import { computePriority, ActionType } from '../domain/priority.js';
import { analyzeExperiment } from '../domain/experiments.js';
import { predicateLabel } from '../domain/verifier.js';

export interface DefectItem {
  misconceptionKey: string;
  headline: string;
  verdict: string;
  severity: string;
  exampleStatement: string;
  measurement: Measurement;
  measurementText: string;
  providers: string[];
  clusterIds: string[];
  clusterLabels: string[];
  intentFamily: IntentFamily;
  canonicalClaimId: string | null;
  canonicalClaimText: string | null;
  priority: number;
  priorityExplanation: string;
  suggestedActionType: ActionType;
  baselineComparison: { pValue: number; significant: boolean; qValue: number | null; effect: number } | null;
  /** two independent evaluators agreed on this verdict; required before a critical alert */
  adjudicated: boolean;
}

export interface MissedDemandItem {
  clusterId: string;
  label: string;
  intentFamily: IntentFamily;
  buyerStage: string;
  absence: Measurement;
  absenceText: string;
  demandWeight: number;
  demandVolume: number;
  economicValue: number;
  competitorsPresent: string[];
  priority: number;
}

export interface ConfirmedWinItem {
  experimentId: string;
  actionId: string;
  actionTitle: string;
  metric: string;
  baseline: Measurement;
  post: Measurement;
  probabilityReal: number;
  didEffect: number;
  narrative: string;
  alternativeExplanations: string[];
  hasControl: boolean;
}

export interface DashboardData {
  brand: repo.Row;
  window: string;
  baselineWindow: string | null;
  totalRuns: number;
  simulatedRuns: number;
  defects: DefectItem[];
  missedDemand: MissedDemandItem[];
  missedDemandShare: number;
  confirmedWins: ConfirmedWinItem[];
  familySummaries: Array<{
    family: IntentFamily;
    label: string;
    clusters: number;
    runs: number;
    defectRate: Measurement;
  }>;
  coverage: { clusters: number; sampledClusters: number; surfaces: number };
  windows: WindowSummary[];
  /** facts models asserted that the registry can neither confirm nor deny */
  registryGaps: string[];
  windowStatus: 'complete' | 'partial';
}

export interface WindowSummary {
  label: string;
  lastAt: string;
  runs: number;
  clusters: number;
  comparable: boolean;
}

/** Every sampling window recorded for this brand, newest first. */
export function listWindows(db: DB, tenantId: string, brandId: string): WindowSummary[] {
  const windows = db
    .prepare(
      `WITH window_counts AS (
    SELECT window_label AS label, MAX(requested_at) AS lastAt, COUNT(*) AS runs, COUNT(DISTINCT cluster_id) AS clusters
    FROM model_runs WHERE tenant_id = ? AND brand_id = ? GROUP BY window_label)
    SELECT label, lastAt, runs, clusters, CASE WHEN clusters >= 0.8 * (SELECT MAX(clusters) FROM window_counts)
      THEN 1 ELSE 0 END AS comparable FROM window_counts ORDER BY lastAt DESC`,
    )
    .all(tenantId, brandId) as repo.Row[];
  return windows.map((window) => ({
    label: window.label,
    lastAt: window.lastAt,
    runs: window.runs,
    clusters: window.clusters,
    comparable: Boolean(window.comparable),
  }));
}

export function latestWindow(
  db: DB,
  tenantId: string,
  brandId: string,
): { current: string; baseline: string | null } {
  const all = listWindows(db, tenantId, brandId);
  const complete = all.filter((window) => window.comparable);
  const [current, baseline] = complete.length ? complete : all;
  return { current: current?.label ?? 'baseline', baseline: baseline?.label ?? null };
}

/**
 * One window, loaded in two statements instead of one per run.
 *
 * The dashboard used to walk every run and query its observed claims, which was fine at 300
 * runs and quadratic misery at 30,000 a month. Everything below reads from these maps.
 */
interface WindowSnapshot {
  label: string;
  runs: repo.Row[];
  observedByRun: Map<string, repo.Row[]>;
  runsByCluster: Map<string, repo.Row[]>;
}

function loadWindow(db: DB, tenantId: string, brandId: string, label: string): WindowSnapshot {
  const runs = repo.runsForWindow(db, tenantId, brandId, label);
  return {
    label,
    runs,
    observedByRun: repo.observedForWindow(db, tenantId, brandId, label),
    runsByCluster: runs.reduce<Map<string, repo.Row[]>>((groups, run) => {
      const group = groups.get(run.cluster_id);
      if (group) group.push(run);
      else groups.set(run.cluster_id, [run]);
      return groups;
    }, new Map<string, repo.Row[]>()),
  };
}

function runsInClusters(snap: WindowSnapshot, clusterIds: string[]): repo.Row[] {
  return clusterIds.flatMap((id) => snap.runsByCluster.get(id) ?? []);
}

export interface RollupItem {
  misconceptionKey: string;
  verdict: string;
  severity: string;
  exampleStatement: string;
  canonicalClaimId: string | null;
  defectRuns: number;
  providers: string[];
  clusterIds: string[];
  adjudicated: boolean;
}

/**
 * The misconception rollup, computed in memory rather than with GROUP_CONCAT.
 *
 * Two reasons. It removes a query per defect, and it removes the delimiter hazard: a cluster
 * label containing a comma would have corrupted the parsed list, and "today the ids are
 * opaque so it is safe" is exactly the kind of accidental safety that stops being true.
 */
export function rollupFrom(snap: WindowSnapshot): RollupItem[] {
  type Accumulator = { value: RollupItem; runs: Set<string>; providers: Set<string>; clusters: Set<string> };
  const groups = new Map<string, Accumulator>();
  for (const run of snap.runs) {
    for (const claim of snap.observedByRun.get(run.id) ?? []) {
      if (
        !['CONTRADICTED', 'STALE'].includes(claim.verdict) ||
        !['agreed', 'not_required'].includes(claim.adjudication) ||
        !claim.misconception_key
      )
        continue;
      const key = JSON.stringify([claim.misconception_key, claim.verdict]);
      let group = groups.get(key);
      if (!group) {
        group = {
          runs: new Set(),
          providers: new Set(),
          clusters: new Set(),
          value: {
            misconceptionKey: claim.misconception_key,
            verdict: claim.verdict,
            severity: claim.severity,
            exampleStatement: claim.statement,
            canonicalClaimId: claim.canonical_claim_id ?? null,
            defectRuns: 0,
            providers: [],
            clusterIds: [],
            adjudicated: false,
          },
        };
        groups.set(key, group);
      }
      const item = group.value;
      group.runs.add(run.id);
      group.providers.add(run.provider);
      group.clusters.add(run.cluster_id);
      if (SEVERITY_ORDER.indexOf(claim.severity) > SEVERITY_ORDER.indexOf(item.severity))
        item.severity = claim.severity;
      if (claim.statement < item.exampleStatement) item.exampleStatement = claim.statement;
      item.canonicalClaimId ||= claim.canonical_claim_id ?? null;
      item.adjudicated ||= claim.adjudication === 'agreed';
    }
  }
  return [...groups.values()]
    .map(({ value, runs, providers, clusters }) => ({
      ...value,
      defectRuns: runs.size,
      providers: [...providers].sort(),
      clusterIds: [...clusters].sort(),
    }))
    .sort((a, b) => b.defectRuns - a.defectRuns);
}

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

/** Runs in a window carrying a given misconception, from the prefetched snapshot. */
function runsWithMisconceptionIn(snap: WindowSnapshot, misconceptionKey: string): string[] {
  return [...snap.observedByRun]
    .filter(([, claims]) => claims.find((claim) => claim.misconception_key === misconceptionKey))
    .map(([id]) => id);
}

function defectsFor(
  snap: WindowSnapshot,
  baseline: WindowSnapshot | null,
  clusters: repo.Row[],
  canonical: repo.Row[],
): DefectItem[] {
  const clusterById = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const claims = new Map(canonical.map((claim) => [claim.id, claim]));
  const defects: DefectItem[] = [];
  for (const aggregate of rollupFrom(snap)) {
    const cluster = clusterById.get(aggregate.clusterIds[0]) ?? clusters[0];
    if (!cluster) continue;
    const measurement = measure(aggregate.defectRuns, runsInClusters(snap, aggregate.clusterIds).length);
    const action: ActionType = aggregate.verdict === 'STALE' ? 'fix_fact_inconsistency' : 'update_owned_page';
    const priority = computePriority({
      demandWeight: cluster.demand_weight,
      intentFamily: cluster.intent_family,
      economicValue: cluster.economic_value,
      defect: measurement,
      actionType: action,
    });
    let comparison: DefectItem['baselineComparison'] = null;
    if (baseline) {
      const previousN = runsInClusters(baseline, aggregate.clusterIds).length;
      const previousK = runsWithMisconceptionIn(baseline, aggregate.misconceptionKey).length;
      const test = twoProportionTest(previousK, previousN, aggregate.defectRuns, measurement.n);
      comparison = {
        pValue: test.pValue,
        significant: test.significant,
        qValue: null,
        effect:
          (measurement.n ? aggregate.defectRuns / measurement.n : 0) -
          (previousN ? previousK / previousN : 0),
      };
    }
    const claim = aggregate.canonicalClaimId ? claims.get(aggregate.canonicalClaimId) : undefined;
    defects.push({
      misconceptionKey: aggregate.misconceptionKey,
      verdict: aggregate.verdict,
      severity: aggregate.severity,
      exampleStatement: aggregate.exampleStatement,
      adjudicated: aggregate.adjudicated,
      headline: buildDefectHeadline(
        aggregate.providers,
        aggregate.verdict,
        measurement,
        predicateOf(aggregate.misconceptionKey),
      ),
      measurement,
      measurementText: formatMeasurement(measurement),
      providers: aggregate.providers,
      clusterIds: aggregate.clusterIds,
      clusterLabels: aggregate.clusterIds.map((id) => clusterById.get(id)?.label ?? id),
      intentFamily: cluster.intent_family,
      canonicalClaimId: claim?.id ?? null,
      canonicalClaimText: claim?.claim_text ?? null,
      priority: priority.score,
      priorityExplanation: priority.explanation,
      suggestedActionType: action,
      baselineComparison: comparison,
    });
  }
  const comparisons = defects.flatMap((defect) =>
    defect.baselineComparison ? [defect.baselineComparison] : [],
  );
  const adjusted = benjaminiHochberg(comparisons.map((comparison) => comparison.pValue));
  comparisons.forEach((comparison, index) => {
    comparison.qValue = adjusted[index]?.qValue ?? null;
    comparison.significant &&= adjusted[index]?.rejected ?? false;
  });
  return defects
    .filter((defect) => ['critical', 'high'].includes(defect.severity) || defect.measurement.sufficient)
    .sort((a, b) => b.priority - a.priority);
}

function missedFor(snap: WindowSnapshot, clusters: repo.Row[]): MissedDemandItem[] {
  const result: MissedDemandItem[] = [];
  for (const cluster of clusters) {
    if (!['comparison', 'unaided_discovery', 'transactional'].includes(cluster.intent_family)) continue;
    const runs = snap.runsByCluster.get(cluster.id) ?? [];
    if (!runs.length) continue;
    const roles = runs.map((run) => snap.observedByRun.get(run.id)?.[0]?.brand_role ?? 'absent');
    const absence = measure(roles.filter((role) => role === 'absent').length, runs.length);
    if (!absence.sufficient || (absence.ciLow ?? 0) <= 0.5) continue;
    const priority = computePriority({
      demandWeight: cluster.demand_weight,
      intentFamily: cluster.intent_family,
      economicValue: cluster.economic_value,
      defect: absence,
      actionType: cluster.intent_family === 'comparison' ? 'create_comparison_page' : 'create_evidence_page',
    });
    result.push({
      clusterId: cluster.id,
      label: cluster.label,
      intentFamily: cluster.intent_family,
      buyerStage: cluster.buyer_stage,
      absence,
      absenceText: formatMeasurement(absence),
      demandWeight: cluster.demand_weight,
      demandVolume: cluster.demand_volume,
      economicValue: cluster.economic_value,
      competitorsPresent: roles.includes('compared') ? ['competitor named alongside'] : [],
      priority: priority.score,
    });
  }
  return result.sort((a, b) => b.priority - a.priority);
}

function winsFor(experiments: repo.Row[], actions: repo.Row[]): ConfirmedWinItem[] {
  const titles = new Map(actions.map((action) => [action.id, action.title]));
  return experiments
    .filter((experiment) => experiment.verdict === 'confirmed')
    .map((experiment) => {
      const hasControl = Boolean(experiment.control_baseline_n);
      const result = analyzeExperiment(
        {
          baselineK: experiment.baseline_k ?? 0,
          baselineN: experiment.baseline_n ?? 0,
          postK: experiment.post_k ?? 0,
          postN: experiment.post_n ?? 0,
          controlBaselineK: experiment.control_baseline_k,
          controlBaselineN: experiment.control_baseline_n,
          controlPostK: experiment.control_post_k,
          controlPostN: experiment.control_post_n,
        },
        hasControl,
      );
      return {
        experimentId: experiment.id,
        actionId: experiment.action_id,
        actionTitle: titles.get(experiment.action_id) ?? 'Action',
        metric: experiment.metric,
        baseline: result.baseline,
        post: result.post,
        probabilityReal: result.probabilityReal,
        didEffect: result.didEffect,
        narrative: result.narrative,
        alternativeExplanations: result.alternativeExplanations,
        hasControl,
      };
    });
}

function summariseByFamily(snap: WindowSnapshot, clusters: repo.Row[]): DashboardData['familySummaries'] {
  const groups = new Map<IntentFamily, repo.Row[]>();
  for (const cluster of clusters) {
    const family = cluster.intent_family as IntentFamily;
    const members = groups.get(family);
    if (members) members.push(cluster);
    else groups.set(family, [cluster]);
  }
  return [...groups]
    .map(([family, members]) => {
      assertNoBlending(members.map((cluster) => cluster.intent_family));
      const runs = runsInClusters(
        snap,
        members.map((cluster) => cluster.id),
      );
      const defects = runs.filter((run) =>
        (snap.observedByRun.get(run.id) ?? []).some(
          (claim) =>
            ['CONTRADICTED', 'STALE'].includes(claim.verdict) &&
            ['agreed', 'not_required'].includes(claim.adjudication),
        ),
      );
      return {
        family,
        label: FAMILY_LABEL[family],
        clusters: members.length,
        runs: runs.length,
        defectRate: measure(defects.length, runs.length),
      };
    })
    .sort((a, b) => INTENT_WEIGHT[b.family] - INTENT_WEIGHT[a.family]);
}

export function buildDashboard(
  db: DB,
  tenantId: string,
  brandId: string,
  windowOverride?: string | null,
): DashboardData {
  const brand = repo.getBrand(db, tenantId, brandId);
  if (!brand) throw new Error('brand not found');
  const windows = listWindows(db, tenantId, brandId);
  const comparable = windows.filter((window) => window.comparable);
  const usable = comparable.length ? comparable : windows;
  const defaultWindow = usable[0]?.label ?? 'baseline';
  const current =
    windowOverride && windows.some((window) => window.label === windowOverride)
      ? windowOverride
      : defaultWindow;
  const baseline =
    current === defaultWindow
      ? (usable[1]?.label ?? null)
      : (windows.find((window) => window.label !== current)?.label ?? null);
  const clusters = repo.listClusters(db, tenantId, brandId);
  const snapshot = loadWindow(db, tenantId, brandId, current);
  const previous = baseline ? loadWindow(db, tenantId, brandId, baseline) : null;
  const missedDemand = missedFor(snapshot, clusters);
  const registryGaps = new Set<string>();
  for (const claims of snapshot.observedByRun.values())
    for (const claim of claims) {
      if (claim.verdict === 'UNSUPPORTED' && claim.predicate !== 'brand_presence')
        registryGaps.add(`${claim.subject} / ${claim.predicate}`);
    }
  return {
    brand,
    window: current,
    baselineWindow: baseline,
    totalRuns: snapshot.runs.length,
    simulatedRuns: snapshot.runs.filter((run) => run.simulated === 1).length,
    defects: defectsFor(snapshot, previous, clusters, repo.listCanonicalClaims(db, tenantId, brandId)),
    missedDemand,
    missedDemandShare:
      missedDemand.reduce((sum, item) => sum + item.demandWeight, 0) /
      (clusters.reduce((sum, cluster) => sum + cluster.demand_weight, 0) || 1),
    confirmedWins: winsFor(
      repo.listExperiments(db, tenantId, brandId),
      repo.listActions(db, tenantId, brandId),
    ),
    familySummaries: summariseByFamily(snapshot, clusters),
    coverage: {
      clusters: clusters.length,
      sampledClusters: new Set(snapshot.runs.map((run) => run.cluster_id)).size,
      surfaces: new Set(snapshot.runs.map((run) => `${run.provider}:${run.surface}:${run.grounding}`)).size,
    },
    windows,
    registryGaps: [...registryGaps].sort(),
    windowStatus:
      (repo.getWindowStatus(db, tenantId, brandId, current)?.status as 'complete' | 'partial') ?? 'complete',
  };
}

/** The misconception key is `subject.predicate.polarity.object`. */
function predicateOf(misconceptionKey: string): string {
  return misconceptionKey.match(/^[^.]*\.([^.]*)/)?.[1] ?? '';
}

function buildDefectHeadline(
  providers: string[],
  verdict: string,
  measurement: Measurement,
  predicate: string,
): string {
  const names = providers.map(titleProvider);
  const who = names.length ? joinList(names) : 'Sampled surfaces';
  const stale = verdict === 'STALE';
  const verbs = stale
    ? ['repeats an out-of-date account of', 'repeat an out-of-date account of']
    : ['describes', 'describe'];
  const verb = verbs[providers.length === 1 ? 0 : 1];
  const subject = predicateLabel(predicate) + (stale ? '' : ' incorrectly');
  const percent = (value: number | null) => Math.round((value ?? 0) * 100);
  const rate =
    measurement.sufficient && measurement.point !== null
      ? `${percent(measurement.point)}% of sampled answers (95% CI ${percent(measurement.ciLow)}–${percent(measurement.ciHigh)}%, n=${measurement.n})`
      : `an unquantified share of answers (n=${measurement.n} — below the sample floor)`;
  return `${who} ${verb} ${subject} in ${rate}.`;
}

function joinList(items: string[]): string {
  const final = items.at(-1);
  return items.length < 2 ? (final ?? '') : `${items.slice(0, -1).join(', ')} and ${final}`;
}

const PROVIDER_TITLES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  google: 'Gemini',
  perplexity: 'Perplexity',
  xai: 'Grok',
};
function titleProvider(provider: string): string {
  return Object.hasOwn(PROVIDER_TITLES, provider) ? PROVIDER_TITLES[provider] : provider;
}
