import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../../src/db/index.js';
import * as repo from '../../src/db/repo/index.js';
import { importDemand, parseDemandCsv, setMarkets, stripLocalePrefix } from '../../src/services/demand.js';
import { rollupFrom } from '../../src/services/dashboard.js';
import { diffAroundClaim } from '../../src/services/recheck.js';

const databases: DB[] = [];
function fixture() {
  const db = openDb(':memory:');
  databases.push(db);
  const tenant = repo.createTenant(db, 'Rebuild');
  const brand = repo.createBrand(db, tenant.id, 'Example', 'example.com');
  return { db, tenant, brand };
}
afterEach(() => databases.splice(0).forEach((db) => db.close()));

describe('service contract characterization', () => {
  it('parses attributed quoted questions and retains rejection reasons and market defaults', () => {
    expect(
      parseDemandCsv(
        'source,question,volume\ngsc,"What is ""Example"", exactly?",20\nunknown,Question here,3\nsales_call,x,2',
      ),
    ).toEqual({
      rows: [
        { source: 'gsc', question: 'What is "Example", exactly?', volume: 20, geo: 'US', language: 'en' },
      ],
      rejected: [
        {
          question: 'Question here',
          reason: 'Unknown source "unknown" — demand must be attributable to where it came from',
        },
        { question: 'sales_call,x,2', reason: 'No question text' },
      ],
    });
  });
  it('imports demand into weighted, attributed clusters with replayable market variants', () => {
    const { db, tenant, brand } = fixture();
    const result = importDemand(
      db,
      tenant.id,
      brand.id,
      [{ source: 'gsc', question: 'What is Example pricing?', volume: 20 }],
      'owner',
    );
    expect(result.signalsImported).toBe(1);
    expect(result.clustersCreated).toBe(1);
    expect(result.variantsCreated).toBeGreaterThan(0);
    const cluster = repo.listClusters(db, tenant.id, brand.id)[0];
    expect(cluster.demand_weight).toBe(1);
    expect(setMarkets(db, tenant.id, cluster.id, ['US', 'GB'], ['en']).created).toBe(1);
    expect(setMarkets(db, tenant.id, cluster.id, ['US', 'GB'], ['en'])).toEqual({ created: 0, kept: 2 });
    expect(stripLocalePrefix('unchanged question')).toBe('unchanged question');
  });
  it('counts distinct adjudicated runs and keeps delimiter-containing provider and cluster identities', () => {
    const claim = {
      verdict: 'CONTRADICTED',
      adjudication: 'agreed',
      misconception_key: 'example.pricing.affirm.10',
      severity: 'high',
      statement: 'Wrong price',
      canonical_claim_id: 'canonical',
    };
    const runs = [{ id: 'r', provider: 'a,b', cluster_id: 'c,d' }];
    const result = rollupFrom({
      label: 'test',
      runs,
      observedByRun: new Map([['r', [claim, claim, { ...claim, adjudication: 'disputed' }]]]),
      runsByCluster: new Map(),
    });
    expect(result).toEqual([
      {
        misconceptionKey: claim.misconception_key,
        verdict: claim.verdict,
        severity: 'high',
        exampleStatement: 'Wrong price',
        canonicalClaimId: 'canonical',
        defectRuns: 1,
        providers: ['a,b'],
        clusterIds: ['c,d'],
        adjudicated: true,
        // No stored votes: the label alone says both checks agreed, and the disputed copy is left out.
        checks: { agreed: 2, model_decided: 0, model_found: 0, rules_only: 0 },
      },
    ]);
  });
  it('shows the removed evidence when a claim disappears', () => {
    expect(diffAroundClaim('Hello. Price is ten. Goodbye.', 'Hello. Goodbye.', 'Price is ten', 0)).toEqual([
      { side: 'removed', text: 'Price is ten.' },
    ]);
  });
});

