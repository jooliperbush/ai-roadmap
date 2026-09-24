/**
 * Every public audit is a paid sample, so the form that starts one has limits: one audit per domain a week, a
 * daily cap for the whole site, a honeypot for bots, and a ceiling on the samples one audit may take. A request
 * past the cap is queued, and the request route and the scheduler start queued audits oldest first as slots
 * open. A repeat request within the week is recorded and never runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDb, type DB } from '../../src/db/index.js';
import { buildServer } from '../../src/server.js';
import { StubFetcher } from '../../src/domain/fetcher.js';
import { LIMITS } from '../../src/domain/ratelimit.js';
import { AUDIT_BUDGET_RUNS, createAuditReport, runAudit } from '../../src/services/audit.js';
import { Scheduler } from '../../src/services/scheduler.js';

// Calls through: the fetcher below finds no pages, so a started audit fails at the crawl, before any sampling.
vi.mock('../../src/services/audit.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/services/audit.js')>();
  return { ...original, runAudit: vi.fn(original.runAudit) };
});
const started = vi.mocked(runAudit);
/** The reports started so far, in order. */
const startedIds = () => started.mock.calls.map((call) => call[1]);

/** Railway's edge reaches the app from a carrier-grade NAT address and names the visitor in X-Forwarded-For. */
const EDGE = '100.64.0.7';
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe('public audit requests', () => {
  let db: DB;
  let app: FastifyInstance;
  let visitors = 0;
  /** A request through the edge, from a new visitor unless `from` says otherwise. */
  const post = (body: Record<string, unknown>, from: { peer?: string; forwarded?: string } = {}) =>
    app.inject({
      method: 'POST',
      url: '/audit-request',
      payload: { email: 'someone@example.com', ...body },
      remoteAddress: from.peer ?? EDGE,
      headers: { 'x-forwarded-for': from.forwarded ?? `198.51.100.${++visitors}` },
    });
  const reportAt = (reportUrl: string) =>
    db.prepare('SELECT id, status FROM audit_reports WHERE token = ?').get(reportUrl.split('/').pop()) as {
      id: string;
      status: string;
    };
  const statusOf = (reportUrl: string) => reportAt(reportUrl).status;
  /** The text of the element with this test id, which holds no markup. */
  const textOf = (body: string, testId: string) =>
    body.match(new RegExp(`data-testid="${testId}">([^<]*)<`))?.[1].replace(/\s+/g, ' ').trim();

  beforeEach(async () => {
    db = openDb(':memory:');
    app = buildServer({ db, demoHint: null, fetcher: new StubFetcher({}) });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    db.close();
    vi.unstubAllEnvs();
    started.mockClear();
  });

  it('starts an audit with the default sample budget', async () => {
    const res = await post({ domain: 'https://Example.com/pricing' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true, domain: 'example.com', reportUrl: expect.stringMatching(/^\/audit\//) });
    expect(started).toHaveBeenCalledTimes(1);
    expect(started.mock.calls[0][2].budgetRuns).toBe(AUDIT_BUDGET_RUNS);
    expect(statusOf(res.json().reportUrl)).not.toBe('queued');
  });

  it('answers a filled honeypot like any request, and stores and spends nothing', async () => {
    const res = await post({ domain: 'example.com', company_fax: '555-0100' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true, domain: 'example.com', reportUrl: expect.stringMatching(/^\/audit\/[0-9a-f]{32}$/) });
    const stored = db.prepare('SELECT (SELECT COUNT(*) FROM audit_requests) + (SELECT COUNT(*) FROM audit_reports) AS n').get();
    expect(stored).toEqual({ n: 0 });
    expect(started).not.toHaveBeenCalled();
    expect((await post({ domain: 'example.com', company_fax: '  ' })).json(), 'blank is a person').not.toHaveProperty('queued');
    expect(started).toHaveBeenCalledTimes(1);
  });

  it('runs one audit per domain a week, however the domain is written, and records a repeat without running it', async () => {
    const prior = createAuditReport(db, null, 'example.com');
    db.prepare("UPDATE audit_reports SET status = 'complete', started_at = ? WHERE id = ?").run(daysAgo(2), prior.id);
    const repeat = await post({ domain: 'https://www.Example.com/about' });
    expect(repeat.statusCode).toBe(201);
    expect(repeat.json()).toEqual({
      ok: true,
      domain: 'www.example.com',
      reportUrl: expect.stringMatching(/^\/audit\//),
      duplicate: true,
    });
    expect(repeat.json().reportUrl, 'an earlier report is never handed out').not.toBe(`/audit/${prior.token}`);
    expect(statusOf(repeat.json().reportUrl)).toBe('duplicate');
    expect(started).not.toHaveBeenCalled();

    db.prepare('UPDATE audit_reports SET started_at = ? WHERE id = ?').run(daysAgo(8), prior.id);
    expect((await post({ domain: 'example.com' })).json()).not.toHaveProperty('duplicate');
    const failed = createAuditReport(db, null, 'broken.example');
    db.prepare("UPDATE audit_reports SET status = 'failed', started_at = ? WHERE id = ?").run(daysAgo(1), failed.id);
    expect((await post({ domain: 'broken.example' })).json(), 'a failed audit may be retried').not.toHaveProperty('duplicate');
    expect(started).toHaveBeenCalledTimes(2);
  });

  it('queues requests past the daily cap, counting audits started in the last day, and starts queued ones first', async () => {
    vi.stubEnv('MISCITED_PUBLIC_AUDITS_PER_DAY', '2');
    const answers = [];
    for (const domain of ['one.example', 'two.example', 'three.example']) answers.push((await post({ domain })).json());
    expect(answers.map((answer) => answer.queued ?? false)).toEqual([false, false, true]);
    expect(statusOf(answers[2].reportUrl)).toBe('queued');
    expect(started).toHaveBeenCalledTimes(2);

    // One slot opens as the first start leaves the last day. The queued request takes it, ahead of a new one.
    db.prepare("UPDATE audit_reports SET started_at = ? WHERE domain = 'one.example'").run(daysAgo(1.1));
    const four = (await post({ domain: 'four.example' })).json();
    expect(startedIds()).toEqual([expect.any(String), expect.any(String), reportAt(answers[2].reportUrl).id]);
    expect(four).toHaveProperty('queued', true);

    vi.stubEnv('MISCITED_PUBLIC_AUDITS_PER_DAY', '0');
    db.prepare('UPDATE audit_reports SET started_at = ? WHERE started_at IS NOT NULL').run(daysAgo(1.1));
    expect((await post({ domain: 'five.example' })).json(), 'zero holds everything').toHaveProperty('queued', true);
    expect(started).toHaveBeenCalledTimes(3);
  });

  it('tells a queued requester the audit starts when a slot opens, and a repeat requester that none was started', async () => {
    vi.stubEnv('MISCITED_PUBLIC_AUDITS_PER_DAY', '0');
    const queued = await app.inject((await post({ domain: 'held.example' })).json().reportUrl);
    expect(queued.statusCode).toBe(200);
    expect(textOf(queued.body, 'audit-status')).toBe(
      'Received. We run a limited number of audits each day, so this one is queued and will start automatically when a slot opens. Keep this link to check its progress; this page fills in when the audit completes.',
    );

    const prior = createAuditReport(db, null, 'done.example');
    db.prepare("UPDATE audit_reports SET status = 'complete', started_at = ? WHERE id = ?").run(daysAgo(1), prior.id);
    const repeat = await app.inject((await post({ domain: 'done.example' })).json().reportUrl);
    expect(repeat.statusCode).toBe(200);
    expect(textOf(repeat.body, 'audit-status'), 'and promises nothing further').toBe(
      'done.example was audited in the last 7 days, so we have not started another audit. We have recorded your request.',
    );
  });

  it('says beside the form what submitting does', async () => {
    const fineprint = textOf((await app.inject('/')).body, 'audit-fineprint');
    expect(fineprint).toContain(
      'Submitting starts the audit right away if a slot is free. We run a limited number of audits each day, so otherwise it is queued and starts automatically when a slot opens.',
    );
    expect(fineprint).toContain('A domain audited in the last 7 days is not audited again.');
  });

  it('clamps MISCITED_AUDIT_RUNS to the most samples one audit may take', async () => {
    const cases: Array<[string, number]> = [['500', 60], ['25', 25], ['0', 1], ['lots', AUDIT_BUDGET_RUNS], ['', AUDIT_BUDGET_RUNS]];
    for (const [index, [value, budget]] of cases.entries()) {
      vi.stubEnv('MISCITED_AUDIT_RUNS', value);
      await post({ domain: `budget${index}.example` });
      expect(started.mock.calls.at(-1)?.[2].budgetRuns, value).toBe(budget);
    }
  });

  it('limits each visitor behind the edge separately, and a direct client cannot pick its own address', async () => {
    const limit = LIMITS['POST /audit-request'].limit;
    const codes = async (count: number, from: { peer?: string; forwarded?: string }) => {
      const seen = [];
      for (let i = 0; i < count; i++) seen.push((await post({ domain: 'example.com' }, from)).statusCode);
      return seen;
    };
    expect(await codes(limit + 1, { forwarded: '203.0.113.10' })).toEqual([...Array(limit).fill(201), 429]);
    expect(await codes(1, { forwarded: '203.0.113.11' }), 'another visitor').toEqual([201]);
    expect(await codes(1, { forwarded: '192.0.2.1, 203.0.113.10' }), 'a forged entry left of the edge').toEqual([429]);

    const direct = await codes(limit, { peer: '203.0.113.50' });
    expect(direct, 'a new X-Forwarded-For each time').toEqual(Array(limit).fill(201));
    expect(await codes(1, { peer: '203.0.113.50', forwarded: '198.51.100.250' })).toEqual([429]);
  });
});

describe('the scheduler and queued audits', () => {
  let db: DB;
  let scheduler: Scheduler;
  /** Stores requests as the route does past the cap, and returns their report ids. */
  const queue = (...domains: string[]) => domains.map((domain) => createAuditReport(db, null, domain).id as string);
  const statusOf = (id: string) =>
    (db.prepare('SELECT status FROM audit_reports WHERE id = ?').get(id) as { status: string }).status;

  beforeEach(() => {
    db = openDb(':memory:');
    scheduler = new Scheduler(db, { fetcher: new StubFetcher({}) });
  });
  afterEach(async () => {
    await scheduler.shutdown();
    db.close();
    vi.unstubAllEnvs();
    started.mockClear();
  });

  it('starts queued audits oldest first, as the daily cap allows', async () => {
    vi.stubEnv('MISCITED_PUBLIC_AUDITS_PER_DAY', '1');
    const [first, second] = queue('first.example', 'second.example');
    await scheduler.runOnce();
    expect(startedIds()).toEqual([first]);
    expect(statusOf(second)).toBe('queued');
    await scheduler.runOnce();
    expect(startedIds(), 'the cap still holds it').toEqual([first]);

    db.prepare('UPDATE audit_reports SET started_at = ? WHERE id = ?').run(daysAgo(1.1), first);
    await scheduler.runOnce();
    expect(startedIds()).toEqual([first, second]);
  });

  it('marks a queued request for a domain audited this week as a duplicate, without spending a slot', async () => {
    vi.stubEnv('MISCITED_PUBLIC_AUDITS_PER_DAY', '1');
    const [prior] = queue('example.com');
    db.prepare("UPDATE audit_reports SET status = 'complete', started_at = ? WHERE id = ?").run(daysAgo(3), prior);
    const [repeat, other] = queue('www.example.com', 'other.example');
    await scheduler.runOnce();
    expect(statusOf(repeat)).toBe('duplicate');
    expect(startedIds()).toEqual([other]);
  });

  it('runs one of two queued requests for the same domain', async () => {
    const [first, second] = queue('example.com', 'example.com');
    await scheduler.runOnce();
    expect(startedIds()).toEqual([first]);
    expect(statusOf(second)).toBe('duplicate');
  });

  it('starts nothing without a fetcher', async () => {
    const [held] = queue('example.com');
    const idle = new Scheduler(db, { fetcher: null });
    await idle.runOnce();
    await idle.shutdown();
    expect(started).not.toHaveBeenCalled();
    expect(statusOf(held)).toBe('queued');
  });

  it('waits for the audits it started before it shuts down', async () => {
    queue('example.com');
    let finish = () => {};
    started.mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve({}))));
    await scheduler.runOnce();
    expect(started).toHaveBeenCalledTimes(1);
    let closed = false;
    const closing = scheduler.shutdown().then(() => (closed = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(false);
    finish();
    await closing;
    expect(closed).toBe(true);
  });
});
