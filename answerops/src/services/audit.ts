/**
 * The self-serve Answer Risk Audit.
 *
 * `/audit-request` used to write an email address into a table and wait for a person. This
 * runs the whole pipeline against a domain nobody has onboarded: read the company's own pages,
 * propose what it says is true, guess what its buyers ask, sample the surfaces, and produce a
 * dated report at an unguessable URL.
 *
 * The report's honesty rules are the interesting part. Demand is labelled estimated and is
 * kept out of any sentence about money. Facts are labelled as read from the customer's own
 * pages, not as an approved registry, because nobody has approved anything yet. And an audit
 * that finds nothing says so and states the effect it was powered to detect, rather than
 * promoting the most alarming weak signal it can find, which is what a free audit designed to
 * convert would do.
 */

import { enableWeekly } from './weekly.js';
import { liveProviders } from '../providers/live.js';
import { randomBytes } from 'node:crypto';
import type { DB } from '../db/index.js';
import { id, nowIso, hashPassword } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import type { Row } from '../db/repo/index.js';
import { statements } from '../db/repo/statements.js';
import { crawlSite, proposeCanonicalClaims, autoDemand, thinPages, type CrawlResult } from './siteReader.js';
import { runSamplingRound } from './observatory.js';
import { buildDashboard, type DashboardData } from './dashboard.js';
import { BUYER_STAGE } from '../domain/intent.js';
import { requiredSampleSize, MIN_SAMPLES } from '../domain/stats.js';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import type { Fetcher } from '../domain/fetcher.js';
import type { BeliefProfile, ProviderAdapter } from '../providers/types.js';

export const AUDIT_BUDGET_RUNS = 40;

export interface AuditOptions {
  fetcher: Fetcher;
  providers?: ProviderAdapter[];
  beliefs?: BeliefProfile | null;
  clock?: Clock;
  budgetRuns?: number;
}

export interface AuditFindings {
  defects: Array<{
    headline: string;
    measurementText: string;
    example: string;
    canonical: string | null;
    severity: string;
  }>;
  missed: Array<{ label: string; absenceText: string }>;
  familySummaries: Array<{ label: string; runs: number; defectRateText: string }>;
  registryGaps: string[];
}

export function newAuditToken(): string {
  return randomBytes(16).toString('hex');
}

export function createAuditReport(db: DB, requestId: string | null, domain: string): Row {
  const row = {
    id: id('adr'),
    request_id: requestId,
    token: newAuditToken(),
    domain,
    brand_name: '',
    tenant_id: null,
    status: 'queued',
    findings: '{}',
    candidates: '[]',
    clusters: '[]',
    sample_size: 0,
    surfaces: '[]',
    cost_usd: 0,
    cost_known: 1,
    powered_for: null,
    not_tested: '[]',
    simulated_runs: 0,
    facts_read: 0,
    thin_pages: '[]',
    error: null,
    created_at: nowIso(),
    completed_at: null,
  };
  const fields = Object.keys(row);
  statements(db)
    .prepare(
      `INSERT INTO audit_reports (${fields.join(', ')}) VALUES (${fields.map((field) => `@${field}`).join(', ')})`,
    )
    .run(row);
  return row;
}

export function getAuditReportByToken(db: DB, token: string): Row | undefined {
  return statements(db).prepare('SELECT * FROM audit_reports WHERE token = @token').get({ token }) as
    | Row
    | undefined;
}

export function getAuditReport(db: DB, reportId: string): Row | undefined {
  return statements(db).prepare('SELECT * FROM audit_reports WHERE id = @reportId').get({ reportId }) as
    | Row
    | undefined;
}

export function listAuditReports(db: DB, limit = 50): Row[] {
  return statements(db)
    .prepare('SELECT * FROM audit_reports ORDER BY created_at DESC LIMIT @limit')
    .all({ limit }) as Row[];
}

/**
 * Run one audit end to end. The provisional workspace is real — same tables, same pipeline —
 * so nothing about the report is a special case that could drift from what a paying customer
 * sees. Conversion attaches a user to the workspace that already exists.
 */
