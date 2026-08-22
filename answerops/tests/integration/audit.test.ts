/**
 * The self-serve Answer Risk Audit: read a domain nobody has onboarded, run the real
 * pipeline, produce a dated report, convert.
 *
 * The honesty assertions are the interesting ones. Nothing here can approve a fact. Estimated
 * demand is labelled and stays out of economic claims. An audit that finds nothing says so and
 * states what it was powered to detect, instead of promoting the most alarming weak signal.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type DB } from '../../src/db/index.js';
import { seed, type SeedInfo } from '../../src/seed.js';
import * as repo from '../../src/db/repo/index.js';
import * as sched from '../../src/db/repo/unattended.js';
import { createAuditReport, runAudit, getAuditReportByToken, startMonitoring, poweredFor, notTested, inferCompetitors } from '../../src/services/audit.js';
import { crawlSite, proposeCanonicalClaims, autoDemand, parsePage, inferBrandName, navLinks } from '../../src/services/siteReader.js';
import { StubFetcher } from '../../src/domain/fetcher.js';
import { TestClock } from '../../src/domain/clock.js';
import { SimulatedProvider } from '../../src/providers/simulated.js';
import type { BeliefProfile } from '../../src/providers/types.js';

const DOMAIN = 'northwind.example';

const SITE: Record<string, { body?: string }> = {
  [`https://${DOMAIN}/`]: { body: '<title>Northwind | Data infrastructure</title><h1>Northwind</h1><p>Northwind was founded in 2017 and is headquartered in Berlin.</p><h2>How do I get started?</h2>' },
  [`https://${DOMAIN}/pricing`]: { body: '<title>Pricing</title><p>Last updated: 2026-03-01</p><p>Northwind pricing starts at $49 per month. Northwind supports SSO on every plan.</p><h2>What does Northwind cost?</h2>' },
  [`https://${DOMAIN}/about`]: { body: '<title>About</title><p>Northwind employs 240 people. Northwind raised $40 million in its Series B.</p><h2>Northwind vs Contoso</h2>' },
  [`https://${DOMAIN}/security`]: { body: '<title>Security</title><p>Northwind is SOC 2 Type II certified.</p>' },
};

/** A stand-in upstream that gets Northwind's pricing wrong on purpose. */
const WRONG: BeliefProfile = {
  brandName: 'Northwind',
  brandDomain: DOMAIN,
  opening: ['Here is what I know.'],
  closing: ['Check their site for the latest.'],
  beliefs: [
    { text: '{brand} pricing starts at $99 per month.', probability: 0.9 },
    { text: '{brand} does not support SSO.', probability: 0.7 },
  ],
  absenceByFamily: {},
};

const QUIET: BeliefProfile = {
  brandName: 'Northwind',
  brandDomain: DOMAIN,
  opening: ['Northwind is a data infrastructure company.'],
  closing: ['That is all I have.'],
  beliefs: [],
  absenceByFamily: {},
};

let db: DB;
let info: SeedInfo;
let clock: TestClock;

beforeEach(async () => {
  db = openDb(':memory:');
  info = await seed(db);
  clock = new TestClock('2026-06-01T00:00:00.000Z');
});

function fetcher() {
  return new StubFetcher(SITE, () => clock.now());
}

describe('reading a site', () => {
  it('visits the pages a company keeps its facts on', async () => {
    const crawl = await crawlSite(DOMAIN, fetcher());
    expect(crawl.pages.map((p) => p.path).sort()).toEqual(['/', '/about', '/pricing', '/security']);
    expect(crawl.brandName).toBe('Northwind');
  });

  it('records the pages it could not read rather than pretending they were empty', async () => {
    const crawl = await crawlSite(DOMAIN, fetcher());
    expect(crawl.failed.length).toBeGreaterThan(0);
    expect(crawl.failed.every((f) => f.error === 'http_404')).toBe(true);
  });

  it('takes the brand name from the title, not from the domain, when it can', () => {
    expect(inferBrandName([parsePage('https://x.example/', 'x.example', '<title>Fabrikam | Home</title>', 200)], 'x.example')).toBe('Fabrikam');
    expect(inferBrandName([], 'contoso.example')).toBe('Contoso');
  });

  it('picks up a stated update date for an effective-from', () => {
    const page = parsePage(`https://${DOMAIN}/pricing`, DOMAIN, SITE[`https://${DOMAIN}/pricing`].body!, 200);
    expect(page.updatedAt).toBe('2026-03-01');
  });

  it('collects only same-host links', () => {
    const links = navLinks('<a href="/docs">d</a><a href="https://evil.example/x">e</a>', 'https://a.example/', 'a.example');
    expect(links).toEqual(['https://a.example/docs']);
  });
});

