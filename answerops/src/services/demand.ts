/**
 * Demand graph. Customers do not invent fifty prompts; they import the questions their
 * buyers already ask. Everything downstream inherits its weight from real volume, which is
 * what stops the product from measuring imaginary demand precisely.
 */

import type { DB } from '../db/index.js';
import * as repo from '../db/repo/index.js';
import { clusterDemand, promptVariantsFor, IntentFamily, INTENT_FAMILIES } from '../domain/intent.js';
import { fanout, LOCALISED_PREFIX, marketLabel } from '../domain/geo.js';

export const DEMAND_SOURCES = [
  'gsc',
  'site_search',
  'support_chat',
  'sales_call',
  'crm_loss',
  'review_site',
  'community',
] as const;

export type DemandSource = (typeof DEMAND_SOURCES)[number];

export const SOURCE_LABEL: Record<DemandSource, string> = {
  gsc: 'Google Search Console',
  site_search: 'Site search',
  support_chat: 'Support chat',
  sales_call: 'Sales call transcript',
  crm_loss: 'CRM loss reason',
  review_site: 'Review site',
  community: 'Public community',
};

export interface ImportRow {
  source: string;
  question: string;
  volume?: number;
  geo?: string;
  language?: string;
}

export interface ImportResult {
  signalsImported: number;
  clustersCreated: number;
  variantsCreated: number;
  familyBreakdown: Record<string, number>;
  rejected: Array<{ question: string; reason: string }>;
}

/** Parse the paste-a-CSV format the concierge audits actually use: source,question,volume */
export function parseDemandCsv(text: string): {
  rows: ImportRow[];
  rejected: Array<{ question: string; reason: string }>;
} {
  const result: ReturnType<typeof parseDemandCsv> = { rows: [], rejected: [] };
  const sources = new Set<string>(DEMAND_SOURCES);
  const records = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^source\s*,/i.test(line));
  for (const record of records) {
    const [source = '', question = '', volume, geo, language] = splitCsvLine(record);
    const error =
      question.length < 3
        ? { question: record, reason: 'No question text' }
        : !sources.has(source)
          ? {
              question,
              reason: `Unknown source "${source}" — demand must be attributable to where it came from`,
            }
          : null;
    if (error) result.rejected.push(error);
    else
      result.rows.push({
        source,
        question,
        volume: Number(volume) || 1,
        geo: geo || 'US',
        language: language || 'en',
      });
  }
  return result;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let text = '',
    quoted = false,
    quotePending = false;
  for (const character of line) {
    if (quotePending) {
      quotePending = false;
      if (character === '"') {
        text += character;
        continue;
      }
      quoted = false;
    }
    if (character === '"') {
      if (quoted) quotePending = true;
      else quoted = true;
    } else if (character === ',' && !quoted) {
      cells.push(text.trim());
      text = '';
    } else text += character;
  }
  cells.push(text.trim());
  return cells;
}

export function importDemand(
  db: DB,
  tenantId: string,
  brandId: string,
  rows: ImportRow[],
  actor: string,
  rejected: Array<{ question: string; reason: string }> = [],
): ImportResult {
  const brand = repo.getBrand(db, tenantId, brandId);
  if (!brand) throw new Error('brand not found');
  return db.transaction(() => {
    const signals = rows.map((row) => repo.insertDemandSignal(db, tenantId, brandId, row));
    const groups = clusterDemand(
      signals.map(({ id, question, volume }) => ({ id, question, volume })),
      [brand.name, brand.domain.split('.')[0]],
    );
    const volume = groups.reduce((sum, group) => sum + group.volume, 0) || 1;
    const result: ImportResult = {
      signalsImported: signals.length,
      clustersCreated: groups.length,
      variantsCreated: 0,
      familyBreakdown: {},
      rejected,
    };
    for (const group of groups) {
      const cluster = repo.createCluster(db, tenantId, brandId, {
        label: group.label,
        intent_family: group.intentFamily,
        buyer_stage: group.buyerStage,
        demand_volume: group.volume,
        demand_weight: group.volume / volume,
        economic_value: defaultEconomicValue(group.intentFamily),
        volatility: 0.3,
      });
      repo.attachSignalsToCluster(db, tenantId, cluster.id, group.memberIds);
      const prompts = promptVariantsFor(group.label, group.intentFamily);
      prompts.forEach((prompt) => repo.createPromptVariant(db, tenantId, cluster.id, prompt));
      result.variantsCreated += prompts.length;
      result.familyBreakdown[group.intentFamily] = (result.familyBreakdown[group.intentFamily] ?? 0) + 1;
    }
    repo.audit(
      db,
      tenantId,
      actor,
      'demand_import',
      'brand',
      brandId,
      `${signals.length} signals -> ${groups.length} clusters`,
    );
    return result;
  })();
}

