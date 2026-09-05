import type { DB } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import * as sched from '../db/repo/unattended.js';
import { planSampling, volatilityOf } from '../domain/sampling.js';
import type { CanonicalClaim } from '../domain/truth.js';
import { extractCandidateEntities, comentionCandidate } from '../domain/entities.js';
import { buildRegistry, surfacesFor } from '../providers/registry.js';
import { CircuitOpenError } from '../providers/resilience.js';
import { trimToBudget, remainingBudget } from '../domain/budget.js';
import { estimatedRunCost } from '../domain/pricing.js';
import { monthKey } from '../domain/scheduler.js';
import { systemClock, type Clock } from '../domain/clock.js';
import type { Fetcher } from '../domain/fetcher.js';
import type { BeliefProfile, ProviderAdapter } from '../providers/types.js';
import { prepareEvidence, persistAnswer } from './answerEvidence.js';
export interface SampleRoundOptions {
  plannedQuestions?: Array<{
    clusterId: string;
    variantId: string;
    prompt: string;
    geo: string;
    language: string;
  }>;
  liveOnly?: boolean;
  tenantId: string;
  brandId: string;
  windowLabel: string;
  budget?: number;
  samplingReason?: string;
  actor: string;
  beliefs?: BeliefProfile | null;
  providers?: ProviderAdapter[];
  /** deterministic offset so baseline and post windows differ reproducibly */
  seedOffset?: number;
  clock?: Clock;
  /** null disables citation fetching for this round */
  fetcher?: Fetcher | null;
  /** monthly spend ceiling; when set, the round is trimmed before it spends */
  monthlyBudgetUsd?: number;
  /** restrict to these provider keys; empty or absent means every available surface */
  surfaceKeys?: string[];
}

export interface SampleGap {
  provider: string;
  surface: string;
  clusterId: string;
  reason: string;
}

export interface SampleRoundResult {
  runsCreated: number;
  observedClaims: number;
  citations: number;
  defects: number;
  clustersSampled: number;
  droppedClusters: string[];
  droppedForBudget: string[];
  costUsd: number;
  costKnown: boolean;
  unpricedRuns: number;
  plannedRuns: number;
  gaps: SampleGap[];
  windowStatus: 'complete' | 'partial';
  snapshotsFetched: number;
}

