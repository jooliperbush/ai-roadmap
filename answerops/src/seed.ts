/**
 * Demo workspace seed.
 *
 * The seed does not fabricate a dashboard — it runs the real pipeline: import real-shaped
 * demand, approve a temporal truth registry, sample a baseline, ship one evidenced action,
 * sample again, and let the experiment analysis reach whatever verdict the numbers support.
 */

import type { DB } from './db/index.js';
import { hashPassword } from './db/index.js';
import * as repo from './db/repo/index.js';
import { importDemand, parseDemandCsv } from './services/demand.js';
import { runSamplingRound } from './services/observatory.js';
import { createAction, transitionAction, analyzeExperimentForAction, attachBusinessOutcome } from './services/actionEngine.js';
import { buildDashboard } from './services/dashboard.js';
import { classifyBot } from './domain/crawlers.js';
import { resolveRelation, Relation, RelationBasis } from './domain/entities.js';
import { CANONICAL_CLAIMS, CRAWLER_EVENTS, DEMAND_CSV, ENTITIES, VANAR_AFTER, VANAR_BEFORE } from '../seed/simulation.js';

export const DEMO_EMAIL = 'ops@vanar.example';
export const DEMO_PASSWORD = 'miscited-demo';
export const OTHER_EMAIL = 'rival@othertenant.example';
export const OTHER_PASSWORD = 'other-demo';

export interface SeedInfo {
  tenantId: string;
  brandId: string;
  email: string;
  password: string;
  otherTenantId: string;
}

export async function ensureSeed(db: DB): Promise<SeedInfo | null> {
  const existing = repo.findUserByEmail(db, DEMO_EMAIL);
  if (existing) {
    const brand = repo.primaryBrand(db, existing.tenant_id);
    const other = repo.findUserByEmail(db, OTHER_EMAIL);
    return {
      tenantId: existing.tenant_id,
      brandId: brand?.id ?? '',
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      otherTenantId: other?.tenant_id ?? '',
    };
  }
  return seed(db);
}