/**
 * Default economic value by family — a starting point the customer is expected to override
 * with their own ACV weighting. Published rather than hidden, because it moves the ranking.
 */
function defaultEconomicValue(family: IntentFamily): number {
  const map: Record<IntentFamily, number> = {
    transactional: 0.9,
    comparison: 0.85,
    unaided_discovery: 0.7,
    factual: 0.6,
    branded_reputation: 0.65,
    support: 0.3,
    navigational: 0.2,
  };
  return Object.entries(map).find(([name]) => name === family)![1];
}

export function familyCounts(db: DB, tenantId: string, brandId: string): Record<string, number> {
  const counts = Object.fromEntries(INTENT_FAMILIES.map((family) => [family, 0]));
  const rows = db
    .prepare(
      'SELECT intent_family, COUNT(*) AS count FROM intent_clusters WHERE tenant_id = ? AND brand_id = ? GROUP BY intent_family',
    )
    .all(tenantId, brandId) as repo.Row[];
  for (const row of rows) counts[row.intent_family] = row.count;
  return counts;
}

// ------------------------------------------------------------------ markets (P6)

/**
 * Set the markets a cluster is sampled in, and sync its prompt variants to match.
 *
 * Variants are the unit the sampler actually draws from, so a market that has no variant is a
 * market that is never measured. Removing a market removes its future variants but leaves
 * every run already collected, because deleting history to tidy a config is how a time series
 * quietly becomes a lie.
 */
export function setMarkets(
  db: DB,
  tenantId: string,
  clusterId: string,
  geos: string[],
  languages: string[],
): { created: number; kept: number } {
  const cluster = repo.getCluster(db, tenantId, clusterId);
  if (!cluster) throw new Error('cluster not found');
  return db.transaction(() => {
    repo.setClusterMarkets(db, tenantId, clusterId, geos, languages);
    const variants = repo.listVariants(db, tenantId, clusterId);
    const locales = new Set(variants.map((v) => JSON.stringify([v.geo, v.language])));
    const desired = fanout({
      prompt: stripLocalePrefix(variants[0]?.prompt ?? cluster.label),
      geos,
      languages,
    });
    const counts = { created: 0, kept: 0 };
    for (const variant of desired) {
      if (locales.has(JSON.stringify([variant.geo, variant.language]))) counts.kept++;
      else {
        repo.createPromptVariant(db, tenantId, clusterId, variant.prompt, variant.geo, variant.language);
        counts.created++;
      }
    }
    return counts;
  })();
}

export function stripLocalePrefix(prompt: string): string {
  const prefix = Object.values(LOCALISED_PREFIX).find(
    (candidate) => candidate.length > 0 && prompt.startsWith(candidate),
  );
  return prompt.substring(prefix?.length ?? 0);
}

/**
 * Defect rates per market, never pooled. Two markets are two populations; an average across
 * them describes nobody, which is the same reason intent families are never blended.
 */
export interface MarketRate {
  geo: string;
  language: string;
  label: string;
  runs: number;
  defects: number;
}

export function marketBreakdown(
  db: DB,
  tenantId: string,
  brandId: string,
  windowLabel: string,
): MarketRate[] {
  const rows = db
    .prepare(
      `SELECT r.geo, r.language, COUNT(*) AS runs, SUM(EXISTS (
    SELECT 1 FROM observed_claims o WHERE o.run_id = r.id AND o.tenant_id = r.tenant_id
      AND o.verdict IN ('CONTRADICTED', 'STALE'))) AS defects FROM model_runs r
    WHERE r.tenant_id = ? AND r.brand_id = ? AND r.window_label = ? GROUP BY r.geo, r.language ORDER BY runs DESC`,
    )
    .all(tenantId, brandId, windowLabel) as Array<Omit<MarketRate, 'label'>>;
  return rows.map((row) => ({ ...row, label: marketLabel(row.geo, row.language) }));
}