it('rolls back an entire import when cluster persistence fails', () => {
  const { db, tenant, brand } = fixture();
  db.exec(
    "CREATE TRIGGER reject_import BEFORE INSERT ON intent_clusters BEGIN SELECT RAISE(ABORT, 'injected cluster failure'); END",
  );
  expect(() =>
    importDemand(
      db,
      tenant.id,
      brand.id,
      [{ source: 'gsc', question: 'Example pricing?', volume: 20 }],
      'owner',
    ),
  ).toThrow('injected cluster failure');
  expect(db.prepare('SELECT COUNT(*) AS n FROM demand_signals').get()).toEqual({ n: 0 });
});

it('counts experiment metrics with one database statement regardless of sampled run count', async () => {
  const { seed } = await import('../../src/seed.js');
  const { countMetric } = await import('../../src/services/actionEngine.js');
  const { vi } = await import('vitest');
  const db = openDb(':memory:');
  databases.push(db);
  const info = await seed(db);
  const clusters = repo.listClusters(db, info.tenantId, info.brandId).map((c) => c.id);
  const prepare = vi.spyOn(db, 'prepare');
  const counts = countMetric(db, info.tenantId, info.brandId, clusters, 'baseline', 'clean_answer_rate');
  expect(counts.n).toBeGreaterThan(20);
  expect(counts.k).toBeLessThan(counts.n);
  expect(prepare).toHaveBeenCalledTimes(1);
  prepare.mockRestore();
});

it('never leaves a run without its evidence when persistence fails', async () => {
  const { runSamplingRound } = await import('../../src/services/observatory.js');
  const { db, tenant, brand } = fixture();
  importDemand(
    db,
    tenant.id,
    brand.id,
    [{ source: 'gsc', question: 'Example pricing?', volume: 20 }],
    'owner',
  );
  db.exec(
    "CREATE TRIGGER reject_evidence BEFORE INSERT ON observed_claims BEGIN SELECT RAISE(ABORT, 'injected evidence failure'); END",
  );
  const surface = {
    provider: 'test',
    modelId: 'test',
    modelVersion: '1',
    surface: 'api' as const,
    grounding: 'training_memory' as const,
    searchMode: 'none',
    label: 'test',
  };
  const provider = {
    key: 'test',
    displayName: 'test',
    surfaces: [surface],
    available: () => true,
    run: async () => ({
      answerText: 'Example helps customers.',
      citations: [],
      searchQueries: [],
      latencyMs: 0,
      costUsd: 0,
      simulated: true,
      systemConfigHash: 'test',
      modelVersion: '1',
    }),
  };
  await expect(
    runSamplingRound(db, {
      tenantId: tenant.id,
      brandId: brand.id,
      windowLabel: 'test',
      actor: 'owner',
      budget: 6,
      providers: [provider],
    }),
  ).rejects.toThrow('injected evidence failure');
  expect(db.prepare('SELECT COUNT(*) AS n FROM model_runs').get()).toEqual({ n: 0 });
});

it('keeps index dimensions intact when customer categories contain delimiters', async () => {
  const { seed } = await import('../../src/seed.js');
  const { buildIndex, setConsent } = await import('../../src/services/index-report.js');
  const db = openDb(':memory:');
  databases.push(db);
  const info = await seed(db);
  setConsent(db, info.tenantId, true, '2026-09-01');
  db.prepare('UPDATE tenants SET industry_category = ? WHERE id = ?').run('software|services', info.tenantId);
  db.prepare('UPDATE model_runs SET simulated = 0, model_version = ? WHERE tenant_id = ?').run(
    'release|stable',
    info.tenantId,
  );
  const cells = buildIndex(db, '2026-Q3', 1);
  expect(cells.length).toBeGreaterThan(0);
  expect(
    cells.every(
      (c) =>
        c.modelVersion === 'release|stable' &&
        c.industryCategory === 'software|services' &&
        c.quarter === '2026-Q3',
    ),
  ).toBe(true);
});

it('only accepts navigation links whose hostname matches exactly', async () => {
  const { navLinks } = await import('../../src/services/siteReader.js');
  expect(
    navLinks(
      '<a href="https://example.com.evil.test/x">bad</a><a href="/pricing">ok</a><a href="https://example.com@evil.test">bad</a>',
      'https://example.com',
      'example.com',
    ),
  ).toEqual(['https://example.com/pricing']);
});

