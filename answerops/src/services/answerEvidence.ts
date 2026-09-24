import type { DB } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import * as snapshots from '../db/repo/snapshots.js';
import type { RunResult } from '../providers/types.js';
import type { CanonicalClaim } from '../domain/truth.js';
import type { Clock } from '../domain/clock.js';
import { textOf, sha256Of, type Fetcher } from '../domain/fetcher.js';
import { proposeClaims, EXTRACTOR_VERSION } from '../domain/extractor.js';
import { classifyBrandRole, checkCitation } from '../domain/verifier.js';
import { buildJevPlan, checkClaims, interpretJev, type ModelCheck, type JevUsage } from '../domain/jev.js';
import { jevCheckerFromEnv, type JevChecker } from '../providers/typesafe.js';

interface Context {
  brand: repo.Row;
  canonical: CanonicalClaim[];
  competitors: string[];
  competitorDomains: string[];
  clock: Clock;
  fetcher?: Fetcher | null;
  /** the model check: omitted means whatever the environment configures, null means rules only */
  jev?: JevChecker | null;
}

/** What the model check did for one answer: its cost, and what it read for each registry fact. */
export interface ModelCheckRecord {
  model: string;
  usage: JevUsage;
  findings: Array<{ fact: string; choice: string; outcome: string; confidence: number }>;
}

/** Network work finishes before the short evidence transaction begins. */
export async function prepareEvidence(answer: RunResult, context: Context) {
  const { brand, clock } = context;
  const asOf = clock.now();
  const role = classifyBrandRole(answer.answerText, brand.name, context.competitors);
  const proposals = proposeClaims(answer.answerText, brand.name);
  const { modelCheck, record } = await runModelCheck(answer, context, asOf);
  const checked = checkClaims({
    proposals,
    canonical: context.canonical,
    asOf,
    brand: brand.name,
    answer: answer.answerText,
    modelCheck,
  });
  const observations: repo.Row[] = checked.map(({ claim, stage, decision }) => ({
    statement: claim.statement,
    subject: claim.subject,
    predicate: claim.predicate,
    object: claim.object,
    polarity: claim.polarity,
    temporal_marker: claim.temporalMarker,
    brand_role: role,
    verdict: decision.result.verdict,
    canonical_claim_id: decision.result.canonicalClaimId,
    severity: decision.result.severity,
    misconception_key: decision.result.misconceptionKey,
    adjudication: decision.adjudication,
    evaluator_votes: JSON.stringify(decision.votes),
    extractor_stage: stage,
    extractor_version: EXTRACTOR_VERSION,
  }));
  if (!observations.length)
    observations.push({
      statement: answer.answerText.length <= 400 ? answer.answerText : `${answer.answerText.slice(0, 399)}…`,
      subject: brand.name,
      predicate: 'brand_presence',
      object: role,
      polarity: 'affirm',
      temporal_marker: null,
      brand_role: role,
      verdict: 'NOT_APPLICABLE',
      canonical_claim_id: null,
      severity: 'low',
      misconception_key: null,
      adjudication: 'not_required',
      evaluator_votes: '[]',
      extractor_stage: 'pattern',
      extractor_version: EXTRACTOR_VERSION,
    });
  const pages: Parameters<typeof snapshots.putSnapshot>[1][] = [];
  const citations: repo.Row[] = [];
  let fetched = 0;
  for (const citation of answer.citations) {
    let text = citation.snapshotText;
    let hash: string | null = null;
    let fetchedAt: string | null = null;
    let status: number | null = null;
    let error: string | null = null;
    if (text !== null) {
      hash = sha256Of(text);
      fetchedAt = clock.now().toISOString();
      pages.push({
        sha256: hash,
        url: citation.url,
        body: text,
        bytes: text.length,
        contentType: 'text/plain',
        truncated: false,
        httpStatus: 200,
        fetchedAt,
      });
    } else if (context.fetcher) {
      const outcome = await context.fetcher.fetch(citation.url);
      hash = outcome.sha256;
      fetchedAt = outcome.fetchedAt;
      status = outcome.status;
      error = outcome.error;
      if (outcome.ok && outcome.body !== null && outcome.sha256) {
        pages.push({
          sha256: outcome.sha256,
          url: citation.url,
          body: outcome.body,
          bytes: outcome.bytes,
          contentType: outcome.contentType,
          truncated: outcome.truncated,
          httpStatus: outcome.status,
          fetchedAt: outcome.fetchedAt,
        });
        text = textOf(outcome.body);
        fetched++;
      }
    }
    const objects = proposals.length ? proposals.map((p) => p.claim.object) : [brand.name];
    const checked = objects.map((object) => ({
      object,
      result: checkCitation({
        url: citation.url,
        snapshotText: text,
        claimObject: object,
        claimSubject: brand.name,
        ownedDomains: [brand.domain],
        competitorDomains: context.competitorDomains,
      }),
    }));
    const rank: Record<string, number> = { supports: 4, contradicts: 3, paywalled: 2, unreachable: 1 };
    const best = checked.reduce((best, next) =>
      (rank[next.result.support] ?? 0) > (rank[best.result.support] ?? 0) ? next : best,
    );
    citations.push({
      url: citation.url,
      title: citation.title,
      source_class: best.result.sourceClass,
      support: best.result.support,
      supported_claim_id: null,
      snapshot_ref: hash ? `snapshot://${hash}` : '',
      snapshot_sha256: hash,
      snapshot_fetched_at: fetchedAt,
      http_status: status,
      fetch_error: error,
      checked_claim: best.object,
      reason: error ? `${best.result.reason} (${error})` : best.result.reason,
    });
  }
  return { observations, citations, pages, fetched, modelCheck: record };
}

