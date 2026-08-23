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

import { randomBytes } from 'node:crypto';
import type { DB } from '../db/index.js';
import { id, nowIso, hashPassword } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import * as sched from '../db/repo/unattended.js';
import type { Row } from '../db/repo/index.js';
import { crawlSite, proposeCanonicalClaims, autoDemand, thinPages, type CrawlResult } from './siteReader.js';
import { runSamplingRound } from './observatory.js';
import { buildDashboard, type DashboardData } from './dashboard.js';
import { BUYER_STAGE } from '../domain/intent.js';
import { requiredSampleSize, MIN_SAMPLES } from '../domain/stats.js';
import { computeNextRun } from '../domain/scheduler.js';
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
  defects: Array<{ headline: string; measurementText: string; example: string; canonical: string | null; severity: string }>;
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
  db.prepare(
    `INSERT INTO audit_reports (id, request_id, token, domain, brand_name, tenant_id, status, findings, candidates,
      clusters, sample_size, surfaces, cost_usd, cost_known, powered_for, not_tested, simulated_runs, facts_read,
      thin_pages, error, created_at, completed_at)
     VALUES (@id, @request_id, @token, @domain, @brand_name, @tenant_id, @status, @findings, @candidates,
      @clusters, @sample_size, @surfaces, @cost_usd, @cost_known, @powered_for, @not_tested, @simulated_runs,
      @facts_read, @thin_pages, @error, @created_at, @completed_at)`,
  ).run(row);
  return row;
}

export function getAuditReportByToken(db: DB, token: string): Row | undefined {
  return db.prepare('SELECT * FROM audit_reports WHERE token = ?').get(token) as Row | undefined;
}

export function getAuditReport(db: DB, reportId: string): Row | undefined {
  return db.prepare('SELECT * FROM audit_reports WHERE id = ?').get(reportId) as Row | undefined;
}

export function listAuditReports(db: DB, limit = 50): Row[] {
  return db.prepare('SELECT * FROM audit_reports ORDER BY created_at DESC LIMIT ?').all(limit) as Row[];
}

/**
 * Run one audit end to end. The provisional workspace is real — same tables, same pipeline —
 * so nothing about the report is a special case that could drift from what a paying customer
 * sees. Conversion attaches a user to the workspace that already exists.
 */