describe('candidate facts', () => {
  it("proposes facts from the company's own pages, with a source for each", async () => {
    const crawl = await crawlSite(DOMAIN, fetcher());
    const candidates = proposeCanonicalClaims(crawl);
    expect(candidates.length).toBeGreaterThanOrEqual(6);
    expect(candidates.every((c) => c.sourceUrl.startsWith('https://'))).toBe(true);
    expect(new Set(candidates.map((c) => c.predicate)).size).toBeGreaterThanOrEqual(4);
  });

  it('marks money and ownership facts material and compliance regulated', async () => {
    const candidates = proposeCanonicalClaims(await crawlSite(DOMAIN, fetcher()));
    expect(candidates.find((c) => c.predicate === 'pricing')?.sensitivity).toBe('material');
    expect(candidates.find((c) => c.predicate === 'compliance')?.sensitivity).toBe('regulated');
  });

  it('cannot approve anything it proposes', async () => {
    const report = createAuditReport(db, null, DOMAIN);
    await runAudit(db, report.id, { fetcher: fetcher(), providers: [new SimulatedProvider()], beliefs: WRONG, clock });
    const done = getAuditReportByToken(db, report.token)!;
    const claims = repo.listCanonicalClaims(db, done.tenant_id, repo.primaryBrand(db, done.tenant_id)!.id);
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((c) => c.approved_by === null),
      'a self-serve path that can approve a fact is a self-serve path that can invent one').toBe(true);
  });
});

describe('estimated demand', () => {
  it("builds clusters from the site's own questions, competitor pairs and templates", async () => {
    const crawl = await crawlSite(DOMAIN, fetcher());
    const demand = autoDemand(crawl, inferCompetitors(crawl));
    expect(demand.some((d) => d.source === 'site_faq')).toBe(true);
    expect(demand.some((d) => d.source === 'template')).toBe(true);
    expect(new Set(demand.map((d) => d.family)).size).toBeGreaterThan(2);
  });

  it('finds competitors only where the site names them', async () => {
    expect(inferCompetitors(await crawlSite(DOMAIN, fetcher()))).toContain('Contoso');
  });

  it('labels every auto-created cluster as estimated', async () => {
    const report = createAuditReport(db, null, DOMAIN);
    await runAudit(db, report.id, { fetcher: fetcher(), providers: [new SimulatedProvider()], beliefs: WRONG, clock });
    const done = getAuditReportByToken(db, report.token)!;
    const clusters = repo.listClusters(db, done.tenant_id, repo.primaryBrand(db, done.tenant_id)!.id);
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters.every((c) => c.demand_basis === 'estimated')).toBe(true);
  });
});