it('records thrown delivery failures and continues through the retry budget', async () => {
  const sched = await import('../../src/db/repo/unattended.js');
  const { dispatchAlerts } = await import('../../src/services/delivery.js');
  const { db, tenant, brand } = fixture();
  const channel = sched.createChannel(db, tenant.id, {
    kind: 'email',
    target: 'recording',
    min_severity: 'low',
  });
  sched.insertAlertOnce(db, tenant.id, {
    brand_id: brand.id,
    kind: 'critical_defect',
    severity: 'critical',
    window_label: 'test',
    subject_key: 'test',
    headline: 'Test n=20',
    detail: 'Test',
  });
  const result = await dispatchAlerts(db, tenant.id, {
    email: {
      kind: 'email',
      send: async () => {
        throw new Error('transport crashed');
      },
    },
  });
  expect(result).toEqual({ delivered: 0, failed: 1, skipped: 0, attempts: 3 });
  expect(sched.listAttempts(db, tenant.id)).toHaveLength(3);
  expect(sched.getChannel(db, tenant.id, channel.id)?.state).toBe('failing');
});

it('rolls back provisional audit onboarding if demand persistence fails', async () => {
  const { createAuditReport, runAudit } = await import('../../src/services/audit.js');
  const db = openDb(':memory:');
  databases.push(db);
  const report = createAuditReport(db, null, 'example.com');
  db.exec(
    "CREATE TRIGGER reject_audit_clusters BEFORE INSERT ON intent_clusters BEGIN SELECT RAISE(ABORT, 'injected onboarding failure'); END",
  );
  const fetcher = {
    fetch: async () => ({
      ok: true,
      body: '<title>Example</title><h1>Example product</h1>',
      status: 200,
      error: null,
    }),
  } as any;
  const result = await runAudit(db, report.id, { fetcher, providers: [] });
  expect(result.status).toBe('failed');
  expect(db.prepare('SELECT COUNT(*) AS n FROM tenants').get()).toEqual({ n: 0 });
});

it('waits for in-flight scheduler work before shutdown resolves', async () => {
  const { Scheduler } = await import('../../src/services/scheduler.js');
  const sched = await import('../../src/db/repo/unattended.js');
  const { db, tenant, brand } = fixture();
  importDemand(
    db,
    tenant.id,
    brand.id,
    [{ source: 'gsc', question: 'Example pricing?', volume: 20 }],
    'owner',
  );
  sched.createSchedule(db, tenant.id, {
    brand_id: brand.id,
    cadence: 'daily',
    budget_runs: 6,
    next_run_at: '2020-01-01',
  });
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const surface = {
    provider: 'test',
    modelId: 'test',
    modelVersion: '1',
    surface: 'api' as const,
    grounding: 'training_memory' as const,
    searchMode: 'none',
    label: 'test',
  };
  const provider = {
    key: 'test',
    displayName: 'test',
    surfaces: [surface],
    available: () => true,
    run: async () => {
      entered();
      await pending;
      return {
        answerText: 'Example helps customers.',
        citations: [],
        searchQueries: [],
        latencyMs: 0,
        costUsd: 0,
        simulated: true,
        systemConfigHash: 'test',
        modelVersion: '1',
      };
    },
  };
  const scheduler = new Scheduler(db, { providers: [provider] });
  const running = scheduler.runOnce();
  await started;
  let finished = false;
  const closing = scheduler.shutdown().then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  release();
  await Promise.all([running, closing]);
  expect(finished).toBe(true);
});

