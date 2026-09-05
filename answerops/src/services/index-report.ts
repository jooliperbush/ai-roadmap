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
import { statements } from '../db/repo/statements.js';
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
  const quarter = ['Q1', 'Q2', 'Q3', 'Q4'][Math.floor(at.getUTCMonth() / 3)];
  return [at.getUTCFullYear(), quarter].join('-');
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
  return Object.hasOwn(PREDICATE_CLASS, predicate) ? PREDICATE_CLASS[predicate] : 'other';
}

/**
 * Rows for one tenant, only if that tenant consented. Deliberately returns the narrow shape:
 * there is no code path that carries a brand name or an answer out of here.
 */
export function indexRowsFor(db: DB, tenantId: string, quarter: string): IndexRow[] {
  const rows = statements(db)
    .prepare(
      `SELECT r.provider, r.model_version, o.predicate, o.verdict,
      COALESCE(t.industry_category, 'unclassified') AS industry_category
    FROM tenants t JOIN model_runs r ON r.tenant_id = t.id
    JOIN observed_claims o ON o.tenant_id = t.id AND o.run_id = r.id
    WHERE t.id = ? AND t.index_consent = 1 AND r.simulated = 0 AND o.predicate != 'brand_presence'`,
    )
    .all(tenantId) as Row[];
  return rows.map(({ provider, model_version, predicate, verdict, industry_category }) => ({
    provider,
    model_version,
    predicate_class: predicateClass(predicate),
    verdict,
    industry_category,
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
  const observations = db
    .prepare(
      `SELECT r.provider, r.model_version, o.predicate, o.verdict,
      t.id AS tenant_id, COALESCE(t.industry_category, 'unclassified') AS industry_category
    FROM tenants t JOIN model_runs r ON r.tenant_id = t.id
    JOIN observed_claims o ON o.run_id = r.id AND o.tenant_id = t.id
    WHERE t.index_consent = 1 AND r.simulated = 0 AND o.predicate != 'brand_presence'`,
    )
    .all() as Row[];
  const grouped = new Map<
    string,
    {
      dimensions: Pick<
        IndexCell,
        'provider' | 'modelVersion' | 'predicateClass' | 'industryCategory' | 'quarter'
      >;
      tenants: Set<string>;
      wrong: number;
      count: number;
    }
  >();
  for (const row of observations) {
    const dimensions = {
      provider: row.provider,
      modelVersion: row.model_version,
      predicateClass: predicateClass(row.predicate),
      industryCategory: row.industry_category,
      quarter,
    };
    const key = JSON.stringify(dimensions);
    let cell = grouped.get(key);
    if (!cell) {
      cell = { dimensions, tenants: new Set(), wrong: 0, count: 0 };
      grouped.set(key, cell);
    }
    cell.tenants.add(row.tenant_id);
    cell.count++;
    if (row.verdict === 'STALE' || row.verdict === 'CONTRADICTED') cell.wrong++;
  }
  return [...grouped.values()]
    .map((cell) => {
      const suppressed = cell.tenants.size < k;
      return {
        ...cell.dimensions,
        tenants: cell.tenants.size,
        suppressed,
        staleOrWrong: suppressed ? measure(0, 0) : measure(cell.wrong, cell.count),
      };
    })
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.predicateClass.localeCompare(b.predicateClass));
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
  const published: IndexCell[] = [];
  let suppressedCells = 0;
  for (const cell of cells) {
    if (cell.suppressed) suppressedCells++;
    else published.push(cell);
  }
  const participation = statements(db)
    .prepare('SELECT COUNT(*) AS count FROM tenants WHERE index_consent = 1')
    .get() as { count: number };
  return {
    quarter,
    cells,
    published,
    suppressedCells,
    consentingTenants: participation.count,
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
  db.transaction(() => {
    statements(db)
      .prepare('UPDATE tenants SET index_consent = @consent, consent_changed_at = @at WHERE id = @tenantId')
      .run({ consent: Number(consent), at, tenantId });
    const event = consent ? 'index_consent_granted' : 'index_consent_revoked';
    repo.audit(db, tenantId, 'owner', event, 'tenant', tenantId, '');
  })();
}