/** A round plans first, performs network calls serially, and commits each answer with its evidence. */
export async function runSamplingRound(db: DB, opts: SampleRoundOptions): Promise<SampleRoundResult> {
  const { tenantId, brandId, windowLabel } = opts;
  const clock = opts.clock ?? systemClock;
  const startedAt = clock.now().toISOString();
  const brand = repo.getBrand(db, tenantId, brandId);
  if (!brand) throw new Error('brand not found');
  const clusters = repo.listClusters(db, tenantId, brandId);
  const clusterById = new Map(clusters.map((c) => [c.id, c]));
  const canonical = repo.listCanonicalClaims(db, tenantId, brandId).map(toCanonical);
  const relationships = repo.listRelationships(db, tenantId, brandId);
  const competitors = relationships.filter((r) => r.relation === 'competitor');
  const providers = (opts.providers ?? buildRegistry()).filter(
    (p) => !opts.surfaceKeys?.length || opts.surfaceKeys.includes(p.key),
  );
  const pairs = surfacesFor(providers);
  const history = samplingHistory(db, tenantId, brandId);
  const plan = planSampling(
    clusters.map((cluster) => {
      const outcomes = history.get(cluster.id) ?? [];
      const rate = outcomes.filter(Boolean).length / outcomes.length;
      return {
        clusterId: cluster.id,
        demandWeight: cluster.demand_weight,
        economicValue: cluster.economic_value,
        volatility: outcomes.length ? volatilityOf(outcomes) : cluster.volatility,
        defectRisk: outcomes.length ? rate : 0.3,
        observedRate: outcomes.length ? rate : undefined,
      };
    }),
    opts.budget ?? Math.max(clusters.length * 6, 30),
  );
  let allocations = opts.plannedQuestions
    ? opts.plannedQuestions
        .filter((q) => clusterById.has(q.clusterId))
        .slice(0, Math.floor((opts.budget ?? 50) / 5))
        .map((q) => ({
          clusterId: q.clusterId,
          samples: 5,
          reason: 'floor' as const,
          score: 1,
          poweredFor: 1,
        }))
    : plan.allocations;
  let droppedForBudget: string[] = [];
  let exhausted = false;
  if (opts.monthlyBudgetUsd !== undefined) {
    const spend = sched.monthToDateSpend(db, tenantId, monthKey(clock.now()));
    const available = remainingBudget({
      monthlyBudgetUsd: opts.monthlyBudgetUsd,
      monthToDateUsd: spend.usd,
      unpricedRuns: spend.unpricedRuns,
    });
    const trimmed = trimToBudget(
      { ...plan, allocations },
      meanRunCost(pairs.map((p) => p.surface.modelId)),
      available,
    );
    allocations = trimmed.allocations;
    droppedForBudget = trimmed.droppedForBudget;
    exhausted = trimmed.exhausted;
  }
  const result: SampleRoundResult = {
    runsCreated: 0,
    observedClaims: 0,
    citations: 0,
    defects: 0,
    clustersSampled: allocations.length,
    droppedClusters: plan.droppedClusters,
    droppedForBudget,
    costUsd: 0,
    costKnown: true,
    unpricedRuns: 0,
    plannedRuns: allocations.reduce((sum, allocation) => sum + allocation.samples, 0),
    gaps: [],
    windowStatus: 'complete',
    snapshotsFetched: 0,
  };
  const mentions = new Map<string, number>();
  let cursor = 0;
  for (const allocation of allocations) {
    const cluster = clusterById.get(allocation.clusterId)!;
    const variants = repo.listVariants(db, tenantId, cluster.id);
    if (!variants.length) continue;
    for (let repetition = 0; repetition < allocation.samples; repetition++) {
      const frozen = opts.plannedQuestions?.find((q) => q.clusterId === cluster.id);
      const variant = frozen
        ? {
            ...variants[0],
            id: frozen.variantId,
            prompt: frozen.prompt,
            geo: frozen.geo,
            language: frozen.language,
          }
        : variants[repetition % variants.length];
      const pair = pairs[cursor++ % pairs.length];
      if (!pair) continue;
      const seed = (opts.seedOffset ?? 0) + repetition * 7919 + hash(cluster.id);
      let answer;
      try {
        answer = await pair.adapter.run({
          prompt: variant.prompt,
          brandName: brand.name,
          brandDomain: brand.domain,
          geo: variant.geo,
          language: variant.language,
          personalization: 'logged_out',
          intentFamily: cluster.intent_family,
          temperature: 0.7,
          seed,
          beliefs: opts.beliefs ?? undefined,
          surface: pair.surface,
        });
      } catch (error) {
        result.gaps.push({
          provider: pair.surface.provider,
          surface: pair.surface.label,
          clusterId: cluster.id,
          reason:
            error instanceof CircuitOpenError
              ? 'circuit_open'
              : error instanceof Error
                ? error.message.slice(0, 120)
                : 'unknown',
        });
        continue;
      }
      if (opts.liveOnly && answer.simulated) {
        result.gaps.push({
          provider: pair.surface.provider,
          surface: pair.surface.label,
          clusterId: cluster.id,
          reason: 'Simulated answer excluded from live monitoring',
        });
        continue;
      }
      const evidence = await prepareEvidence(answer, {
        brand,
        canonical,
        clock,
        fetcher: opts.fetcher,
        competitors: competitors.map((c) => c.entity_name),
        competitorDomains: competitors.filter((c) => c.entity_domain).map((c) => c.entity_domain),
      });
      persistAnswer(
        db,
        tenantId,
        {
          brand_id: brandId,
          cluster_id: cluster.id,
          variant_id: variant.id,
          provider: pair.surface.provider,
          model_id: pair.surface.modelId,
          model_version: answer.modelVersion,
          surface: pair.surface.surface,
          grounding: pair.surface.grounding,
          search_mode: pair.surface.searchMode,
          geo: variant.geo,
          language: variant.language,
          personalization: 'logged_out',
          system_config_hash: answer.systemConfigHash,
          temperature: 0.7,
          seed,
          simulated: answer.simulated ? 1 : 0,
          answer_text: answer.answerText,
          raw_response_ref: `objectstore://runs/${tenantId}/${windowLabel}/${cluster.id}/${seed}.json`,
          search_queries: JSON.stringify(answer.searchQueries),
          latency_ms: answer.latencyMs,
          cost_usd: answer.costUsd ?? 0,
          cost_known: answer.costUsd === null ? 0 : 1,
          sampling_reason: opts.samplingReason ?? allocation.reason,
          window_label: windowLabel,
          requested_at: clock.now().toISOString(),
        },
        evidence,
      );
      result.runsCreated++;
      result.observedClaims += evidence.observations.length;
      result.citations += evidence.citations.length;
      result.snapshotsFetched += evidence.fetched;
      result.defects += evidence.observations.filter((o) =>
        ['CONTRADICTED', 'STALE'].includes(o.verdict),
      ).length;
      if (answer.costUsd === null) result.unpricedRuns++;
      else result.costUsd += answer.costUsd;
      for (const name of extractCandidateEntities(answer.answerText, brand.name))
        mentions.set(name, (mentions.get(name) ?? 0) + 1);
    }
  }
  // Provider calls yield to human edits; refresh classifications before writing observations.
  const existingRelationships = new Map(
    repo.listRelationships(db, tenantId, brandId).map((r) => [r.entity_id, r]),
  );
  for (const [name, count] of mentions) {
    if (count < 2) continue;
    const entity = repo.upsertEntity(db, tenantId, name);
    const existing = existingRelationships.get(entity.id);
    if (existing && existing.basis !== 'observed_comention') continue;
    const candidate = comentionCandidate(name, count);
    repo.upsertRelationship(
      db,
      tenantId,
      brandId,
      entity.id,
      candidate.relation,
      candidate.basis,
      candidate.confidence,
      candidate.note,
    );
  }
  result.costKnown = result.unpricedRuns === 0;
  result.windowStatus =
    result.gaps.length || result.runsCreated < result.plannedRuns ? 'partial' : 'complete';
  db.transaction(() => {
    sched.upsertWindow(db, tenantId, brandId, windowLabel, {
      status: result.windowStatus,
      started_at: startedAt,
      finished_at: clock.now().toISOString(),
      planned_runs: result.plannedRuns,
      actual_runs: result.runsCreated,
      cost_usd: result.costUsd,
      cost_known: result.costKnown ? 1 : 0,
      gaps: JSON.stringify(result.gaps),
      dropped: JSON.stringify([...result.droppedClusters, ...result.droppedForBudget]),
    });
    if (exhausted)
      sched.insertAlertOnce(db, tenantId, {
        brand_id: brandId,
        kind: 'budget_exhausted',
        severity: 'medium',
        window_label: windowLabel,
        subject_key: monthKey(clock.now()),
        headline: `Monthly sampling budget reached; ${droppedForBudget.length} clusters were not sampled in ${windowLabel}.`,
        detail:
          `The round was trimmed to fit the remaining budget. Clusters dropped: ${droppedForBudget.length}. ` +
          'No surviving cluster was sampled below the minimum, because a number under the floor is suppressed anyway.',
        link: '/observatory',
      });
    repo.audit(
      db,
      tenantId,
      opts.actor,
      'sampling_round',
      'brand',
      brandId,
      `window=${windowLabel} runs=${result.runsCreated}/${result.plannedRuns} defects=${result.defects} ` +
        `cost=${result.costKnown ? `$${result.costUsd.toFixed(3)}` : 'partly unpriced'} status=${result.windowStatus}`,
    );
  })();
  return result;
}

