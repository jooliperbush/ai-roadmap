/**
 * The AI Brand Accuracy Index.
 *
 * Every run this system stores carries model, version, surface, grounding, geo and a verified
 * verdict. Aggregated across customers and stripped of attribution, that is the one asset a
 * competitor cannot copy by shipping features: which models produce the most stale or
 * unsupported company claims, by category, over time.
 *
 * Three constraints, in this order, and none of them is negotiable:
 *   1. Consent is per tenant, default off, and revocable.
 *   2. Nothing that could identify a customer crosses the boundary. Not brand names, not
 *      cluster labels, not answer text. The export schema has no free-text column and a test
 *      asserts it.
 *   3. No published cell is built from fewer than five tenants.
 */

import type { DB } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import type { Row } from '../db/repo/index.js';
import { measure, type Measurement } from '../domain/stats.js';

export const K_ANON = 5;

/** The complete list of fields that leave a tenant. Anything not here does not go. */
export const EXPORT_FIELDS = [
  'provider',
  'model_version',
  'predicate_class',
  'verdict',
  'industry_category',
  'quarter',
] as const;

export type ExportField = (typeof EXPORT_FIELDS)[number];

export interface IndexRow {
  provider: string;
  model_version: string;
  predicate_class: string;
  verdict: string;
  industry_category: string;
  quarter: string;
}

export function quarterOf(at: Date): string {
  return `${at.getUTCFullYear()}-Q${Math.floor(at.getUTCMonth() / 3) + 1}`;
}

/**
 * Predicate class, not predicate. "acquired_by" is a fact about a company; grouping it with
 * "ceo" and "headquarters" as `corporate` keeps a rare predicate from acting as a fingerprint
 * for the one customer who tracks it.
 */
export const PREDICATE_CLASS: Record<string, string> = {
  acquired_by: 'corporate',
  ceo: 'corporate',
  headquarters: 'corporate',
  founded_year: 'corporate',
  employee_count: 'corporate',
  funding: 'corporate',
  pricing: 'commercial',
  fees: 'commercial',
  availability: 'commercial',
  product_status: 'product',
  feature_support: 'product',
  integration: 'product',
  token_supply: 'product',
  compliance: 'trust',
  certification: 'trust',
  partnership: 'relationships',
};

export function predicateClass(predicate: string): string {
  return PREDICATE_CLASS[predicate] ?? 'other';
}

/**
 * Rows for one tenant, only if that tenant consented. Deliberately returns the narrow shape:
 * there is no code path that carries a brand name or an answer out of here.
 */
export function indexRowsFor(db: DB, tenantId: string, quarter: string): IndexRow[] {
  const tenant = repo.getTenant(db, tenantId);
  if (!tenant || tenant.index_consent !== 1) return [];
  const rows = db
    .prepare(
      `SELECT r.provider AS provider, r.model_version AS model_version, o.predicate AS predicate, o.verdict AS verdict
         FROM observed_claims o JOIN model_runs r ON r.id = o.run_id AND r.tenant_id = o.tenant_id
        WHERE o.tenant_id = ? AND r.simulated = 0 AND o.predicate != 'brand_presence'`,
    )
    .all(tenantId) as Row[];
  return rows.map((r) => ({
    provider: r.provider,
    model_version: r.model_version,
    predicate_class: predicateClass(r.predicate),
    verdict: r.verdict,
    industry_category: tenant.industry_category ?? 'unclassified',
    quarter,
  }));
}

export interface IndexCell {
  provider: string;
  modelVersion: string;
  predicateClass: string;
  industryCategory: string;
  quarter: string;
  tenants: number;
  staleOrWrong: Measurement;
  suppressed: boolean;
}

/**
 * Aggregate across consenting tenants and suppress any cell built from fewer than K_ANON of
 * them. A suppressed cell keeps its shape so the reader can see that something was withheld,
 * which is a different and more honest thing than an absent row.
 */
export function buildIndex(db: DB, quarter: string, k = K_ANON): IndexCell[] {
  const perCell = new Map<string, { k: number; n: number; tenants: Set<string> }>();
  for (const tenant of repo.listTenants(db)) {
    const rows = indexRowsFor(db, tenant.id, quarter);
    for (const r of rows) {
      const key = [r.provider, r.model_version, r.predicate_class, r.industry_category, r.quarter].join('|');
      const cell = perCell.get(key) ?? { k: 0, n: 0, tenants: new Set<string>() };
      cell.n++;
      if (r.verdict === 'STALE' || r.verdict === 'CONTRADICTED') cell.k++;
      cell.tenants.add(tenant.id);
      perCell.set(key, cell);
    }
  }
  const out: IndexCell[] = [];
  for (const [key, cell] of perCell) {
    const [provider, modelVersion, pClass, industry, q] = key.split('|');
    const suppressed = cell.tenants.size < k;
    out.push({
      provider,
      modelVersion,
      predicateClass: pClass,
      industryCategory: industry,
      quarter: q,
      tenants: cell.tenants.size,
      staleOrWrong: suppressed ? measure(0, 0) : measure(cell.k, cell.n),
      suppressed,
    });
  }
  return out.sort((a, b) => a.provider.localeCompare(b.provider) || a.predicateClass.localeCompare(b.predicateClass));
}

export interface IndexReport {
  quarter: string;
  cells: IndexCell[];
  published: IndexCell[];
  suppressedCells: number;
  consentingTenants: number;
  methodology: string[];
}

export function buildIndexReport(db: DB, quarter: string, k = K_ANON): IndexReport {
  const cells = buildIndex(db, quarter, k);
  const consenting = repo.listTenants(db).filter((t) => t.index_consent === 1).length;
  return {
    quarter,
    cells,
    published: cells.filter((c) => !c.suppressed),
    suppressedCells: cells.filter((c) => c.suppressed).length,
    consentingTenants: consenting,
    methodology: [
      `Cells built from fewer than ${k} distinct consenting workspaces are suppressed, not estimated.`,
      'Only live runs count. Simulated runs are excluded from every figure here.',
      `The exported fields are exactly: ${EXPORT_FIELDS.join(', ')}. No brand name, cluster label or answer text leaves a workspace.`,
      'Predicates are grouped into classes so a rare predicate cannot act as a fingerprint for one participant.',
      "Verdicts come from each workspace's own approved truth registry, so this measures agreement with the subject's own record, not with ours.",
      'Participation is opt-in, default off, and revocable at any time from the workspace settings.',
    ],
  };
}

export function setConsent(db: DB, tenantId: string, consent: boolean, at: string): void {
  db.prepare('UPDATE tenants SET index_consent = ?, consent_changed_at = ? WHERE id = ?')
    .run(consent ? 1 : 0, at, tenantId);
  repo.audit(db, tenantId, 'owner', consent ? 'index_consent_granted' : 'index_consent_revoked', 'tenant', tenantId, '');
}
