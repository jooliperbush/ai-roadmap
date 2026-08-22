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
import { crawlSite, proposeCanonicalClaims, autoDemand, parsePage, inferBrandName, navLinks, isQuestionHeading, thinPages } from '../../src/services/siteReader.js';
import { auditReportView } from '../../src/web/views/ops.js';
import { costOf } from '../../src/domain/pricing.js';
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

/**
 * Regressions from the first real audit, run against onvanar.com on 22 August 2026.
 *
 * That report was wrong in three ways at once and every one of the 466 tests passed while it
 * was wrong, which is the part worth fixing. It presented a sample taken entirely from the
 * deterministic stand-in as though four real assistants had been asked; it printed "0 answer
 * defects" when zero facts had been read, so the zero was an artefact of an empty registry;
 * and it listed "How it works." as a buyer question, having scraped a nav heading off the page
 * and then spent five runs sampling it.
 *
 * Each test below fails against the code as it shipped.
 */

/** A site that answers 200 and says nothing checkable — a client-rendered marketing page. */
const SILENT = 'quiet.example';
const SILENT_SITE: Record<string, { body?: string }> = {
  // Faithful to the shape that broke the first audit: a large response whose copy is built in
  // the browser, so a plain HTTP read gets the shell, the headings and almost no prose.
  [`https://${SILENT}/`]: {
    body: '<title>Quiet | Launch, Hire and Back AI Organizations</title><h1>Quiet</h1>' +
      '<h2>How it works.</h2><h2>What we do</h2><h2>Why choose us</h2>' +
      '<div id="root"></div><script>window.__NEXT_DATA__=' + JSON.stringify({ pad: 'x'.repeat(40_000) }) + '</script>',
  },
  [`https://${SILENT}/about`]: {
    body: '<title>About</title><h1>About Quiet</h1><p>' + 'We build the future of autonomous organizations. '.repeat(60) + '</p>',
  },
};

const SILENT_BELIEFS: BeliefProfile = {
  brandName: 'Quiet',
  brandDomain: SILENT,
  opening: ['I do not have much on that.'],
  closing: ['Check their site.'],
  beliefs: [],
  absenceByFamily: {},
};

function renderReport(row: any): string {
  return auditReportView({
    report: row,
    findings: JSON.parse(row.findings),
    candidates: JSON.parse(row.candidates),
    surfaces: JSON.parse(row.surfaces),
    notTested: JSON.parse(row.not_tested),
  }).value;
}

async function silentAudit() {
  const report = createAuditReport(db, null, SILENT);
  await runAudit(db, report.id, {
    fetcher: new StubFetcher(SILENT_SITE, () => clock.now()),
    providers: [new SimulatedProvider()],
    beliefs: SILENT_BELIEFS,
    clock,
  });
  return getAuditReportByToken(db, report.token)!;
}

async function northwindAudit(beliefs: BeliefProfile = WRONG) {
  const report = createAuditReport(db, null, DOMAIN);
  await runAudit(db, report.id, { fetcher: fetcher(), providers: [new SimulatedProvider()], beliefs, clock });
  return getAuditReportByToken(db, report.token)!;
}

describe('the report says whether a real assistant was asked', () => {
  it('counts the simulated runs in the sample instead of leaving the column unread', async () => {
    const done = await northwindAudit();
    expect(done.sample_size).toBeGreaterThan(0);
    expect(done.simulated_runs).toBe(done.sample_size);
  });

  it('leads the page with the disclosure when nothing came from a real model', async () => {
    const html = renderReport(await northwindAudit());
    expect(html).toContain('audit-simulated-banner');
    expect(html).toMatch(/No real assistant was asked/i);
    expect(html).toMatch(/ChatGPT, Claude, Gemini or\s+Perplexity/);
  });

  it('puts the disclosure above the first number on the page', async () => {
    const html = renderReport(await northwindAudit());
    expect(html.indexOf('audit-simulated-banner'))
      .toBeLessThan(html.indexOf('audit-sample'));
  });

  it('warns that a sim- model id is the stand-in and not that vendor', async () => {
    const html = renderReport(await northwindAudit());
    expect(html).toContain('audit-surface-sim');
  });

  it('shows no such banner when every run came from a real provider', async () => {
    const done = await northwindAudit();
    const html = renderReport({ ...done, simulated_runs: 0 });
    expect(html).not.toContain('audit-simulated-banner');
  });

  it('says "part of this sample" rather than "none of it" for a mixed round', async () => {
    const done = await northwindAudit();
    const html = renderReport({ ...done, simulated_runs: 2 });
    expect(html).toMatch(/Part of this sample/i);
    expect(html).not.toMatch(/No real assistant was asked/i);
  });
});