/** A single correlated query replaces one history query per run. */
function samplingHistory(db: DB, tenantId: string, brandId: string): Map<string, boolean[]> {
  const rows = db
    .prepare(
      `SELECT r.cluster_id, EXISTS (SELECT 1 FROM observed_claims o
    WHERE o.tenant_id = r.tenant_id AND o.run_id = r.id AND o.verdict IN ('CONTRADICTED', 'STALE')) AS defect
    FROM model_runs r WHERE r.tenant_id = ? AND r.brand_id = ? ORDER BY r.requested_at ASC`,
    )
    .all(tenantId, brandId) as repo.Row[];
  const grouped = new Map<string, boolean[]>();
  for (const row of rows) {
    let values = grouped.get(row.cluster_id);
    if (!values) grouped.set(row.cluster_id, (values = []));
    values.push(Boolean(row.defect));
  }
  return grouped;
}

export function meanRunCost(modelIds: string[]): number {
  return modelIds.length
    ? modelIds.reduce((sum, model) => sum + estimatedRunCost(model), 0) / modelIds.length
    : 0;
}

function hash(value: string): number {
  return Math.abs(
    [...value].reduce((sum, character) => (Math.imul(sum, 31) + character.charCodeAt(0)) | 0, 0),
  );
}
function toCanonical(row: repo.Row): CanonicalClaim {
  const {
    id,
    tenant_id: tenantId,
    brand_id: brandId,
    subject,
    predicate,
    object,
    claim_text: claimText,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    superseded_by_id: supersededById,
    source_id: sourceId,
    sensitivity,
    approved_by: approvedBy,
    approved_at: approvedAt,
  } = row;
  return {
    id,
    tenantId,
    brandId,
    subject,
    predicate,
    object,
    claimText,
    effectiveFrom,
    effectiveTo,
    supersededById,
    sourceId,
    sensitivity,
    approvedBy,
    approvedAt,
  };
}

export { toCanonical };
