/**
 * Observatory: plan a sampling round, execute it against every configured surface, verify
 * every answer it produces, and fetch the pages it cited.
 *
 * Three things changed in Phase 1 and 2. A round now belongs to a window whose completeness is
 * recorded, so a day that lost a provider cannot silently become an experiment baseline. A
 * round now costs a known or explicitly unknown amount, and is trimmed to a budget before it
 * spends. And every cited page is actually fetched, which is what turns "unreachable" back
 * into a finding.
 */

import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import * as sched from '../db/repo/unattended.js';
import * as snaps from '../db/repo/snapshots.js';
import { planSampling, volatilityOf } from '../domain/sampling.js';
import { extractClaims, verifyClaim, classifyBrandRole, checkCitation, adjudicate, Verdict } from '../domain/verifier.js';
import { CanonicalClaim } from '../domain/truth.js';
import { extractCandidateEntities, comentionCandidate } from '../domain/entities.js';
import { buildRegistry, surfacesFor } from '../providers/registry.js';
import { CircuitOpenError } from '../providers/resilience.js';
import { trimToBudget, remainingBudget } from '../domain/budget.js';
import { estimatedRunCost } from '../domain/pricing.js';
import { monthKey } from '../domain/scheduler.js';
import { systemClock, type Clock } from '../domain/clock.js';
import { textOf, sha256Of, type Fetcher, type FetchOutcome } from '../domain/fetcher.js';
import { proposeClaims, EXTRACTOR_VERSION } from '../domain/extractor.js';
import type { BeliefProfile, ProviderAdapter } from '../providers/types.js';

export interface SampleRoundOptions {
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

export async function runSamplingRound(db: DB, opts: SampleRoundOptions): Promise<SampleRoundResult> {
  const { tenantId, brandId, windowLabel } = opts;
  const clock = opts.clock ?? systemClock;
  const startedAt = clock.now().toISOString();
  const brand = repo.getBrand(db, tenantId, brandId);
  if (!brand) throw new Error('brand not found');

  const clusters = repo.listClusters(db, tenantId, brandId);
  const canonical = repo.listCanonicalClaims(db, tenantId, brandId).map(toCanonical);
  const allProviders = opts.providers ?? buildRegistry();
  const providers = opts.surfaceKeys?.length
    ? allProviders.filter((p) => opts.surfaceKeys!.includes(p.key))
    : allProviders;
  const pairs = surfacesFor(providers);
  const relationships = repo.listRelationships(db, tenantId, brandId);
  const competitorNames = relationships.filter((r) => r.relation === 'competitor').map((r) => r.entity_name as string);
  const competitorDomains = relationships
    .filter((r) => r.relation === 'competitor' && r.entity_domain)
    .map((r) => r.entity_domain as string);

  const candidates = clusters.map((c) => {
    const priorRuns = repo.runsForCluster(db, tenantId, c.id);
    const indicators = priorRuns.map((r) => {
      const obs = repo.observedForRun(db, tenantId, r.id);
      return obs.some((o) => o.verdict === 'CONTRADICTED' || o.verdict === 'STALE');
    });
    return {
      clusterId: c.id,
      demandWeight: c.demand_weight,
      economicValue: c.economic_value,
      volatility: indicators.length ? volatilityOf(indicators) : c.volatility,
      defectRisk: indicators.length ? indicators.filter(Boolean).length / indicators.length : 0.3,
      observedRate: indicators.length ? indicators.filter(Boolean).length / indicators.length : undefined,
    };
  });

  const budget = opts.budget ?? Math.max(clusters.length * 6, 30);
  const plan = planSampling(candidates, budget);

  // Money, before it is spent. A round that would blow the monthly ceiling drops whole
  // clusters rather than thinning every one of them below the point where a rate is showable.
  let allocations = plan.allocations;
  let droppedForBudget: string[] = [];
  let budgetExhausted = false;
  if (opts.monthlyBudgetUsd !== undefined) {
    const spend = sched.monthToDateSpend(db, tenantId, monthKey(clock.now()));
    const remaining = remainingBudget({
      monthlyBudgetUsd: opts.monthlyBudgetUsd,
      monthToDateUsd: spend.usd,
      unpricedRuns: spend.unpricedRuns,
    });
    const perRun = meanRunCost(pairs.map((p) => p.surface.modelId));
    const trimmed = trimToBudget({ ...plan, allocations }, perRun, remaining);
    allocations = trimmed.allocations;
    droppedForBudget = trimmed.droppedForBudget;
    budgetExhausted = trimmed.exhausted;
  }

  const plannedRuns = allocations.reduce((acc, a) => acc + a.samples, 0);
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
    plannedRuns,
    gaps: [],
    windowStatus: 'complete',
    snapshotsFetched: 0,
  };