it('creates reviewable GitHub changes and CMS drafts through injectable HTTP', async () => {
  const { GithubConnector, WebflowConnector, WordpressConnector } =
    await import('../../src/services/connectors.js');
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return new Response(
      JSON.stringify(
        url.endsWith('/main')
          ? { object: { sha: 'head' } }
          : {
              number: 4,
              html_url: 'https://review',
              id: 'draft',
              previewUrl: 'https://preview',
              link: 'https://preview',
            },
      ),
      { status: 200 },
    );
  }) as typeof fetch;
  const context = {
    brandName: 'Example',
    brandDomain: 'example.com',
    defectStatement: 'old',
    canonicalClaim: 'new',
    evidenceIds: ['obs'],
    experimentId: null,
    body: 'Correction',
    path: 'docs/page.md',
  };
  expect(
    await new GithubConnector(fetchImpl).ship({ id: 'action', title: 'Correct fact' }, context, {
      target: 'owner/repo',
      token: 'test',
    }),
  ).toEqual({ ok: true, externalRef: '4', url: 'https://review' });
  expect(requests).toHaveLength(4);
  expect(JSON.parse(String(requests[2].init.body)).branch).toBe('miscited/action');
  await new WebflowConnector(fetchImpl).ship({ title: 'Correct fact' }, context, {
    target: 'collection',
    token: 'test',
  });
  expect(JSON.parse(String(requests[4].init.body)).isDraft).toBe(true);
  await new WordpressConnector(fetchImpl).ship({ title: 'Correct fact' }, context, {
    target: 'https://cms/',
    token: 'test',
  });
  expect(JSON.parse(String(requests[5].init.body)).status).toBe('draft');
});

it('rolls back action creation when the mandatory transition ledger cannot be written', async () => {
  const { createAction } = await import('../../src/services/actionEngine.js');
  const { db, tenant, brand } = fixture();
  db.exec(
    "CREATE TRIGGER reject_transition BEFORE INSERT ON action_transitions BEGIN SELECT RAISE(ABORT, 'injected ledger failure'); END",
  );
  expect(() =>
    createAction(db, {
      tenantId: tenant.id,
      brandId: brand.id,
      clusterId: null,
      actionType: 'update_owned_page',
      title: 'Fix',
      rationale: 'Evidence',
      evidence: ['observation'],
      assumptions: [],
      actor: 'owner',
    }),
  ).toThrow('injected ledger failure');
  expect(repo.listActions(db, tenant.id, brand.id)).toHaveLength(0);
});

it('limits manual scheduler ticks to the authorized tenant and schedule', async () => {
  const sched = await import('../../src/db/repo/unattended.js');
  const { tick } = await import('../../src/services/scheduler.js');
  const { db, tenant, brand } = fixture();
  const other = repo.createTenant(db, 'Other');
  const otherBrand = repo.createBrand(db, other.id, 'Other', 'other.example');
  const chosen = sched.createSchedule(db, tenant.id, {
    brand_id: brand.id,
    cadence: 'daily',
    next_run_at: '2020-01-01',
  });
  const sibling = sched.createSchedule(db, tenant.id, {
    brand_id: brand.id,
    cadence: 'weekly',
    next_run_at: '2020-01-01',
  });
  const foreign = sched.createSchedule(db, other.id, {
    brand_id: otherBrand.id,
    cadence: 'daily',
    next_run_at: '2020-01-01',
  });
  const result = await tick(db, { tenantId: tenant.id, scheduleId: chosen.id, providers: [] });
  expect(result.claimed).toBe(1);
  expect(sched.getSchedule(db, tenant.id, sibling.id)?.next_run_at).toBe('2020-01-01');
  expect(sched.getSchedule(db, other.id, foreign.id)?.next_run_at).toBe('2020-01-01');
});

it('prevents a completed audit token from adding a second workspace owner', async () => {
  const { createAuditReport, startMonitoring } = await import('../../src/services/audit.js');
  const { db, tenant, brand } = fixture();
  db.prepare("UPDATE tenants SET plan = 'audit' WHERE id = ?").run(tenant.id);
  const report = createAuditReport(db, null, brand.domain);
  db.prepare("UPDATE audit_reports SET tenant_id = ?, status = 'complete' WHERE id = ?").run(
    tenant.id,
    report.id,
  );
  startMonitoring(db, { token: report.token, email: 'first@example.com', password: 'long password' });
  expect(() =>
    startMonitoring(db, { token: report.token, email: 'second@example.com', password: 'long password' }),
  ).toThrow(/already.*converted/);
  expect(repo.findUserByEmail(db, 'second@example.com')).toBeUndefined();
});