export async function seed(db: DB): Promise<SeedInfo> {
  const tenant = repo.createTenant(db, 'Vanar Foundation', 'operate');
  const pw = hashPassword(DEMO_PASSWORD);
  repo.createUser(db, tenant.id, DEMO_EMAIL, pw.hash, pw.salt, 'owner');
  const brand = repo.createBrand(db, tenant.id, 'Vanar', 'vanarchain.com', 'Layer-1 blockchain infrastructure');

  // A second tenant exists from the first minute so isolation is a property of the system,
  // not something remembered later.
  const other = repo.createTenant(db, 'Northwind Agency', 'monitor');
  const opw = hashPassword(OTHER_PASSWORD);
  repo.createUser(db, other.id, OTHER_EMAIL, opw.hash, opw.salt, 'owner');
  const otherBrand = repo.createBrand(db, other.id, 'Northwind', 'northwind.example', 'B2B data');
  repo.createCanonicalClaim(db, other.id, otherBrand.id, {
    subject: 'Northwind', predicate: 'pricing', object: '$99',
    claim_text: 'Northwind pricing starts at $99 per seat.',
    effective_from: '2025-01-01T00:00:00.000Z', sensitivity: 'routine', approved_by: OTHER_EMAIL,
  });

  // ---------------------------------------------------------------- demand
  const parsed = parseDemandCsv(DEMAND_CSV);
  importDemand(db, tenant.id, brand.id, parsed.rows, DEMO_EMAIL, parsed.rejected);

  // ----------------------------------------------------------------- truth
  const source = repo.createTruthSource(db, tenant.id, brand.id, {
    title: 'Vanar network documentation', url: 'https://vanarchain.com/docs', source_class: 'owned',
    published_at: '2025-01-15T00:00:00.000Z',
  });
  const createdByKey = new Map<string, repo.Row>();
  for (const c of CANONICAL_CLAIMS) {
    const row = repo.createCanonicalClaim(db, tenant.id, brand.id, {
      subject: c.subject, predicate: c.predicate, object: c.object, claim_text: c.claimText,
      effective_from: c.effectiveFrom, effective_to: c.effectiveTo ?? null,
      sensitivity: c.sensitivity, source_id: source.id, approved_by: DEMO_EMAIL,
    });
    createdByKey.set(`${c.predicate}:${c.object}`, row);
  }
  // Link the superseded intervals forward so the history view reads as a chain.
  link(db, tenant.id, createdByKey, 'acquired_by:Terra Virtua', 'acquired_by:Vanar Foundation');
  link(db, tenant.id, createdByKey, 'availability:Gate', 'availability:Coinbase');

  // -------------------------------------------------------------- entities
  for (const e of ENTITIES) {
    const entity = repo.upsertEntity(db, tenant.id, e.name, 'organisation', e.domain);
    const relation = resolveRelation(e.relation as Relation, e.basis as RelationBasis);
    repo.upsertRelationship(db, tenant.id, brand.id, entity.id, relation, e.basis, 0.95, e.note);
  }

  // -------------------------------------------------------------- crawlers
  const start = Date.parse('2026-08-01T00:00:00.000Z');
  CRAWLER_EVENTS.forEach((e, i) => {
    const cls = classifyBot(e.userAgent);
    for (let rep = 0; rep < 3; rep++) {
      repo.insertCrawlerEvent(db, tenant.id, {
        brand_id: brand.id, user_agent: e.userAgent, bot_name: cls.name, bot_class: cls.botClass,
        path: e.path, status_code: e.status, blocked_by: e.blockedBy,
        occurred_at: new Date(start + (i * 3 + rep) * 3600_000).toISOString(),
      });
    }
  });

  // ------------------------------------------------------ baseline sampling
  await runSamplingRound(db, {
    tenantId: tenant.id, brandId: brand.id, windowLabel: 'baseline', budget: 300,
    actor: DEMO_EMAIL, beliefs: VANAR_BEFORE, samplingReason: 'scheduled', seedOffset: 0,
  });

  // --------------------------------------------- ship one evidenced action
  const baselineDash = buildDashboard(db, tenant.id, brand.id);
  const top = baselineDash.defects[0];
  if (top) {
    const runs = repo.runsWithMisconception(db, tenant.id, brand.id, top.misconceptionKey, 'baseline');
    const evidence = runs
      .flatMap((r) => repo.observedForRun(db, tenant.id, r.id))
      .filter((o) => o.misconception_key === top.misconceptionKey)
      .map((o) => o.id)
      .slice(0, 8);

    const action = createAction(db, {
      tenantId: tenant.id, brandId: brand.id, clusterId: top.clusterIds[0] ?? null,
      treatmentClusterIds: top.clusterIds,
      actionType: 'update_owned_page',
      title: 'Publish a dated corrections page and update the fees and listings docs',
      rationale: top.headline,
      evidence,
      assumptions: [],
      misconceptionKey: top.misconceptionKey,
      grounding: 'grounded_search',
      actor: DEMO_EMAIL,
    });
    transitionAction(db, { tenantId: tenant.id, actionId: action.id, to: 'approved', actor: DEMO_EMAIL, note: 'Reviewed against the truth registry' });
    transitionAction(db, { tenantId: tenant.id, actionId: action.id, to: 'shipped', actor: DEMO_EMAIL, note: 'Published and submitted for recrawl' });

    // ---------------------------------------------------- post sampling
    await runSamplingRound(db, {
      tenantId: tenant.id, brandId: brand.id, windowLabel: 'post', budget: 300,
      actor: DEMO_EMAIL, beliefs: VANAR_AFTER, samplingReason: 'experiment_post', seedOffset: 500000,
    });

    const updated = repo.getAction(db, tenant.id, action.id)!;
    if (updated.experiment_id) {
      analyzeExperimentForAction(db, tenant.id, updated.experiment_id, DEMO_EMAIL);
      attachBusinessOutcome(db, tenant.id, brand.id, updated.experiment_id, {
        source: 'ga4', metric: 'assistant-referred sessions', baselineValue: 412, postValue: 566, unit: 'sessions',
      }, DEMO_EMAIL);
      attachBusinessOutcome(db, tenant.id, brand.id, updated.experiment_id, {
        source: 'self_reported', metric: '"How did you hear about us?" — AI assistant', baselineValue: 7, postValue: 14, unit: 'responses',
      }, DEMO_EMAIL);
    }
  }

  // A second, deliberately narrower intervention: scoped to a single comparison cluster so its
  // sibling clusters serve as matched controls. Its verdict is whatever the difference-in-
  // differences supports — including "inconclusive", which is the point of running controls.
  const comparison = repo.listClusters(db, tenant.id, brand.id).filter((c) => c.intent_family === 'comparison');
  if (comparison.length >= 2) {
    const target = comparison[0];
    const evidence = repo
      .runsForCluster(db, tenant.id, target.id, 'baseline')
      .flatMap((r) => repo.observedForRun(db, tenant.id, r.id))
      .map((o) => o.id)
      .slice(0, 5);
    if (evidence.length) {
      const action2 = createAction(db, {
        tenantId: tenant.id, brandId: brand.id, clusterId: target.id,
        treatmentClusterIds: [target.id],
        actionType: 'create_comparison_page',
        title: `Publish an evidenced comparison page for "${target.label}"`,
        rationale: 'Absent or thinly described in a high-intent comparison cluster, with matched sibling clusters held out as controls.',
        evidence, assumptions: [], misconceptionKey: null, grounding: 'grounded_search', actor: DEMO_EMAIL,
      });
      transitionAction(db, { tenantId: tenant.id, actionId: action2.id, to: 'approved', actor: DEMO_EMAIL, note: 'Scoped to one cluster with a matched holdout' });
      const shipped2 = transitionAction(db, { tenantId: tenant.id, actionId: action2.id, to: 'shipped', actor: DEMO_EMAIL, note: 'Published' });
      if (shipped2.experiment_id) analyzeExperimentForAction(db, tenant.id, shipped2.experiment_id, DEMO_EMAIL);
    }
  }

  return { tenantId: tenant.id, brandId: brand.id, email: DEMO_EMAIL, password: DEMO_PASSWORD, otherTenantId: other.id };
}

function link(db: DB, tenantId: string, map: Map<string, repo.Row>, oldKey: string, newKey: string): void {
  const oldRow = map.get(oldKey);
  const newRow = map.get(newKey);
  if (oldRow && newRow) repo.supersedeClaim(db, tenantId, oldRow.id, newRow.id, newRow.effective_from);
}