describe('a report with no facts read does not claim a clean result', () => {
  it('records how many checkable facts the site read produced', async () => {
    const rich = await northwindAudit();
    expect(rich.facts_read).toBe(JSON.parse(rich.candidates).length);
    expect(rich.facts_read).toBeGreaterThan(0);
  });

  it('reads zero facts from a site that states none, without inventing any', async () => {
    const done = await silentAudit();
    expect(done.status).toBe('complete');
    expect(done.facts_read).toBe(0);
    expect(JSON.parse(done.candidates)).toEqual([]);
  });

  it('refuses to print a defect count that an empty registry produced', async () => {
    const html = renderReport(await silentAudit());
    expect(html).toContain('audit-no-facts-banner');
    expect(html).toMatch(/accuracy was not tested/i);
    expect(html).toMatch(/means "not checked", not "nothing wrong"/);
  });

  it('says the count is "not checked" rather than showing 0 defects', async () => {
    const done = await silentAudit();
    const html = renderReport(done);
    if (html.includes('audit-defect-count')) {
      const count = html.split('audit-defect-count"')[1].split('<')[0];
      expect(count).toMatch(/not checked/);
    } else {
      expect(html).toContain('audit-empty-unchecked');
    }
  });

  it('explains which predicates it looked for, so the gap is actionable', async () => {
    const html = renderReport(await silentAudit());
    expect(html).toContain('audit-candidates-empty');
    expect(html).toMatch(/price, fees, availability/);
  });

  it('still shows a real defect count when facts were read', async () => {
    const html = renderReport(await northwindAudit());
    expect(html).not.toContain('audit-no-facts-banner');
    expect(html).not.toMatch(/not checked/);
  });

  it('keeps absence findings, which do not depend on the registry', async () => {
    const done = await silentAudit();
    const findings = JSON.parse(done.findings);
    expect(Array.isArray(findings.missed)).toBe(true);
  });
});

describe('a nav heading is not a buyer question', () => {
  it('rejects the exact heading that reached the first real report', () => {
    expect(isQuestionHeading('How it works.')).toBe(false);
  });

  it('rejects section labels that open with a question word', () => {
    for (const h of ['How it works', 'What we do', 'Why choose us', 'When you are ready', 'Which plan is right for you']) {
      expect(isQuestionHeading(h), `${h} is a heading, not a question`).toBe(false);
    }
  });

  it('accepts a heading the author punctuated as a question', () => {
    for (const h of ['What does Northwind cost?', 'How do I get started?', 'Is my data encrypted?  ']) {
      expect(isQuestionHeading(h), `${h} is a question`).toBe(true);
    }
  });

  it('never turns a nav heading into a sampled cluster', async () => {
    const crawl = await crawlSite(SILENT, new StubFetcher(SILENT_SITE, () => clock.now()));
    const questions = autoDemand(crawl).map((d) => d.question.toLowerCase());
    expect(questions).not.toContain('how it works');
    expect(questions).not.toContain('what we do');
    expect(questions).not.toContain('why choose us');
  });

  it('does not spend a single run on one, end to end', async () => {
    const done = await silentAudit();
    const clusters = JSON.parse(done.clusters) as string[];
    expect(clusters.map((c) => c.toLowerCase())).not.toContain('how it works');
  });

  it('still picks up a real FAQ heading from the site', async () => {
    const crawl = await crawlSite(DOMAIN, fetcher());
    const fromSite = autoDemand(crawl).filter((d) => d.source === 'site_faq').map((d) => d.question);
    expect(fromSite.join(' | ')).toMatch(/get started|cost/i);
  });
});

describe('a page that answers 200 with no prose is declared, not counted as read', () => {
  it('flags a page under the readable floor', async () => {
    const crawl = await crawlSite(SILENT, new StubFetcher(SILENT_SITE, () => clock.now()));
    const thin = thinPages(crawl);
    expect(thin.map((p) => p.path)).toContain('/');
    expect(thin.map((p) => p.path)).not.toContain('/about');
  });

  it('does not flag a page that carried real copy', async () => {
    const crawl = await crawlSite(DOMAIN, fetcher());
    expect(thinPages(crawl).map((p) => p.path)).not.toContain('/pricing');
  });

  it('tells the reader that a client-rendered page is why the facts are missing', async () => {
    const done = await silentAudit();
    const notes = (JSON.parse(done.not_tested) as string[]).join(' ');
    expect(notes).toMatch(/almost no text/i);
    expect(notes).toMatch(/render their copy in the browser/i);
    expect(JSON.parse(done.thin_pages)).toContain('/');
  });

  it('says nothing about thin pages when every page read fully', async () => {
    const done = await northwindAudit();
    const notes = (JSON.parse(done.not_tested) as string[]).join(' ');
    expect(notes).not.toMatch(/almost no text/i);
  });
});

describe('a simulated sample is not given a price', () => {
  it('records the cost as unknown rather than inventing one', async () => {
    const done = await northwindAudit();
    expect(done.simulated_runs).toBe(done.sample_size);
    expect(done.cost_known).toBe(0);
  });

  it('shows "partly unpriced" on the report instead of a dollar figure', async () => {
    const html = renderReport(await northwindAudit());
    expect(html).toContain('partly unpriced');
    expect(html).not.toMatch(/audit-cost"[^>]*>\$[0-9]/);
  });

  it('still prices a round when a real provider reported usage', () => {
    expect(costOf('gpt-5.1', { inputTokens: 2000, outputTokens: 700, searchCalls: 1 })).toBeCloseTo(0.0195, 4);
    expect(costOf('gpt-5.1', null)).toBeNull();
  });
});