it('rejects existing action references owned by another brand while preserving detached reference labels', async () => {
  const { seed } = await import('../../src/seed.js');
  const { createAction } = await import('../../src/services/actionEngine.js');
  const db = openDb(':memory:');
  databases.push(db);
  const info = await seed(db);
  const other = repo.createBrand(db, info.tenantId, 'Other', 'other.example');
  const cluster = repo.listClusters(db, info.tenantId, info.brandId)[0];
  const evidence = db
    .prepare('SELECT id FROM observed_claims WHERE tenant_id = ? LIMIT 1')
    .get(info.tenantId) as { id: string };
  const base = {
    tenantId: info.tenantId,
    brandId: other.id,
    clusterId: null,
    actionType: 'update_owned_page',
    title: 'Fix',
    rationale: 'Evidence',
    evidence: ['detached-reference'],
    assumptions: [],
    actor: 'owner',
  };
  expect(() => createAction(db, { ...base, clusterId: cluster.id })).toThrow(/this brand/);
  expect(() => createAction(db, { ...base, treatmentClusterIds: [cluster.id] })).toThrow(/this brand/);
  expect(() => createAction(db, { ...base, evidence: [evidence.id] })).toThrow(/this brand/);
  expect(createAction(db, base).id).toBeTruthy();
});

it('preserves legacy CSV defaults, escaped quotes, blank fields, and exact rejection order', () => {
  expect(
    parseDemandCsv(
      '\n SOURCE,question,volume\ngsc,"First, ""quoted"" question",0,,\nsite_search,Second question,bad,GB,fr\nsupport_chat,Third question,-2,US,en\nnope,Rejected question,3\ngsc,,4',
    ),
  ).toEqual({
    rows: [
      { source: 'gsc', question: 'First, "quoted" question', volume: 1, geo: 'US', language: 'en' },
      { source: 'site_search', question: 'Second question', volume: 1, geo: 'GB', language: 'fr' },
      { source: 'support_chat', question: 'Third question', volume: -2, geo: 'US', language: 'en' },
    ],
    rejected: [
      {
        question: 'Rejected question',
        reason: 'Unknown source "nope" — demand must be attributable to where it came from',
      },
      { question: 'gsc,,4', reason: 'No question text' },
    ],
  });
});

it('preserves human relationship edits made while sampling awaits providers', async () => {
  const { runSamplingRound } = await import('../../src/services/observatory.js');
  const { db, tenant, brand } = fixture();
  importDemand(
    db,
    tenant.id,
    brand.id,
    [{ source: 'gsc', question: 'Compare Example and Slack', volume: 20 }],
    'owner',
  );
  const entity = repo.upsertEntity(db, tenant.id, 'Slack');
  repo.upsertRelationship(
    db,
    tenant.id,
    brand.id,
    entity.id,
    'unrelated_comention',
    'observed_comention',
    0.2,
  );
  let calls = 0;
  await runSamplingRound(db, {
    tenantId: tenant.id,
    brandId: brand.id,
    windowLabel: 'relationship-race',
    budget: 5,
    actor: 'owner',
    fetcher: null,
    providers: [
      {
        key: 'test',
        displayName: 'Test',
        available: () => true,
        surfaces: [
          {
            provider: 'test',
            modelId: 'test',
            modelVersion: '1',
            surface: 'api',
            grounding: 'training_memory',
            searchMode: 'none',
            label: 'test',
          },
        ],
        async run() {
          if (++calls === 2)
            repo.upsertRelationship(
              db,
              tenant.id,
              brand.id,
              entity.id,
              'competitor',
              'customer_declared',
              1,
              'Human edit',
            );
          return {
            answerText: 'Example works with Slack.',
            citations: [],
            searchQueries: [],
            latencyMs: 1,
            costUsd: 0,
            simulated: true,
            systemConfigHash: 'x',
            modelVersion: '1',
          };
        },
      },
    ],
  });
  expect(calls).toBe(5);
  expect(
    repo.listRelationships(db, tenant.id, brand.id).find((r) => r.entity_id === entity.id),
  ).toMatchObject({ relation: 'competitor', basis: 'customer_declared', note: 'Human edit' });
});
