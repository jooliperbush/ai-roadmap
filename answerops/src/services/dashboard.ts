/**
 * The dashboard service produces exactly three sections. Not nine. Not a Kanban of
 * AI-generated advice. Three questions a CMO actually has: what is wrong, what are we
 * missing, and did the last fix work.
 */

import type { DB } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import { Measurement, measure, formatMeasurement, benjaminiHochberg, twoProportionTest } from '../domain/stats.js';
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
  familySummaries: Array<{ family: IntentFamily; label: string; clusters: number; runs: number; defectRate: Measurement }>;
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
  const rows = db
    .prepare(
      `SELECT window_label AS label, MAX(requested_at) AS last_at, COUNT(*) AS runs,
              COUNT(DISTINCT cluster_id) AS clusters
         FROM model_runs WHERE tenant_id = ? AND brand_id = ?
        GROUP BY window_label ORDER BY last_at DESC`,
    )
    .all(tenantId, brandId) as repo.Row[];
  const maxClusters = rows.reduce((acc, r) => Math.max(acc, r.clusters), 0);
  return rows.map((r) => ({
    label: r.label,
    lastAt: r.last_at,
    runs: r.runs,
    clusters: r.clusters,
    // A partial probe is not a substitute for a full scheduled round. Comparing a 40-run
    // spot check against a 300-run baseline would move headline numbers for reasons that
    // have nothing to do with what the models are saying.
    comparable: maxClusters === 0 ? true : r.clusters >= 0.8 * maxClusters,
  }));
}

/**
 * The desk defaults to the most recent window with coverage comparable to the best round on
 * record; thinner probes stay available in the window picker rather than silently taking over.
 */
export function latestWindow(db: DB, tenantId: string, brandId: string): { current: string; baseline: string | null } {
  const windows = listWindows(db, tenantId, brandId);
  if (windows.length === 0) return { current: 'baseline', baseline: null };
  const comparable = windows.filter((w) => w.comparable);
  const usable = comparable.length ? comparable : windows;
  return { current: usable[0].label, baseline: usable[1]?.label ?? null };
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
  const observedByRun = repo.observedForWindow(db, tenantId, brandId, label);
  const runsByCluster = new Map<string, repo.Row[]>();
  for (const r of runs) {
    const list = runsByCluster.get(r.cluster_id) ?? [];
    list.push(r);
    runsByCluster.set(r.cluster_id, list);
  }
  return { label, runs, observedByRun, runsByCluster };
}

function runsInClusters(snap: WindowSnapshot, clusterIds: string[]): repo.Row[] {
  const out: repo.Row[] = [];
  for (const cid of clusterIds) out.push(...(snap.runsByCluster.get(cid) ?? []));
  return out;
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
  const byKey = new Map<string, RollupItem & { providerSet: Set<string>; clusterSet: Set<string> }>();
  const runById = new Map(snap.runs.map((r) => [r.id, r]));
  for (const [runId, claims] of snap.observedByRun) {
    const run = runById.get(runId);
    if (!run) continue;
    for (const o of claims) {
      if (o.verdict !== 'CONTRADICTED' && o.verdict !== 'STALE') continue;
      if (!['not_required', 'agreed'].includes(o.adjudication)) continue;
      if (!o.misconception_key) continue;
      const key = `${o.misconception_key}|${o.verdict}`;
      let item = byKey.get(key);
      if (!item) {
        item = {
          misconceptionKey: o.misconception_key,
          verdict: o.verdict,
          severity: o.severity,
          exampleStatement: o.statement,
          canonicalClaimId: o.canonical_claim_id ?? null,
          defectRuns: 0,
          providers: [],
          clusterIds: [],
          adjudicated: false,
          providerSet: new Set<string>(),
          clusterSet: new Set<string>(),
        };
        byKey.set(key, item);
      }
      if (SEVERITY_ORDER.indexOf(o.severity) > SEVERITY_ORDER.indexOf(item.severity)) item.severity = o.severity;
      if (o.statement < item.exampleStatement) item.exampleStatement = o.statement;
      if (!item.canonicalClaimId && o.canonical_claim_id) item.canonicalClaimId = o.canonical_claim_id;
      if (o.adjudication === 'agreed') item.adjudicated = true;
      item.providerSet.add(run.provider);
      item.clusterSet.add(run.cluster_id);
    }
  }
  // defect_runs counts distinct runs per misconception+verdict.
  const runsPerKey = new Map<string, Set<string>>();
  for (const [runId, claims] of snap.observedByRun) {
    for (const o of claims) {
      if (o.verdict !== 'CONTRADICTED' && o.verdict !== 'STALE') continue;
      if (!['not_required', 'agreed'].includes(o.adjudication)) continue;
      if (!o.misconception_key) continue;
      const key = `${o.misconception_key}|${o.verdict}`;
      const set = runsPerKey.get(key) ?? new Set<string>();
      set.add(runId);
      runsPerKey.set(key, set);
    }
  }
  const out: RollupItem[] = [];
  for (const [key, item] of byKey) {
    out.push({
      misconceptionKey: item.misconceptionKey,
      verdict: item.verdict,
      severity: item.severity,
      exampleStatement: item.exampleStatement,
      canonicalClaimId: item.canonicalClaimId,
      defectRuns: runsPerKey.get(key)?.size ?? 0,
      providers: [...item.providerSet].sort(),
      clusterIds: [...item.clusterSet].sort(),
      adjudicated: item.adjudicated,
    });
  }
  return out.sort((a, b) => b.defectRuns - a.defectRuns);
}

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