export async function runAudit(db: DB, reportId: string, opts: AuditOptions): Promise<Row> {
  const clock = opts.clock ?? systemClock;
  const report = getAuditReport(db, reportId);
  if (!report) throw new Error('audit report not found');
  setStatus(db, reportId, 'running');

  try {
    const crawl = await crawlSite(report.domain, opts.fetcher);
    if (crawl.pages.length === 0) {
      throw new Error(`could not read any page on ${report.domain} (${crawl.failed[0]?.error ?? 'no response'})`);
    }

    const tenant = repo.createTenant(db, `Audit: ${report.domain}`, 'audit');
    const brand = repo.createBrand(db, tenant.id, crawl.brandName, report.domain, 'unclassified');

    // Facts, as candidates. `approved_by` stays null: this path cannot approve anything.
    const candidates = proposeCanonicalClaims(crawl);
    const source = repo.createTruthSource(db, tenant.id, brand.id, {
      title: `${crawl.brandName} published pages, read ${clock.now().toISOString().slice(0, 10)}`,
      url: `https://${report.domain}`,
      source_class: 'owned',
      published_at: null,
    });
    for (const c of candidates) {
      repo.createCanonicalClaim(db, tenant.id, brand.id, {
        subject: c.subject,
        predicate: c.predicate,
        object: c.object,
        claim_text: c.claimText,
        effective_from: c.effectiveFrom ?? '1970-01-01',
        sensitivity: c.sensitivity,
        source_id: source.id,
        approved_by: null,
      });
    }

    // Demand, estimated. Every cluster says so, and estimated demand never appears in a
    // sentence about money.
    const competitors = inferCompetitors(crawl);
    const demand = autoDemand(crawl, competitors);
    const totalVolume = demand.reduce((acc, d) => acc + d.estimatedVolume, 0) || 1;
    const clusterLabels: string[] = [];
    for (const d of demand.slice(0, 12)) {
      const cluster = repo.createCluster(db, tenant.id, brand.id, {
        label: d.question,
        intent_family: d.family,
        buyer_stage: BUYER_STAGE[d.family],
        demand_volume: d.estimatedVolume,
        demand_weight: d.estimatedVolume / totalVolume,
        economic_value: 0.5,
        volatility: 0.3,
        demand_basis: 'estimated',
      });
      repo.createPromptVariant(db, tenant.id, cluster.id, d.question);
      clusterLabels.push(d.question);
    }

    const round = await runSamplingRound(db, {
      tenantId: tenant.id,
      brandId: brand.id,
      windowLabel: 'audit',
      budget: opts.budgetRuns ?? AUDIT_BUDGET_RUNS,
      samplingReason: 'self_serve_audit',
      actor: 'audit',
      beliefs: opts.beliefs ?? null,
      providers: opts.providers,
      clock,
      fetcher: opts.fetcher,
    });

    const data = buildDashboard(db, tenant.id, brand.id, 'audit');
    const findings = summarise(data);
    const runs = repo.runsForWindow(db, tenant.id, brand.id, 'audit');
    const surfaces = [...new Set(runs.map((r) => `${r.provider} ${r.model_id} ${r.grounding}`))];
    // Every run already carries this flag; the report is where it was going unread.
    const simulatedRuns = runs.filter((r) => r.simulated === 1).length;

    db.prepare(
      `UPDATE audit_reports SET status = 'complete', brand_name = ?, tenant_id = ?, findings = ?, candidates = ?,
          clusters = ?, sample_size = ?, surfaces = ?, cost_usd = ?, cost_known = ?, powered_for = ?, not_tested = ?,
          simulated_runs = ?, facts_read = ?, thin_pages = ?, completed_at = ? WHERE id = ?`,
    ).run(
      crawl.brandName,
      tenant.id,
      JSON.stringify(findings),
      JSON.stringify(candidates),
      JSON.stringify(clusterLabels),
      round.runsCreated,
      JSON.stringify(surfaces),
      round.costUsd,
      round.costKnown ? 1 : 0,
      poweredFor(round.runsCreated),
      JSON.stringify(notTested(crawl, competitors)),
      simulatedRuns,
      candidates.length,
      JSON.stringify(thinPages(crawl).map((p) => p.path)),
      clock.now().toISOString(),
      reportId,
    );
    if (report.request_id) {
      db.prepare('UPDATE audit_requests SET report_id = ? WHERE id = ?').run(reportId, report.request_id);
    }
    return getAuditReport(db, reportId)!;
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : 'audit failed';
    db.prepare("UPDATE audit_reports SET status = 'failed', error = ?, completed_at = ? WHERE id = ?")
      .run(message, clock.now().toISOString(), reportId);
    return getAuditReport(db, reportId)!;
  }
}

function setStatus(db: DB, reportId: string, status: string): void {
  db.prepare('UPDATE audit_reports SET status = ? WHERE id = ?').run(status, reportId);
}

export function summarise(data: DashboardData): AuditFindings {
  return {
    defects: data.defects.slice(0, 8).map((d) => ({
      headline: d.headline,
      measurementText: d.measurementText,
      example: d.exampleStatement,
      canonical: d.canonicalClaimText,
      severity: d.severity,
    })),
    missed: data.missedDemand.slice(0, 8).map((m) => ({ label: m.label, absenceText: m.absenceText })),
    familySummaries: data.familySummaries.map((f) => ({
      label: f.label,
      runs: f.runs,
      defectRateText: f.defectRate.sufficient
        ? `${Math.round((f.defectRate.point ?? 0) * 100)}% (n=${f.defectRate.n})`
        : `insufficient data (n=${f.defectRate.n})`,
    })),
    registryGaps: data.registryGaps.slice(0, 10),
  };
}