/**
 * One request to the model check per answer. The stand-in upstream's answers are reproducible
 * fixtures and are never sent. Any failure leaves the rules to decide alone, and every verdict
 * then says that only the rules ran.
 */
async function runModelCheck(
  answer: RunResult,
  context: Context,
  asOf: Date,
): Promise<{ modelCheck: ModelCheck | null; record: ModelCheckRecord | null }> {
  const checker = context.jev === undefined ? jevCheckerFromEnv() : context.jev;
  if (!checker || answer.simulated) return { modelCheck: null, record: null };
  const plan = buildJevPlan({
    brand: context.brand.name,
    competitors: context.competitors,
    answer: answer.answerText,
    canonical: context.canonical,
    asOf,
  });
  if (!Object.keys(plan.questions).length) return { modelCheck: null, record: null };
  try {
    const response = await checker.evaluate({ state: plan.state, questions: plan.questions });
    const findings = interpretJev(plan, response.answers);
    return {
      modelCheck: { findings, model: response.model, minConfidence: checker.minConfidence },
      record: {
        model: response.model,
        usage: response.usage,
        findings: findings.map((f) => ({ fact: f.fact.key, choice: f.choice, outcome: f.outcome, confidence: f.confidence })),
      },
    };
  } catch (error) {
    console.warn(
      `[jev] model check unavailable, rules only: ${error instanceof Error ? `${error.name}: ${error.message.slice(0, 120)}` : 'unknown'}`,
    );
    return { modelCheck: null, record: null };
  }
}

export function persistAnswer(
  db: DB,
  tenantId: string,
  runData: repo.Row,
  evidence: Awaited<ReturnType<typeof prepareEvidence>>,
) {
  return db.transaction(() => {
    const run = repo.insertRun(db, tenantId, runData);
    evidence.pages.forEach((page) => snapshots.putSnapshot(db, page));
    evidence.observations.forEach((observation) =>
      repo.insertObservedClaim(db, tenantId, { ...observation, run_id: run.id }),
    );
    evidence.citations.forEach((citation) =>
      repo.insertCitation(db, tenantId, { ...citation, run_id: run.id }),
    );
    return run;
  })();
}
