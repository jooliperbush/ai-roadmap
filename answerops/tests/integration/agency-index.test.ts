/**
 * Multi-brand operation, per-brand roles, market fan-out, the query budget, and the index
 * boundary against a real database.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, Harness, get, postForm, login } from './helpers.js';
import { openDb, type DB } from '../../src/db/index.js';
import { seed, VIEWER_EMAIL, VIEWER_PASSWORD, type SeedInfo } from '../../src/seed.js';
import * as repo from '../../src/db/repo/index.js';
import * as agency from '../../src/db/repo/agency.js';
import { buildDashboard } from '../../src/services/dashboard.js';
import { setMarkets, marketBreakdown } from '../../src/services/demand.js';
import { buildIndex, buildIndexReport, indexRowsFor, setConsent, quarterOf, K_ANON } from '../../src/services/index-report.js';
import { runSamplingRound } from '../../src/services/observatory.js';
import { SimulatedProvider } from '../../src/providers/simulated.js';
import { VANAR_AFTER } from '../../seed/simulation.js';
import { assertNoGeoBlending, GeoBlendingError } from '../../src/domain/geo.js';

describe('multi-brand', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  it('shows a switcher once there is more than one brand', async () => {
    const res = await get(h.app, '/', h.cookie);
    expect(res.body).toContain('data-testid="brand-switcher"');
    expect(repo.listBrands(h.db, h.info.tenantId).length).toBeGreaterThan(1);
  });

  it('switches the brand in focus and keeps it', async () => {
    const other = repo.listBrands(h.db, h.info.tenantId).find((b) => b.id !== h.info.brandId)!;
    const res = await postForm(h.app, '/brands/switch', h.cookie, { brand_id: other.id });
    expect(res.statusCode).toBe(302);
    const page = await get(h.app, '/', h.cookie);
    expect(page.body).toContain(other.name);
  });

  it('refuses a brand from another workspace', async () => {
    const foreign = repo.primaryBrand(h.db, h.info.otherTenantId)!;
    const res = await postForm(h.app, '/brands/switch', h.cookie, { brand_id: foreign.id });
    expect(decodeURIComponent(String(res.headers.location))).toMatch(/not in this workspace/);
  });

  it('ranks the portfolio by open critical defects', async () => {
    const res = await get(h.app, '/portfolio', h.cookie);
    expect(res.statusCode).toBe(200);
    const rows = res.body.match(/data-testid="portfolio-row"/g) ?? [];
    expect(rows.length).toBe(repo.listBrands(h.db, h.info.tenantId).length);
  });

  it('does not show another workspace brands in the portfolio', async () => {
    const foreign = repo.primaryBrand(h.db, h.info.otherTenantId)!;
    const res = await get(h.app, '/portfolio', h.cookie);
    expect(res.body).not.toContain(foreign.name);
  });

  it('renders a brand with no runs as a zero row rather than an error', async () => {
    const quiet = repo.listBrands(h.db, h.info.tenantId).find((b) => b.id !== h.info.brandId)!;
    await postForm(h.app, '/brands/switch', h.cookie, { brand_id: quiet.id });
    const res = await get(h.app, '/', h.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/\[object Object\]|undefined/);
  });
});

describe('per-brand roles', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  it('lets a workspace viewer edit the one brand they were given', async () => {
    const analyst = repo.findUserByEmail(h.db, VIEWER_EMAIL)!;
    const second = repo.listBrands(h.db, h.info.tenantId).find((b) => b.id !== h.info.brandId)!;
    expect(agency.brandRole(h.db, h.info.tenantId, analyst.id, second.id)).toBe('editor');

    const viewer = await login(h.app, VIEWER_EMAIL, VIEWER_PASSWORD);
    await postForm(h.app, '/brands/switch', viewer, { brand_id: second.id });
    const allowed = await postForm(h.app, '/sampling/run', viewer, { window_label: 'brand-scoped', budget: '10' });
    expect(allowed.statusCode, 'editor on this brand').toBe(302);

    await postForm(h.app, '/brands/switch', viewer, { brand_id: h.info.brandId });
    const refused = await postForm(h.app, '/sampling/run', viewer, { window_label: 'nope', budget: '10' });
    expect(refused.statusCode, 'viewer on that one').toBe(403);
  });

  it('falls back to the workspace role where no per-brand row exists', () => {
    const analyst = repo.findUserByEmail(h.db, VIEWER_EMAIL)!;
    expect(agency.brandRole(h.db, h.info.tenantId, analyst.id, h.info.brandId)).toBeNull();
    expect(analyst.role).toBe('viewer');
  });
});

describe('markets', () => {
  let db: DB;
  let info: SeedInfo;
  beforeEach(async () => {
    db = openDb(':memory:');
    info = await seed(db);
  });

  it('creates one prompt variant per market and localises it', () => {
    const cluster = repo.listClusters(db, info.tenantId, info.brandId)[0];
    const before = repo.listVariants(db, info.tenantId, cluster.id).length;
    const result = setMarkets(db, info.tenantId, cluster.id, ['US', 'DE', 'JP'], ['en', 'de', 'ja']);
    const after = repo.listVariants(db, info.tenantId, cluster.id);
    expect(result.created).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(before);
    expect(new Set(after.map((v) => v.geo))).toContain('DE');
    expect(after.find((v) => v.geo === 'DE')!.prompt).toMatch(/Auf Deutsch/);
  });

  it('is idempotent, so saving the same markets twice adds nothing', () => {
    const cluster = repo.listClusters(db, info.tenantId, info.brandId)[0];
    setMarkets(db, info.tenantId, cluster.id, ['US', 'DE'], ['en', 'de']);
    const second = setMarkets(db, info.tenantId, cluster.id, ['US', 'DE'], ['en', 'de']);
    expect(second.created).toBe(0);
    expect(second.kept).toBeGreaterThan(0);
  });

  it('leaves history alone when a market is removed', () => {
    const cluster = repo.listClusters(db, info.tenantId, info.brandId)[0];
    setMarkets(db, info.tenantId, cluster.id, ['US', 'DE'], ['en', 'de']);
    const runsBefore = repo.runsForCluster(db, info.tenantId, cluster.id).length;
    setMarkets(db, info.tenantId, cluster.id, ['US'], ['en']);
    expect(repo.runsForCluster(db, info.tenantId, cluster.id).length,
      'deleting history to tidy a config is how a time series quietly becomes a lie').toBe(runsBefore);
  });

  it('samples each market separately and reports them unpooled', async () => {
    const cluster = repo.listClusters(db, info.tenantId, info.brandId)[0];
    setMarkets(db, info.tenantId, cluster.id, ['US', 'DE', 'FR'], ['en', 'de', 'fr']);
    await runSamplingRound(db, {
      tenantId: info.tenantId, brandId: info.brandId, windowLabel: 'geo', budget: 120,
      actor: 'test', beliefs: VANAR_AFTER, providers: [new SimulatedProvider()],
    });
    const breakdown = marketBreakdown(db, info.tenantId, info.brandId, 'geo');
    expect(breakdown.length).toBeGreaterThan(1);
    expect(() => assertNoGeoBlending(breakdown.map((b) => b.geo))).toThrow(GeoBlendingError);
  });
});

describe('the dashboard query budget', () => {
  it('issues a bounded number of statements regardless of how many runs there are', async () => {
    const db = openDb(':memory:');
    const info = await seed(db);
    await runSamplingRound(db, {
      tenantId: info.tenantId, brandId: info.brandId, windowLabel: 'big', budget: 400,
      actor: 'test', beliefs: VANAR_AFTER, providers: [new SimulatedProvider()],
    });
    const runs = repo.runsForWindow(db, info.tenantId, info.brandId, 'big').length;
    expect(runs).toBeGreaterThan(100);

    // Counting prepared statements is the only way to catch an N+1 that is merely slow rather
    // than wrong. The dashboard used to issue one query per run.
    const original = db.prepare.bind(db);
    let count = 0;
    (db as any).prepare = (sql: string) => { count++; return original(sql); };
    try {
      buildDashboard(db, info.tenantId, info.brandId, 'big');
    } finally {
      (db as any).prepare = original;
    }
    expect(count, `${count} statements for ${runs} runs`).toBeLessThan(25);
  });
});

describe('the accuracy index', () => {
  let db: DB;
  let info: SeedInfo;
  beforeEach(async () => {
    db = openDb(':memory:');
    info = await seed(db);
  });

  it('exports nothing from a workspace that has not opted in', () => {
    expect(indexRowsFor(db, info.tenantId, '2026-Q2')).toEqual([]);
  });

  it('exports only the six declared fields once consent is given', () => {
    setConsent(db, info.tenantId, true, new Date().toISOString());
    db.prepare('UPDATE model_runs SET simulated = 0 WHERE tenant_id = ?').run(info.tenantId);
    const rows = indexRowsFor(db, info.tenantId, '2026-Q2');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ['industry_category', 'model_version', 'predicate_class', 'provider', 'quarter', 'verdict'],
      );
      expect(JSON.stringify(row)).not.toMatch(/Vanar|vanarchain/i);
    }
  });

  it('excludes simulated runs, which is what keeps the index about real models', () => {
    setConsent(db, info.tenantId, true, new Date().toISOString());
    expect(indexRowsFor(db, info.tenantId, '2026-Q2'), 'the seeded world is entirely simulated').toEqual([]);
  });

  it('suppresses any cell resting on fewer than five workspaces', () => {
    setConsent(db, info.tenantId, true, new Date().toISOString());
    db.prepare('UPDATE model_runs SET simulated = 0 WHERE tenant_id = ?').run(info.tenantId);
    const cells = buildIndex(db, quarterOf(new Date()));
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => c.suppressed), `one workspace is fewer than ${K_ANON}`).toBe(true);
    expect(cells.every((c) => c.staleOrWrong.point === null)).toBe(true);
  });

  it('publishes a cell once enough workspaces contribute', () => {
    db.prepare('UPDATE model_runs SET simulated = 0').run();
    // Five consenting workspaces contributing the same cell. The seeded workspace consents
    // too, but its runs land in different cells, which is exactly why k is counted per cell
    // and not per report.
    setConsent(db, info.tenantId, true, new Date().toISOString());
    for (let i = 0; i < K_ANON; i++) {
      const t = repo.createTenant(db, `Copy ${i}`, 'operate');
      db.prepare("UPDATE tenants SET index_consent = 1, industry_category = 'blockchain infrastructure' WHERE id = ?").run(t.id);
      const b = repo.createBrand(db, t.id, `Copy ${i}`, `copy${i}.example`, 'x');
      const cluster = repo.createCluster(db, t.id, b.id, { label: 'q', intent_family: 'factual', buyer_stage: 'evaluation' });
      const variant = repo.createPromptVariant(db, t.id, cluster.id, 'q');
      const run = repo.insertRun(db, t.id, {
        brand_id: b.id, cluster_id: cluster.id, variant_id: variant.id, provider: 'simulated',
        model_id: 'sim', model_version: 'sim-1', surface: 'api', grounding: 'grounded_search',
        search_mode: 'off', geo: 'US', language: 'en', personalization: 'logged_out',
        system_config_hash: 'h', temperature: 0.7, seed: 1, simulated: 0, answer_text: 'x',
        raw_response_ref: '', search_queries: '[]', latency_ms: 1, cost_usd: 0, cost_known: 1,
        sampling_reason: 'test', window_label: 'w', requested_at: new Date().toISOString(),
      });
      repo.insertObservedClaim(db, t.id, {
        run_id: run.id, statement: 's', subject: 'x', predicate: 'pricing', object: 'y',
        polarity: 'affirm', temporal_marker: null, brand_role: 'mentioned', verdict: 'CONTRADICTED',
        canonical_claim_id: null, severity: 'high', misconception_key: 'k', adjudication: 'not_required',
        evaluator_votes: '[]',
      });
    }
    const report = buildIndexReport(db, quarterOf(new Date()));
    expect(report.consentingTenants).toBe(K_ANON + 1);
    expect(report.published.length, 'a cell with five contributing workspaces is publishable').toBeGreaterThan(0);
    expect(report.suppressedCells, 'the seeded workspace thin cells stay suppressed').toBeGreaterThan(0);
    expect(report.methodology.join(' ')).toMatch(/opt-in|revocable/i);
  });

  it('is revocable, and revoking removes the workspace from the next report', () => {
    setConsent(db, info.tenantId, true, new Date().toISOString());
    db.prepare('UPDATE model_runs SET simulated = 0 WHERE tenant_id = ?').run(info.tenantId);
    expect(indexRowsFor(db, info.tenantId, '2026-Q2').length).toBeGreaterThan(0);
    setConsent(db, info.tenantId, false, new Date().toISOString());
    expect(indexRowsFor(db, info.tenantId, '2026-Q2')).toEqual([]);
    expect(repo.listAudit(db, info.tenantId).some((r) => r.action === 'index_consent_revoked')).toBe(true);
  });
});