  const comentionCounts = new Map<string, number>();
  const seedOffset = opts.seedOffset ?? 0;
  const openCircuits = new Set<string>();
  /**
   * Surfaces rotate across the whole round, not within each cluster.
   *
   * They used to be picked as `pairs[rep % pairs.length]`, which meant that whenever there
   * were more surfaces than samples per cluster - four grounded providers with five surfaces
   * each against a five-run floor - the same first few surfaces were sampled every time and
   * the rest were never measured at all. The coverage number on the dashboard counted them,
   * because it counts distinct surfaces seen, and they were never seen. A round-robin over the
   * round fixes the coverage and keeps allocation deterministic.
   */
  let surfaceCursor = 0;

  for (const alloc of allocations) {
    const cluster = clusters.find((c) => c.id === alloc.clusterId)!;
    const variants = repo.listVariants(db, tenantId, cluster.id);
    if (variants.length === 0) continue;

    for (let rep = 0; rep < alloc.samples; rep++) {
      const variant = variants[rep % variants.length];
      const pair = pairs[surfaceCursor % pairs.length];
      surfaceCursor++;
      if (!pair) continue;
      const seed = seedOffset + rep * 7919 + hash(cluster.id);

      let runResult;
      try {
        runResult = await pair.adapter.run({
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
      } catch (err) {
        // A surface that fails is a gap in the window, not a smaller number. The round keeps
        // going on the surfaces that still answer, and the window records what it lost.
        const reason =
          err instanceof CircuitOpenError ? 'circuit_open' : err instanceof Error ? err.message.slice(0, 120) : 'unknown';
        if (err instanceof CircuitOpenError) openCircuits.add(pair.adapter.key);
        result.gaps.push({
          provider: pair.surface.provider,
          surface: pair.surface.label,
          clusterId: cluster.id,
          reason,
        });
        continue;
      }

      const costKnown = runResult.costUsd !== null;
      if (!costKnown) result.unpricedRuns++;
      else result.costUsd += runResult.costUsd!;

      const run = repo.insertRun(db, tenantId, {
        brand_id: brandId,
        cluster_id: cluster.id,
        variant_id: variant.id,
        provider: pair.surface.provider,
        model_id: pair.surface.modelId,
        model_version: runResult.modelVersion,
        surface: pair.surface.surface,
        grounding: pair.surface.grounding,
        search_mode: pair.surface.searchMode,
        geo: variant.geo,
        language: variant.language,
        personalization: 'logged_out',
        system_config_hash: runResult.systemConfigHash,
        temperature: 0.7,
        seed,
        simulated: runResult.simulated ? 1 : 0,
        answer_text: runResult.answerText,
        raw_response_ref: `objectstore://runs/${tenantId}/${windowLabel}/${cluster.id}/${seed}.json`,
        search_queries: JSON.stringify(runResult.searchQueries),
        latency_ms: runResult.latencyMs,
        cost_usd: runResult.costUsd ?? 0,
        cost_known: costKnown ? 1 : 0,
        sampling_reason: opts.samplingReason ?? alloc.reason,
        window_label: windowLabel,
        requested_at: clock.now().toISOString(),
      });
      result.runsCreated++;

      const brandRole = classifyBrandRole(runResult.answerText, brand.name, competitorNames);
      const proposed = proposeClaims(runResult.answerText, brand.name);
      const extracted = proposed.map((p) => p.claim);

      // Answers with no extractable claim still carry the brand-role observation: absence
      // from a high-intent question is itself the finding in section 2 of the dashboard.
      if (extracted.length === 0) {
        repo.insertObservedClaim(db, tenantId, {
          run_id: run.id,
          statement: truncate(runResult.answerText, 400),
          subject: brand.name,
          predicate: 'brand_presence',
          object: brandRole,
          polarity: 'affirm',
          temporal_marker: null,
          brand_role: brandRole,
          verdict: 'NOT_APPLICABLE',
          canonical_claim_id: null,
          severity: 'low',
          misconception_key: null,
          adjudication: 'not_required',
          evaluator_votes: '[]',
          extractor_stage: 'pattern',
          extractor_version: EXTRACTOR_VERSION,
        });
        result.observedClaims++;
      }

      for (let i = 0; i < extracted.length; i++) {
        const claim = extracted[i];
        const verification = verifyClaim({ claim, canonicalClaims: canonical, asOf: clock.now() });
        // Dual adjudication for high-risk verdicts: a second, independent evaluator pass must
        // agree before a material or regulated contradiction is allowed to alert anyone.
        const votes: Verdict[] = verification.requiresAdjudication
          ? [verification.verdict, secondOpinion(claim, canonical, clock.now())]
          : [];
        const adjudication = verification.requiresAdjudication ? adjudicate(votes) : 'not_required';

        repo.insertObservedClaim(db, tenantId, {
          run_id: run.id,
          statement: claim.statement,
          subject: claim.subject,
          predicate: claim.predicate,
          object: claim.object,
          polarity: claim.polarity,
          temporal_marker: claim.temporalMarker,
          brand_role: brandRole,
          verdict: verification.verdict,
          canonical_claim_id: verification.canonicalClaimId,
          severity: verification.severity,
          misconception_key: verification.misconceptionKey,
          adjudication,
          evaluator_votes: JSON.stringify(votes),
          extractor_stage: proposed[i].stage,
          extractor_version: EXTRACTOR_VERSION,
        });
        result.observedClaims++;
        if (verification.verdict === 'CONTRADICTED' || verification.verdict === 'STALE') result.defects++;
      }

      for (const cit of runResult.citations) {
        // The provider may hand us a snapshot (the stand-in upstream does). If it did not, we
        // fetch the page ourselves, which is the difference between a citation check that
        // works in a demo and one that works against a live model.
        let snapshotText = cit.snapshotText;
        let outcome: FetchOutcome | null = null;
        let providerSnapshotSha: string | null = null;
        if (snapshotText !== null) {
          // A provider that hands back the page it read still gets its snapshot stored, keyed
          // by content hash like any other. The drill-down should not have two classes of
          // evidence, one of which cannot be opened.
          providerSnapshotSha = sha256Of(snapshotText);
          snaps.putSnapshot(db, {
            sha256: providerSnapshotSha,
            url: cit.url,
            body: snapshotText,
            bytes: snapshotText.length,
            contentType: 'text/plain',
            truncated: false,
            httpStatus: 200,
            fetchedAt: clock.now().toISOString(),
          });
        }
        if (snapshotText === null && opts.fetcher) {
          outcome = await opts.fetcher.fetch(cit.url);
          if (outcome.ok && outcome.body !== null && outcome.sha256) {
            snaps.putSnapshot(db, {
              sha256: outcome.sha256,
              url: cit.url,
              body: outcome.body,
              bytes: outcome.bytes,
              contentType: outcome.contentType,
              truncated: outcome.truncated,
              httpStatus: outcome.status,
              fetchedAt: outcome.fetchedAt,
            });
            snapshotText = textOf(outcome.body);
            result.snapshotsFetched++;
          }
        }

        // A citation is cited for something. Checking it against one arbitrary claim from the
        // answer produces confident nonsense ("this staking page does not support your token
        // supply figure"), so every claim in the answer is tried and the strongest, most
        // specific outcome is what gets recorded.
        const candidates = extracted.length ? extracted : [{ object: brand.name, statement: '' } as any];
        let best: { check: ReturnType<typeof checkCitation>; claimIndex: number } | null = null;
        for (let ci = 0; ci < candidates.length; ci++) {
          const check = checkCitation({
            url: cit.url,
            snapshotText,
            claimObject: candidates[ci].object,
            claimSubject: brand.name,
            ownedDomains: [brand.domain],
            competitorDomains,
          });
          if (!best || supportRank(check.support) > supportRank(best.check.support)) {
            best = { check, claimIndex: ci };
          }
        }
        repo.insertCitation(db, tenantId, {
          run_id: run.id,
          url: cit.url,
          title: cit.title,
          source_class: best!.check.sourceClass,
          support: best!.check.support,
          supported_claim_id: null,
          snapshot_ref: outcome?.sha256 ?? providerSnapshotSha ? `snapshot://${outcome?.sha256 ?? providerSnapshotSha}` : '',
          snapshot_sha256: outcome?.sha256 ?? providerSnapshotSha,
          snapshot_fetched_at: outcome?.fetchedAt ?? (providerSnapshotSha ? clock.now().toISOString() : null),
          http_status: outcome?.status ?? null,
          fetch_error: outcome?.error ?? null,
          checked_claim: candidates[best!.claimIndex]?.object ?? '',
          reason: outcome && !outcome.ok ? `${best!.check.reason} (${outcome.error})` : best!.check.reason,
        });
        result.citations++;
      }

      for (const name of extractCandidateEntities(runResult.answerText, brand.name)) {
        comentionCounts.set(name, (comentionCounts.get(name) ?? 0) + 1);
      }
    }
  }

  // Co-mentions become candidates awaiting human classification — never competitor edges.
  for (const [name, count] of comentionCounts) {
    if (count < 2) continue;
    const entity = repo.upsertEntity(db, tenantId, name);
    const existing = repo.listRelationships(db, tenantId, brandId).find((r) => r.entity_id === entity.id);
    if (existing && existing.basis !== 'observed_comention') continue;
    const cand = comentionCandidate(name, count);
    repo.upsertRelationship(db, tenantId, brandId, entity.id, cand.relation, cand.basis, cand.confidence, cand.note);
  }

  result.costKnown = result.unpricedRuns === 0;
  result.windowStatus =
    result.gaps.length > 0 || openCircuits.size > 0 || result.runsCreated < plannedRuns ? 'partial' : 'complete';

  sched.upsertWindow(db, tenantId, brandId, windowLabel, {
    status: result.windowStatus,
    started_at: startedAt,
    finished_at: clock.now().toISOString(),
    planned_runs: plannedRuns,
    actual_runs: result.runsCreated,
    cost_usd: result.costUsd,
    cost_known: result.costKnown ? 1 : 0,
    gaps: JSON.stringify(result.gaps),
    dropped: JSON.stringify([...result.droppedClusters, ...result.droppedForBudget]),
  });

  if (budgetExhausted) {
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
  }

  repo.audit(
    db,
    tenantId,
    opts.actor,
    'sampling_round',
    'brand',
    brandId,
    `window=${windowLabel} runs=${result.runsCreated}/${plannedRuns} defects=${result.defects} ` +
      `cost=${result.costKnown ? `$${result.costUsd.toFixed(3)}` : 'partly unpriced'} status=${result.windowStatus}`,
  );

  return result;
}

/** Mean expected cost of one run across the surfaces in play, used to project before spending. */
export function meanRunCost(modelIds: string[]): number {
  if (modelIds.length === 0) return 0;
  return modelIds.reduce((acc, m) => acc + estimatedRunCost(m), 0) / modelIds.length;
}

/**
 * Second evaluator. Independent in the sense that matters here: it re-derives the verdict
 * from the registry without reusing the first pass's intermediate state. In production the
 * second vote comes from a different model family, and disagreement routes to a human.
 */
function secondOpinion(claim: ReturnType<typeof extractClaims>[number], canonical: CanonicalClaim[], asOf: Date): Verdict {
  const second = verifyClaim({ claim, canonicalClaims: canonical, asOf });
  return second.verdict;
}

/**
 * Ordering of citation outcomes by how much they tell us. "supports" and "contradicts" are
 * findings; "absent" only means we did not match it to this particular claim; unreachable and
 * paywalled are facts about the page, not about the claim.
 */
function supportRank(support: string): number {
  switch (support) {
    case 'supports': return 4;
    case 'contradicts': return 3;
    case 'paywalled': return 2;
    case 'unreachable': return 1;
    default: return 0;
  }
}

function toCanonical(row: repo.Row): CanonicalClaim {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    brandId: row.brand_id,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    claimText: row.claim_text,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    supersededById: row.superseded_by_id,
    sourceId: row.source_id,
    sensitivity: row.sensitivity,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
  };
}

export { toCanonical };

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