function provisionAudit(db: DB, domain: string, crawl: CrawlResult, clock: Clock) {
  const candidates = proposeCanonicalClaims(crawl);
  const competitors = inferCompetitors(crawl);
  const demand = autoDemand(crawl, competitors);
  const volume = demand.reduce((sum, candidate) => sum + candidate.estimatedVolume, 0) || 1;
  return db.transaction(() => {
    const tenant = repo.createTenant(db, `Audit: ${domain}`, 'audit');
    const brand = repo.createBrand(db, tenant.id, crawl.brandName, domain, 'unclassified');
    const source = repo.createTruthSource(db, tenant.id, brand.id, {
      title: `${crawl.brandName} published pages, read ${clock.now().toISOString().slice(0, 10)}`,
      url: `https://${domain}`,
      source_class: 'owned',
      published_at: null,
    });
    for (const candidate of candidates)
      repo.createCanonicalClaim(db, tenant.id, brand.id, {
        subject: candidate.subject,
        predicate: candidate.predicate,
        object: candidate.object,
        claim_text: candidate.claimText,
        effective_from: candidate.effectiveFrom ?? '1970-01-01',
        sensitivity: candidate.sensitivity,
        source_id: source.id,
        approved_by: null,
      });
    const clusterLabels = demand.slice(0, 12).map((candidate) => {
      const cluster = repo.createCluster(db, tenant.id, brand.id, {
        label: candidate.question,
        intent_family: candidate.family,
        buyer_stage: BUYER_STAGE[candidate.family],
        demand_volume: candidate.estimatedVolume,
        demand_weight: candidate.estimatedVolume / volume,
        economic_value: 0.5,
        volatility: 0.3,
        demand_basis: 'estimated',
      });
      repo.createPromptVariant(db, tenant.id, cluster.id, candidate.question);
      return candidate.question;
    });
    return { tenant, brand, candidates, competitors, clusterLabels };
  })();
}

export async function runAudit(db: DB, reportId: string, opts: AuditOptions): Promise<Row> {
  const report = getAuditReport(db, reportId);
  if (!report) throw new Error('audit report not found');
  const clock = opts.clock ?? systemClock;
  db.prepare("UPDATE audit_reports SET status = 'running', started_at = ? WHERE id = ?").run(
    clock.now().toISOString(),
    reportId,
  );
  try {
    const crawl = await crawlSite(report.domain, opts.fetcher);
    if (!crawl.pages.length)
      throw new Error(
        `could not read any page on ${report.domain} (${crawl.failed[0]?.error ?? 'no response'})`,
      );
    const { tenant, brand, candidates, competitors, clusterLabels } = provisionAudit(
      db,
      report.domain,
      crawl,
      clock,
    );
    const round = await runSamplingRound(db, {
      tenantId: tenant.id,
      brandId: brand.id,
      windowLabel: 'audit',
      budget: opts.budgetRuns ?? AUDIT_BUDGET_RUNS,
      samplingReason: 'self_serve_audit',
      actor: 'audit',
      beliefs: opts.beliefs ?? null,
      providers:
        opts.providers ??
        (liveProviders().some((p) => p.available())
          ? liveProviders().filter((p) => p.available())
          : undefined),
      clock,
      fetcher: opts.fetcher,
    });
    const dashboard = buildDashboard(db, tenant.id, brand.id, 'audit');
    const runs = repo.runsForWindow(db, tenant.id, brand.id, 'audit');
    const details = {
      reportId,
      name: crawl.brandName,
      tenant: tenant.id,
      findings: JSON.stringify(summarise(dashboard)),
      candidates: JSON.stringify(candidates),
      clusters: JSON.stringify(clusterLabels),
      sample: round.runsCreated,
      surfaces: JSON.stringify([
        ...new Set(runs.map((run) => `${run.provider} ${run.model_id} ${run.grounding}`)),
      ]),
      cost: round.costUsd,
      known: round.costKnown ? 1 : 0,
      powered: poweredFor(round.runsCreated),
      omissions: JSON.stringify(notTested(crawl, competitors)),
      simulated: runs.filter((run) => run.simulated === 1).length,
      facts: candidates.length,
      thin: JSON.stringify(thinPages(crawl).map((page) => page.path)),
      completed: clock.now().toISOString(),
    };
    db.transaction(() => {
      db.prepare(
        `UPDATE audit_reports SET status = 'complete', brand_name = @name, tenant_id = @tenant,
        findings = @findings, candidates = @candidates, clusters = @clusters, sample_size = @sample,
        surfaces = @surfaces, cost_usd = @cost, cost_known = @known, powered_for = @powered,
        not_tested = @omissions, simulated_runs = @simulated, facts_read = @facts, thin_pages = @thin,
        completed_at = @completed WHERE id = @reportId`,
      ).run(details);
      if (report.request_id)
        db.prepare('UPDATE audit_requests SET report_id = ? WHERE id = ?').run(reportId, report.request_id);
    })();
  } catch (error) {
    db.prepare("UPDATE audit_reports SET status = 'failed', error = ?, completed_at = ? WHERE id = ?").run(
      error instanceof Error ? error.message.slice(0, 300) : 'audit failed',
      clock.now().toISOString(),
      reportId,
    );
  }
  return getAuditReport(db, reportId)!;
}