/** Runs in a window carrying a given misconception, from the prefetched snapshot. */
function runsWithMisconceptionIn(snap: WindowSnapshot, misconceptionKey: string): string[] {
  const out: string[] = [];
  for (const [runId, claims] of snap.observedByRun) {
    if (claims.some((o) => o.misconception_key === misconceptionKey)) out.push(runId);
  }
  return out;
}

export function buildDashboard(db: DB, tenantId: string, brandId: string, windowOverride?: string | null): DashboardData {
  const brand = repo.getBrand(db, tenantId, brandId);
  if (!brand) throw new Error('brand not found');
  const auto = latestWindow(db, tenantId, brandId);
  const windows = listWindows(db, tenantId, brandId);
  const chosen = windowOverride && windows.some((w) => w.label === windowOverride) ? windowOverride : auto.current;
  const current = chosen;
  const baseline = chosen === auto.current
    ? auto.baseline
    : windows.filter((w) => w.label !== chosen)[0]?.label ?? null;
  const clusters = repo.listClusters(db, tenantId, brandId);
  const clusterById = new Map(clusters.map((c) => [c.id, c]));

  const snap = loadWindow(db, tenantId, brandId, current);
  const baseSnap = baseline ? loadWindow(db, tenantId, brandId, baseline) : null;
  const allRuns = snap.runs;
  const simulatedRuns = allRuns.filter((r) => r.simulated === 1).length;
  const windowRow = repo.getWindowStatus(db, tenantId, brandId, current);

  // ---------------------------------------------------------------- section 1
  const rollup = rollupFrom(snap);
  const rawDefects: DefectItem[] = [];
  const pValues: number[] = [];

  for (const row of rollup) {
    const clusterIds = row.clusterIds;
    const denomRuns = runsInClusters(snap, clusterIds);
    const k = row.defectRuns;
    const n = denomRuns.length;
    const m = measure(k, n);
    const cluster = clusterById.get(clusterIds[0]) ?? clusters[0];
    if (!cluster) continue;

    const canonical = row.canonicalClaimId ? repo.getCanonicalClaim(db, tenantId, row.canonicalClaimId) : undefined;
    const suggested: ActionType = row.verdict === 'STALE' ? 'fix_fact_inconsistency' : 'update_owned_page';
    const priority = computePriority({
      demandWeight: cluster.demand_weight,
      intentFamily: cluster.intent_family as IntentFamily,
      economicValue: cluster.economic_value,
      defect: m,
      actionType: suggested,
    });

    let comparison: DefectItem['baselineComparison'] = null;
    if (baseSnap) {
      const baseRuns = runsInClusters(baseSnap, clusterIds);
      const baseK = runsWithMisconceptionIn(baseSnap, row.misconceptionKey).length;
      const t = twoProportionTest(baseK, baseRuns.length, k, n);
      const basePoint = baseRuns.length > 0 ? baseK / baseRuns.length : 0;
      const nowPoint = n > 0 ? k / n : 0;
      comparison = { pValue: t.pValue, significant: t.significant, qValue: null, effect: nowPoint - basePoint };
      pValues.push(t.pValue);
    }

    const providers = row.providers;
    rawDefects.push({
      misconceptionKey: row.misconceptionKey,
      headline: buildDefectHeadline(providers, row.verdict, m, predicateOf(row.misconceptionKey)),
      verdict: row.verdict,
      severity: row.severity,
      exampleStatement: row.exampleStatement,
      adjudicated: row.adjudicated,
      measurement: m,
      measurementText: formatMeasurement(m),
      providers,
      clusterIds,
      clusterLabels: clusterIds.map((cid) => clusterById.get(cid)?.label ?? cid),
      intentFamily: cluster.intent_family as IntentFamily,
      canonicalClaimId: canonical?.id ?? null,
      canonicalClaimText: canonical?.claim_text ?? null,
      priority: priority.score,
      priorityExplanation: priority.explanation,
      suggestedActionType: suggested,
      baselineComparison: comparison,
    });
  }

  // Multiple comparisons: scanning every cluster every day manufactures false alerts unless
  // the false discovery rate is controlled. BH at q=0.10 over this round's comparisons.
  if (pValues.length > 0) {
    const bh = benjaminiHochberg(pValues);
    let i = 0;
    for (const d of rawDefects) {
      if (d.baselineComparison) {
        d.baselineComparison.qValue = bh[i]?.qValue ?? null;
        d.baselineComparison.significant = d.baselineComparison.significant && (bh[i]?.rejected ?? false);
        i++;
      }
    }
  }

  const defects = rawDefects
    .filter((d) => d.severity === 'critical' || d.severity === 'high' || d.measurement.sufficient)
    .sort((a, b) => b.priority - a.priority);

  // ---------------------------------------------------------------- section 2
  const HIGH_INTENT: IntentFamily[] = ['comparison', 'unaided_discovery', 'transactional'];
  const missed: MissedDemandItem[] = [];
  const totalDemandWeight = clusters.reduce((acc, c) => acc + c.demand_weight, 0) || 1;

  for (const c of clusters) {
    if (!HIGH_INTENT.includes(c.intent_family as IntentFamily)) continue;
    const runs = snap.runsByCluster.get(c.id) ?? [];
    if (runs.length === 0) continue;
    let absent = 0;
    const competitors = new Set<string>();
    for (const r of runs) {
      const obs = snap.observedByRun.get(r.id) ?? [];
      const role = obs[0]?.brand_role ?? 'absent';
      if (role === 'absent') absent++;
      if (role === 'compared') competitors.add('competitor named alongside');
    }
    const m = measure(absent, runs.length);
    // Only report absence we can actually defend: the interval's lower bound must clear half.
    if (m.sufficient && (m.ciLow ?? 0) > 0.5) {
      const priority = computePriority({
        demandWeight: c.demand_weight,
        intentFamily: c.intent_family as IntentFamily,
        economicValue: c.economic_value,
        defect: m,
        actionType: c.intent_family === 'comparison' ? 'create_comparison_page' : 'create_evidence_page',
      });
      missed.push({
        clusterId: c.id,
        label: c.label,
        intentFamily: c.intent_family as IntentFamily,
        buyerStage: c.buyer_stage,
        absence: m,
        absenceText: formatMeasurement(m),
        demandWeight: c.demand_weight,
        demandVolume: c.demand_volume,
        economicValue: c.economic_value,
        competitorsPresent: [...competitors],
        priority: priority.score,
      });
    }
  }
  missed.sort((a, b) => b.priority - a.priority);
  const missedDemandShare = missed.reduce((acc, m) => acc + m.demandWeight, 0) / totalDemandWeight;

  // ---------------------------------------------------------------- section 3
  const confirmedWins: ConfirmedWinItem[] = [];
  for (const e of repo.listExperiments(db, tenantId, brandId)) {
    if (e.verdict !== 'confirmed') continue;
    const action = repo.getAction(db, tenantId, e.action_id);
    const analysis = analyzeExperiment(
      {
        baselineK: e.baseline_k ?? 0,
        baselineN: e.baseline_n ?? 0,
        postK: e.post_k ?? 0,
        postN: e.post_n ?? 0,
        controlBaselineK: e.control_baseline_k,
        controlBaselineN: e.control_baseline_n,
        controlPostK: e.control_post_k,
        controlPostN: e.control_post_n,
      },
      Boolean(e.control_baseline_n),
    );
    confirmedWins.push({
      experimentId: e.id,
      actionId: e.action_id,
      actionTitle: action?.title ?? 'Action',
      metric: e.metric,
      baseline: analysis.baseline,
      post: analysis.post,
      probabilityReal: analysis.probabilityReal,
      didEffect: analysis.didEffect,
      narrative: analysis.narrative,
      alternativeExplanations: analysis.alternativeExplanations,
      hasControl: Boolean(e.control_baseline_n),
    });
  }

  // -------------------------------------------------------- per-family summary
  const familySummaries = summariseByFamily(snap, clusters);

  // Registry gaps: things a model asserted that the registry can neither confirm nor deny.
  // Not defects, and not nothing — the registry decays unless someone is asked.
  const gapSet = new Set<string>();
  for (const claims of snap.observedByRun.values()) {
    for (const o of claims) {
      if (o.verdict === 'UNSUPPORTED' && o.predicate !== 'brand_presence') {
        gapSet.add(`${o.subject} / ${o.predicate}`);
      }
    }
  }

  return {
    brand,
    window: current,
    baselineWindow: baseline,
    totalRuns: allRuns.length,
    simulatedRuns,
    defects,
    missedDemand: missed,
    missedDemandShare,
    confirmedWins,
    familySummaries,
    coverage: {
      clusters: clusters.length,
      sampledClusters: new Set(allRuns.map((r) => r.cluster_id)).size,
      surfaces: new Set(allRuns.map((r) => `${r.provider}:${r.surface}:${r.grounding}`)).size,
    },
    windows,
    registryGaps: [...gapSet].sort(),
    windowStatus: (windowRow?.status as 'complete' | 'partial') ?? 'complete',
  };
}

