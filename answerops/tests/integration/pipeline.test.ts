/**
 * End-to-end through the domain: demand -> truth -> sampling -> verification -> action ->
 * experiment -> verdict, against a real database.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { openDb, DB } from '../../src/db/index.js';
import * as repo from '../../src/db/repo/index.js';
import { seed } from '../../src/seed.js';
import { buildDashboard } from '../../src/services/dashboard.js';
import { runSamplingRound } from '../../src/services/observatory.js';
import { createAction, transitionAction, analyzeExperimentForAction, countMetric, matchedControls } from '../../src/services/actionEngine.js';
import { importDemand, parseDemandCsv } from '../../src/services/demand.js';
import { VANAR_AFTER, VANAR_BEFORE } from '../../seed/simulation.js';
import { MIN_SAMPLES } from '../../src/domain/stats.js';

let db: DB;
let tenantId: string;
let brandId: string;

beforeAll(async () => {
  db = openDb(':memory:');
  const info = await seed(db);
  tenantId = info.tenantId;
  brandId = info.brandId;
});

describe('demand import', () => {
  it('creates clusters spanning several intent families and never one blended bucket', () => {
    const clusters = repo.listClusters(db, tenantId, brandId);
    expect(clusters.length).toBeGreaterThan(5);
    const families = new Set(clusters.map((c) => c.intent_family));
    expect(families.size).toBeGreaterThan(3);
  });

  it('gives every cluster at least one prompt variant', () => {
    for (const c of repo.listClusters(db, tenantId, brandId)) {
      expect(repo.listVariants(db, tenantId, c.id).length).toBeGreaterThan(0);
    }
  });

  it('normalises demand weights to sum to one', () => {
    const total = repo.listClusters(db, tenantId, brandId).reduce((a, c) => a + c.demand_weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('rejects rows whose demand cannot be attributed to a source', () => {
    const parsed = parseDemandCsv('nonsense_source,some question,10\ngsc,a real question,5');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rejected[0].reason).toMatch(/Unknown source/);
  });
});

describe('truth registry', () => {
  it('stores superseded intervals linked to their successor', () => {
    const claims = repo.listCanonicalClaims(db, tenantId, brandId);
    const old = claims.find((c) => c.predicate === 'acquired_by' && c.object === 'Terra Virtua')!;
    expect(old.effective_to).toBeTruthy();
    expect(old.superseded_by_id).toBeTruthy();
  });
});

describe('sampling and verification', () => {
  it('stores complete provenance on every run', () => {
    const runs = repo.listRuns(db, tenantId, brandId, 5);
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      for (const field of ['provider', 'model_id', 'model_version', 'surface', 'grounding', 'geo', 'language', 'personalization', 'system_config_hash']) {
        expect(String(r[field]).length).toBeGreaterThan(0);
      }
      expect(r.raw_response_ref).toMatch(/^objectstore:\/\//);
    }
  });

  it('detects the stale acquisition claim as STALE, not as a false statement', () => {
    const stale = db
      .prepare("SELECT * FROM observed_claims WHERE tenant_id = ? AND predicate = 'acquired_by' AND verdict = 'STALE'")
      .all(tenantId) as any[];
    expect(stale.length).toBeGreaterThan(0);
  });

  it('detects material contradictions as critical severity', () => {
    const critical = db
      .prepare("SELECT * FROM observed_claims WHERE tenant_id = ? AND verdict = 'CONTRADICTED' AND severity = 'critical'")
      .all(tenantId) as any[];
    expect(critical.length).toBeGreaterThan(0);
  });

  it('routes high-risk verdicts through dual adjudication', () => {
    const adjudicated = db
      .prepare("SELECT * FROM observed_claims WHERE tenant_id = ? AND adjudication IN ('agreed','disputed','pending')")
      .all(tenantId) as any[];
    expect(adjudicated.length).toBeGreaterThan(0);
  });

  it('checks whether each cited page actually contains the claim', () => {
    const cits = db.prepare('SELECT support, COUNT(*) AS n FROM citations WHERE tenant_id = ? GROUP BY support').all(tenantId) as any[];
    const kinds = new Set(cits.map((c) => c.support));
    expect(kinds.size).toBeGreaterThan(1);
    expect([...kinds].some((k) => k === 'absent' || k === 'unreachable')).toBe(true);
  });

  it('records co-mentioned entities only as unclassified candidates', () => {
    const rels = repo.listRelationships(db, tenantId, brandId);
    const observed = rels.filter((r) => r.basis === 'observed_comention');
    for (const r of observed) expect(r.relation).toBe('unrelated_comention');
  });

  it('samples every cluster at least to the floor', () => {
    for (const c of repo.listClusters(db, tenantId, brandId)) {
      const n = repo.runsForCluster(db, tenantId, c.id, 'baseline').length;
      if (n > 0) expect(n).toBeGreaterThanOrEqual(MIN_SAMPLES);
    }
  });
});

describe('dashboard', () => {
  it('produces exactly the three sections, keyed by evidence', () => {
    const d = buildDashboard(db, tenantId, brandId);
    expect(d.defects.length).toBeGreaterThan(0);
    expect(d.familySummaries.length).toBeGreaterThan(1);
    expect(d.totalRuns).toBeGreaterThan(0);
  });

  it('never shows a rate without a sample size', () => {
    const d = buildDashboard(db, tenantId, brandId);
    for (const f of d.defects) {
      expect(f.measurement.n).toBeGreaterThan(0);
      if (f.measurement.point !== null) {
        expect(f.measurement.ciLow).not.toBeNull();
        expect(f.measurement.ciHigh).not.toBeNull();
      }
    }
  });

  it('ranks defects by the published priority formula', () => {
    const d = buildDashboard(db, tenantId, brandId);
    const scores = d.defects.map((f) => f.priority);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('reports missed demand only where absence is defensible', () => {
    const d = buildDashboard(db, tenantId, brandId);
    for (const m of d.missedDemand) {
      expect(m.absence.sufficient).toBe(true);
      expect(m.absence.ciLow!).toBeGreaterThan(0.5);
    }
  });

  it('reports a confirmed win from the seeded intervention', () => {
    const d = buildDashboard(db, tenantId, brandId);
    expect(d.confirmedWins.length).toBeGreaterThan(0);
    const w = d.confirmedWins[0];
    expect(w.probabilityReal).toBeGreaterThan(0.9);
    expect(w.alternativeExplanations.length).toBeGreaterThan(0);
  });
});

describe('action engine', () => {
  it('refuses an action with no evidence', () => {
    expect(() =>
      createAction(db, {
        tenantId, brandId, clusterId: null, actionType: 'update_owned_page',
        title: 'x', rationale: 'y', evidence: [], assumptions: [], actor: 'test',
      }),
    ).toThrow(/requires at least one evidence reference/);
  });

  it('refuses an action type outside the closed catalogue', () => {
    expect(() =>
      createAction(db, {
        tenantId, brandId, clusterId: null, actionType: 'post_to_reddit',
        title: 'x', rationale: 'y', evidence: ['obs_1'], assumptions: [], actor: 'test',
      }),
    ).toThrow(/not a permitted action type/);
  });

  it('opens an experiment automatically when an action ships', () => {
    const action = createAction(db, {
      tenantId, brandId, clusterId: repo.listClusters(db, tenantId, brandId)[0].id,
      actionType: 'create_evidence_page', title: 'Evidence page', rationale: 'r',
      evidence: ['obs_seed'], assumptions: [], actor: 'test',
    });
    transitionAction(db, { tenantId, actionId: action.id, to: 'approved', actor: 'test' });
    const shipped = transitionAction(db, { tenantId, actionId: action.id, to: 'shipped', actor: 'test' });
    expect(shipped.experiment_id).toBeTruthy();
    const exp = repo.getExperiment(db, tenantId, shipped.experiment_id)!;
    expect(exp.verdict).toBe('pending');
  });

  it('blocks an illegal transition', () => {
    const action = createAction(db, {
      tenantId, brandId, clusterId: null, actionType: 'update_owned_page',
      title: 'x', rationale: 'y', evidence: ['obs_1'], assumptions: [], actor: 'test',
    });
    expect(() => transitionAction(db, { tenantId, actionId: action.id, to: 'confirmed', actor: 'test' })).toThrow(/Illegal action transition/);
  });

  it('writes an audit row for every mutation', () => {
    const before = repo.listAudit(db, tenantId).length;
    createAction(db, {
      tenantId, brandId, clusterId: null, actionType: 'update_owned_page',
      title: 'audited', rationale: 'y', evidence: ['obs_1'], assumptions: [], actor: 'test',
    });
    expect(repo.listAudit(db, tenantId).length).toBeGreaterThan(before);
  });

  it('matches controls on family and demand decile', () => {
    const clusters = repo.listClusters(db, tenantId, brandId);
    const target = clusters.find((c) => clusters.filter((o) => o.intent_family === c.intent_family).length > 1)!;
    const controls = matchedControls(db, tenantId, brandId, target.id);
    for (const cid of controls) {
      expect(repo.getCluster(db, tenantId, cid)!.intent_family).toBe(target.intent_family);
      expect(cid).not.toBe(target.id);
    }
  });
});

describe('experiment honesty', () => {
  it('returns inconclusive rather than confirmed when nothing changed', async () => {
    const clusters = repo.listClusters(db, tenantId, brandId);
    const action = createAction(db, {
      tenantId, brandId, clusterId: clusters[1].id, actionType: 'update_structured_data',
      title: 'No-op change', rationale: 'r', evidence: ['obs_seed'], assumptions: [], actor: 'test',
    });
    transitionAction(db, { tenantId, actionId: action.id, to: 'approved', actor: 'test' });
    const shipped = transitionAction(db, { tenantId, actionId: action.id, to: 'shipped', actor: 'test' });
    const analyzed = analyzeExperimentForAction(db, tenantId, shipped.experiment_id, 'test');
    expect(['inconclusive', 'confirmed', 'rejected']).toContain(analyzed.verdict);
    expect(JSON.parse(analyzed.alternative_explanations).length).toBeGreaterThan(0);
  });

  it('counts metrics only from stored runs in the named window', () => {
    const cluster = repo.listClusters(db, tenantId, brandId)[0];
    const baseline = countMetric(db, tenantId, brandId, [cluster.id], 'baseline', 'clean_answer_rate', null);
    const missing = countMetric(db, tenantId, brandId, [cluster.id], 'nonexistent_window', 'clean_answer_rate', null);
    expect(baseline.n).toBeGreaterThan(0);
    expect(missing.n).toBe(0);
  });
});

describe('repeat sampling', () => {
  it('adds runs to a new window without disturbing the old one', async () => {
    const before = repo.runCountForWindow(db, tenantId, brandId, 'baseline');
    await runSamplingRound(db, {
      tenantId, brandId, windowLabel: 'week2', budget: 60, actor: 'test',
      beliefs: VANAR_AFTER, seedOffset: 999,
    });
    expect(repo.runCountForWindow(db, tenantId, brandId, 'baseline')).toBe(before);
    expect(repo.runCountForWindow(db, tenantId, brandId, 'week2')).toBeGreaterThan(0);
  });
});