export function summarise(data: DashboardData): AuditFindings {
  const findings: AuditFindings = {
    defects: [],
    missed: [],
    familySummaries: [],
    registryGaps: data.registryGaps.slice(0, 10),
  };
  for (const defect of data.defects) {
    if (findings.defects.length === 8) break;
    findings.defects.push({
      headline: defect.headline,
      measurementText: defect.measurementText,
      example: defect.exampleStatement,
      canonical: defect.canonicalClaimText,
      severity: defect.severity,
    });
  }
  for (const demand of data.missedDemand) {
    if (findings.missed.length === 8) break;
    findings.missed.push({ label: demand.label, absenceText: demand.absenceText });
  }
  for (const family of data.familySummaries) {
    const rate = family.defectRate;
    const description = rate.sufficient ? `${Math.round((rate.point ?? 0) * 100)}%` : 'insufficient data';
    findings.familySummaries.push({
      label: family.label,
      runs: family.runs,
      defectRateText: `${description} (n=${rate.n})`,
    });
  }
  return findings;
}

/**
 * The effect this sample could have detected. Reported whether or not anything was found,
 * because "we found nothing" means nothing without it.
 */
export function poweredFor(sampleSize: number): number {
  return sampleSize < MIN_SAMPLES
    ? 1
    : ([0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5].find(
        (effect) => requiredSampleSize(0.2, effect) <= sampleSize,
      ) ?? 0.6);
}

const AUDIT_OMISSIONS = [
  'Markets other than US English. Every prompt in this audit was sampled in one market.',
  'Logged-in consumer apps. This audit sampled API and search-product surfaces, which is where grounded answers are reproducible.',
  'Your real buyer demand. The questions here are estimated from your own site and from templates, not from your search console.',
  'Any fact your site does not state. The comparison is against your published pages, not against an approved registry.',
];

export function notTested(crawl: CrawlResult, competitors: string[]): string[] {
  const thin = thinPages(crawl);
  const conditional: Array<string | null> = [
    competitors.length
      ? null
      : 'Comparison questions against named competitors, because none were identified from your site.',
    crawl.failed.length
      ? `${crawl.failed.length} pages on your site could not be read (${crawl.failed.map((failure) => failure.error).join(', ')}).`
      : null,
    thin.length
      ? `${thin.length} of the ${crawl.pages.length} pages we reached returned almost no text to a plain HTTP read ` +
        `(${thin.map((page) => page.path).join(', ')}). Sites that render their copy in the browser look like this. ` +
        'Anything stated only in the rendered page was not read, and so was not checked.'
      : null,
  ];
  return AUDIT_OMISSIONS.concat(conditional.filter((value): value is string => value !== null));
}

export function inferCompetitors(crawl: CrawlResult): string[] {
  const patterns = [/\bvs\.?\s+([A-Z][\w.&-]{2,30})/, /alternatives? to ([A-Z][\w.&-]{2,30})/i];
  return [
    ...new Set(
      crawl.pages.flatMap((page) =>
        page.headings.flatMap((heading) =>
          patterns.flatMap((pattern) => {
            const match = pattern.exec(heading);
            return match ? [match[1]] : [];
          }),
        ),
      ),
    ),
  ];
}

// ------------------------------------------------------------------- conversion

export interface ConversionInput {
  weeklyEmail?: boolean;
  token: string;
  email: string;
  password: string;
  tenantName?: string;
  clock?: Clock;
}

/**
 * Turn the audit's provisional workspace into a real one. The workspace already holds the
 * candidates, the clusters and one window of runs, so the first thing a converted customer
 * sees is their own data rather than an empty state.
 */
export function startMonitoring(
  db: DB,
  input: ConversionInput,
): { tenantId: string; userId: string; brandId: string } {
  const clock = input.clock ?? systemClock;
  return db.transaction(() => {
    const report = getAuditReportByToken(db, input.token);
    if (!report) throw new Error('audit not found');
    if (report.status !== 'complete' || !report.tenant_id) throw new Error('audit is not complete');
    if (repo.findUserByEmail(db, input.email)) throw new Error('that email already has an account');
    const tenantId = report.tenant_id as string;
    if (repo.getTenant(db, tenantId)?.plan !== 'audit') throw new Error('audit was already converted');
    const brand = repo.primaryBrand(db, tenantId);
    if (!brand) throw new Error('audit workspace has no brand');
    const { hash, salt } = hashPassword(input.password);
    db.prepare('UPDATE tenants SET name = ?, plan = ? WHERE id = ?').run(
      input.tenantName ?? report.brand_name ?? report.domain,
      'operate',
      tenantId,
    );
    const user = repo.createUser(db, tenantId, input.email, hash, salt, 'owner');
    const weekly = enableWeekly(db, tenantId, brand.id, clock);
    if (input.weeklyEmail)
      db.prepare('UPDATE schedules SET weekly_email=? WHERE id=?').run(input.email, weekly.id);
    if (report.request_id)
      db.prepare('UPDATE audit_requests SET tenant_id = ? WHERE id = ?').run(tenantId, report.request_id);
    repo.audit(
      db,
      tenantId,
      input.email,
      'audit_converted',
      'tenant',
      tenantId,
      `report=${report.id} domain=${report.domain}`,
    );
    return { tenantId, userId: user.id, brandId: brand.id };
  })();
}