function summariseByFamily(snap: WindowSnapshot, clusters: repo.Row[]) {
  const byFamily = new Map<IntentFamily, repo.Row[]>();
  for (const c of clusters) {
    const f = c.intent_family as IntentFamily;
    byFamily.set(f, [...(byFamily.get(f) ?? []), c]);
  }
  const out: Array<{ family: IntentFamily; label: string; clusters: number; runs: number; defectRate: Measurement }> = [];
  for (const [family, list] of byFamily) {
    // Guard: this is the one place a caller could be tempted to average across families.
    assertNoBlending(list.map((c) => c.intent_family as IntentFamily));
    const runs = runsInClusters(snap, list.map((c) => c.id));
    let defectRuns = 0;
    for (const r of runs) {
      const obs = snap.observedByRun.get(r.id) ?? [];
      if (obs.some((o) => (o.verdict === 'CONTRADICTED' || o.verdict === 'STALE') && ['not_required', 'agreed'].includes(o.adjudication))) defectRuns++;
    }
    out.push({ family, label: FAMILY_LABEL[family], clusters: list.length, runs: runs.length, defectRate: measure(defectRuns, runs.length) });
  }
  return out.sort((a, b) => INTENT_WEIGHT[b.family] - INTENT_WEIGHT[a.family]);
}