/**
 * The effect this sample could have detected. Reported whether or not anything was found,
 * because "we found nothing" means nothing without it.
 */
export function poweredFor(sampleSize: number): number {
  if (sampleSize < MIN_SAMPLES) return 1;
  for (const effect of [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5]) {
    if (requiredSampleSize(0.2, effect) <= sampleSize) return effect;
  }
  return 0.6;
}

export function notTested(crawl: CrawlResult, competitors: string[]): string[] {
  const out = [
    'Markets other than US English. Every prompt in this audit was sampled in one market.',
    'Logged-in consumer apps. This audit sampled API and search-product surfaces, which is where grounded answers are reproducible.',
    'Your real buyer demand. The questions here are estimated from your own site and from templates, not from your search console.',
    'Any fact your site does not state. The comparison is against your published pages, not against an approved registry.',
  ];
  if (competitors.length === 0) out.push('Comparison questions against named competitors, because none were identified from your site.');
  if (crawl.failed.length > 0) out.push(`${crawl.failed.length} pages on your site could not be read (${crawl.failed.map((f) => f.error).join(', ')}).`);
  // The failure that emptied the first real audit. A 200 with no prose in it is not a page we
  // read, and saying so is the difference between "nothing is wrong" and "we could not look".
  const thin = thinPages(crawl);
  if (thin.length > 0) {
    out.push(
      `${thin.length} of the ${crawl.pages.length} pages we reached returned almost no text to a plain HTTP read ` +
        `(${thin.map((p) => p.path).join(', ')}). Sites that render their copy in the browser look like this. ` +
        'Anything stated only in the rendered page was not read, and so was not checked.',
    );
  }
  return out;
}

/** Competitors named on the company's own comparison pages. Never inferred from co-mention. */
export function inferCompetitors(crawl: CrawlResult): string[] {
  const found = new Set<string>();
  for (const page of crawl.pages) {
    for (const h of page.headings) {
      const m = h.match(/\bvs\.?\s+([A-Z][\w.&-]{2,30})/);
      if (m) found.add(m[1]);
      const alt = h.match(/alternatives? to ([A-Z][\w.&-]{2,30})/i);
      if (alt) found.add(alt[1]);
    }
  }
  return [...found];
}

// ------------------------------------------------------------------- conversion

export interface ConversionInput {
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
export function startMonitoring(db: DB, input: ConversionInput): { tenantId: string; userId: string; brandId: string } {
  const clock = input.clock ?? systemClock;
  const report = getAuditReportByToken(db, input.token);
  if (!report) throw new Error('audit not found');
  if (report.status !== 'complete' || !report.tenant_id) throw new Error('audit is not complete');
  if (repo.findUserByEmail(db, input.email)) throw new Error('that email already has an account');

  const tenantId = report.tenant_id as string;
  const brand = repo.primaryBrand(db, tenantId);
  if (!brand) throw new Error('audit workspace has no brand');

  db.prepare('UPDATE tenants SET name = ?, plan = ? WHERE id = ?')
    .run(input.tenantName ?? report.brand_name ?? report.domain, 'operate', tenantId);

  const { hash, salt } = hashPassword(input.password);
  const user = repo.createUser(db, tenantId, input.email, hash, salt, 'owner');

  sched.createSchedule(db, tenantId, {
    brand_id: brand.id,
    cadence: 'daily',
    hour_utc: 6,
    monthly_budget_usd: 500,
    budget_runs: 60,
    next_run_at: computeNextRun('daily', clock.now(), 6).toISOString(),
  });

  if (report.request_id) {
    db.prepare('UPDATE audit_requests SET tenant_id = ? WHERE id = ?').run(tenantId, report.request_id);
  }
  repo.audit(db, tenantId, input.email, 'audit_converted', 'tenant', tenantId, `report=${report.id} domain=${report.domain}`);
  return { tenantId, userId: user.id, brandId: brand.id };
}