describe('the report', () => {
  it('runs the real pipeline and completes with a sample and surfaces', async () => {
    const report = createAuditReport(db, null, DOMAIN);
    const done = await runAudit(db, report.id, { fetcher: fetcher(), providers: [new SimulatedProvider()], beliefs: WRONG, clock });
    expect(done.status).toBe('complete');
    expect(done.sample_size).toBeGreaterThan(0);
    expect(JSON.parse(done.surfaces).length).toBeGreaterThan(0);
    expect(done.brand_name).toBe('Northwind');
    expect(done.token).toHaveLength(32);
  });

  it('finds the defect the stand-in upstream was told to produce', async () => {
    const report = createAuditReport(db, null, DOMAIN);
    const done = await runAudit(db, report.id, { fetcher: fetcher(), providers: [new SimulatedProvider()], beliefs: WRONG, clock });
    const findings = JSON.parse(done.findings);
    expect(findings.defects.length).toBeGreaterThan(0);
    expect(JSON.stringify(findings)).toMatch(/\$99|SSO/);
  });

  it('states what it was powered to detect even when it finds nothing', async () => {
    const report = createAuditReport(db, null, DOMAIN);
    const done = await runAudit(db, report.id, { fetcher: fetcher(), providers: [new SimulatedProvider()], beliefs: QUIET, clock });
    expect(done.status).toBe('complete');
    expect(Number(done.powered_for)).toBeGreaterThan(0);
    expect(Number(done.powered_for)).toBeLessThanOrEqual(1);
  });

  it('always names what it did not test', async () => {
    const report = createAuditReport(db, null, DOMAIN);
    const done = await runAudit(db, report.id, { fetcher: fetcher(), providers: [new SimulatedProvider()], beliefs: WRONG, clock });
    const notes = JSON.parse(done.not_tested) as string[];
    expect(notes.length).toBeGreaterThanOrEqual(4);
    expect(notes.join(' ')).toMatch(/market|search console|approved registry/i);
  });

  it('fails loudly and keeps the reason when the site cannot be read', async () => {
    const report = createAuditReport(db, null, 'nothing-here.example');
    const done = await runAudit(db, report.id, { fetcher: new StubFetcher({}), providers: [new SimulatedProvider()], beliefs: WRONG, clock });
    expect(done.status).toBe('failed');
    expect(done.error).toMatch(/could not read/);
  });

  it('reports a smaller detectable effect for a larger sample', () => {
    expect(poweredFor(1000)).toBeLessThan(poweredFor(20));
    expect(poweredFor(2)).toBe(1);
  });
});

describe('conversion', () => {
  async function completedAudit() {
    const request = { id: 'req_test' };
    db.prepare('INSERT INTO audit_requests (id, email, domain, source, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(request.id, 'ops@northwind.example', DOMAIN, 'public_site', clock.now().toISOString());
    const report = createAuditReport(db, request.id, DOMAIN);
    await runAudit(db, report.id, { fetcher: fetcher(), providers: [new SimulatedProvider()], beliefs: WRONG, clock });
    return getAuditReportByToken(db, report.token)!;
  }

  it('attaches a user to the workspace the audit already built', async () => {
    const done = await completedAudit();
    const out = startMonitoring(db, { token: done.token, email: 'ash@northwind.example', password: 'a-long-password', clock });
    expect(out.tenantId).toBe(done.tenant_id);
    const user = repo.findUserByEmail(db, 'ash@northwind.example')!;
    expect(user.role).toBe('owner');
    expect(repo.listClusters(db, out.tenantId, out.brandId).length).toBeGreaterThan(0);
    expect(repo.runsForWindow(db, out.tenantId, out.brandId, 'audit').length).toBeGreaterThan(0);
  });

  it('schedules the first round so the workspace starts collecting immediately', async () => {
    const done = await completedAudit();
    const out = startMonitoring(db, { token: done.token, email: 'a@b.example', password: 'a-long-password', clock });
    const schedules = sched.listSchedules(db, out.tenantId);
    expect(schedules).toHaveLength(1);
    expect(schedules[0].cadence).toBe('daily');
  });

  it('records which request became which tenant, so conversion is measurable', async () => {
    const done = await completedAudit();
    const out = startMonitoring(db, { token: done.token, email: 'c@d.example', password: 'a-long-password', clock });
    const request = db.prepare('SELECT * FROM audit_requests WHERE id = ?').get('req_test') as Record<string, string>;
    expect(request.tenant_id).toBe(out.tenantId);
    expect(request.report_id).toBeTruthy();
  });

  it('refuses to convert an audit that has not finished', () => {
    const report = createAuditReport(db, null, DOMAIN);
    expect(() => startMonitoring(db, { token: report.token, email: 'x@y.example', password: 'a-long-password', clock }))
      .toThrow(/not complete/);
  });

  it('refuses an email that already has an account', async () => {
    const done = await completedAudit();
    expect(() => startMonitoring(db, { token: done.token, email: info.email, password: 'a-long-password', clock }))
      .toThrow(/already has an account/);
  });

  it('refuses an unknown token', () => {
    expect(() => startMonitoring(db, { token: 'x'.repeat(32), email: 'q@r.example', password: 'a-long-password', clock }))
      .toThrow(/not found/);
  });
});