/** The misconception key is `subject.predicate.polarity.object`. */
function predicateOf(misconceptionKey: string): string {
  return misconceptionKey.split('.')[1] ?? '';
}

function buildDefectHeadline(providers: string[], verdict: string, m: Measurement, predicate: string): string {
  const who = providers.length === 0 ? 'Sampled surfaces' : joinList(providers.map(titleProvider));
  const subject = predicateLabel(predicate);
  // One provider takes a singular verb. "Perplexity describe incorrectly your token supply" is
  // the sort of sentence that makes a reader stop trusting the number next to it.
  const singular = providers.length === 1;
  const verb = verdict === 'STALE'
    ? (singular ? 'repeats an out-of-date account of' : 'repeat an out-of-date account of')
    : (singular ? 'describes' : 'describe');
  const qualifier = verdict === 'STALE' ? '' : '';
  const rate = m.sufficient && m.point !== null
    ? `${Math.round(m.point * 100)}% of sampled answers (95% CI ${Math.round((m.ciLow ?? 0) * 100)}–${Math.round((m.ciHigh ?? 0) * 100)}%, n=${m.n})`
    : `an unquantified share of answers (n=${m.n} — below the sample floor)`;
  const wrongly = verdict === 'STALE' ? '' : ' incorrectly';
  return `${who} ${verb} ${subject}${wrongly} in ${rate}.`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function titleProvider(p: string): string {
  const map: Record<string, string> = { openai: 'OpenAI', anthropic: 'Claude', google: 'Gemini', perplexity: 'Perplexity', xai: 'Grok' };
  return map[p] ?? p;
}
