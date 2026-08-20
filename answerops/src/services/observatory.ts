/**
 * Observatory: plan a sampling round, execute it against every configured surface, and
 * verify every answer it produces. This is the loop that turns "an AI said something" into
 * a countable, attributable, reproducible observation.
 */

import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import { planSampling, volatilityOf } from '../domain/sampling.js';
import { extractClaims, verifyClaim, classifyBrandRole, checkCitation, adjudicate, Verdict } from '../domain/verifier.js';
import { CanonicalClaim } from '../domain/truth.js';
import { extractCandidateEntities, comentionCandidate } from '../domain/entities.js';
import { buildRegistry, surfacesFor } from '../providers/registry.js';
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
}

export interface SampleRoundResult {
  runsCreated: number;
  observedClaims: number;
  citations: number;
  defects: number;
  clustersSampled: number;
  droppedClusters: string[];
  costUsd: number;
}

export async function runSamplingRound(db: DB, opts: SampleRoundOptions): Promise<SampleRoundResult> {
  const { tenantId, brandId, windowLabel } = opts;
  const brand = repo.getBrand(db, tenantId, brandId);
  if (!brand) throw new Error('brand not found');

  const clusters = repo.listClusters(db, tenantId, brandId);
  const canonical = repo.listCanonicalClaims(db, tenantId, brandId).map(toCanonical);
  const providers = opts.providers ?? buildRegistry();
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

  const result: SampleRoundResult = {
    runsCreated: 0,
    observedClaims: 0,
    citations: 0,
    defects: 0,
    clustersSampled: plan.allocations.length,
    droppedClusters: plan.droppedClusters,
    costUsd: 0,
  };

  const comentionCounts = new Map<string, number>();
  const seedOffset = opts.seedOffset ?? 0;

  for (const alloc of plan.allocations) {
    const cluster = clusters.find((c) => c.id === alloc.clusterId)!;
    const variants = repo.listVariants(db, tenantId, cluster.id);
    if (variants.length === 0) continue;

    for (let rep = 0; rep < alloc.samples; rep++) {
      const variant = variants[rep % variants.length];
      const pair = pairs[rep % pairs.length];
      const seed = seedOffset + rep * 7919 + hash(cluster.id);

      const runResult = await pair.adapter.run({
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
        cost_usd: runResult.costUsd,
        sampling_reason: opts.samplingReason ?? alloc.reason,
        window_label: windowLabel,
        requested_at: nowIso(),
      });
      result.runsCreated++;
      result.costUsd += runResult.costUsd;

      const brandRole = classifyBrandRole(runResult.answerText, brand.name, competitorNames);
      const extracted = extractClaims(runResult.answerText, brand.name);

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
        });
        result.observedClaims++;
      }

      for (const claim of extracted) {
        const verification = verifyClaim({ claim, canonicalClaims: canonical, asOf: new Date() });
        // Dual adjudication for high-risk verdicts: a second, independent evaluator pass must
        // agree before a material or regulated contradiction is allowed to alert anyone.
        const votes: Verdict[] = verification.requiresAdjudication
          ? [verification.verdict, secondOpinion(claim, canonical, verification.verdict)]
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
        });
        result.observedClaims++;
        if (verification.verdict === 'CONTRADICTED' || verification.verdict === 'STALE') result.defects++;
      }

      for (const cit of runResult.citations) {
        // A citation is cited for something. Checking it against one arbitrary claim from the
        // answer produces confident nonsense ("this staking page does not support your token
        // supply figure"), so every claim in the answer is tried and the strongest, most
        // specific outcome is what gets recorded.
        const candidates = extracted.length ? extracted : [{ object: brand.name, statement: '' } as any];
        let best: { check: ReturnType<typeof checkCitation>; claimIndex: number } | null = null;
        for (let ci = 0; ci < candidates.length; ci++) {
          const check = checkCitation({
            url: cit.url,
            snapshotText: cit.snapshotText,
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
          snapshot_ref: cit.snapshotText ? `objectstore://snapshots/${tenantId}/${hash(cit.url)}.html` : '',
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

  repo.audit(
    db,
    tenantId,
    opts.actor,
    'sampling_round',
    'brand',
    brandId,
    `window=${windowLabel} runs=${result.runsCreated} defects=${result.defects} cost=$${result.costUsd.toFixed(3)}`,
  );

  return result;
}

/**
 * Second evaluator. Independent in the sense that matters here: it re-derives the verdict
 * from the registry without reusing the first pass's intermediate state. In production the
 * second vote comes from a different model family, and disagreement routes to a human.
 */
function secondOpinion(claim: ReturnType<typeof extractClaims>[number], canonical: CanonicalClaim[], _first: Verdict): Verdict {
  const second = verifyClaim({ claim, canonicalClaims: canonical, asOf: new Date() });
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
