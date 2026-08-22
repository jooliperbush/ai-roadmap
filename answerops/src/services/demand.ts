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
export function parseDemandCsv(text: string): { rows: ImportRow[]; rejected: Array<{ question: string; reason: string }> } {
  const rows: ImportRow[] = [];
  const rejected: Array<{ question: string; reason: string }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^source\s*,/i.test(line)) continue;
    const parts = splitCsvLine(line);
    const [source, question, volume, geo, language] = parts;
    if (!question || question.trim().length < 3) {
      rejected.push({ question: line, reason: 'No question text' });
      continue;
    }
    if (!source || !(DEMAND_SOURCES as readonly string[]).includes(source.trim())) {
      rejected.push({ question: question.trim(), reason: `Unknown source "${source ?? ''}" — demand must be attributable to where it came from` });
      continue;
    }
    rows.push({
      source: source.trim(),
      question: question.trim(),
      volume: volume ? Number(volume) || 1 : 1,
      geo: geo?.trim() || 'US',
      language: language?.trim() || 'en',
    });
  }
  return { rows, rejected };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
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
  const brandTerms = [brand.name, brand.domain.split('.')[0]];

  const inserted = rows.map((r) => repo.insertDemandSignal(db, tenantId, brandId, r));
  const clusters = clusterDemand(
    inserted.map((s) => ({ id: s.id, question: s.question, volume: s.volume })),
    brandTerms,
  );

  const totalVolume = clusters.reduce((acc, c) => acc + c.volume, 0) || 1;
  const familyBreakdown: Record<string, number> = {};
  let variantsCreated = 0;

  for (const c of clusters) {
    const created = repo.createCluster(db, tenantId, brandId, {
      label: c.label,
      intent_family: c.intentFamily,
      buyer_stage: c.buyerStage,
      demand_volume: c.volume,
      demand_weight: c.volume / totalVolume,
      economic_value: defaultEconomicValue(c.intentFamily),
      volatility: 0.3,
    });
    repo.attachSignalsToCluster(db, tenantId, created.id, c.memberIds);
    for (const prompt of promptVariantsFor(c.label, c.intentFamily)) {
      repo.createPromptVariant(db, tenantId, created.id, prompt);
      variantsCreated++;
    }
    familyBreakdown[c.intentFamily] = (familyBreakdown[c.intentFamily] ?? 0) + 1;
  }

  repo.audit(db, tenantId, actor, 'demand_import', 'brand', brandId, `${inserted.length} signals -> ${clusters.length} clusters`);

  return {
    signalsImported: inserted.length,
    clustersCreated: clusters.length,
    variantsCreated,
    familyBreakdown,
    rejected,
  };
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
  return map[family];
}

export function familyCounts(db: DB, tenantId: string, brandId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of INTENT_FAMILIES) out[f] = 0;
  for (const c of repo.listClusters(db, tenantId, brandId)) out[c.intent_family] = (out[c.intent_family] ?? 0) + 1;
  return out;
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
  repo.setClusterMarkets(db, tenantId, clusterId, geos, languages);

  const existing = repo.listVariants(db, tenantId, clusterId);
  const basePrompt = existing[0]?.prompt ?? cluster.label;
  const stripped = stripLocalePrefix(basePrompt);
  const wanted = fanout({ prompt: stripped, geos, languages });

  let created = 0;
  let kept = 0;
  for (const w of wanted) {
    const already = existing.find((v) => v.geo === w.geo && v.language === w.language);
    if (already) {
      kept++;
      continue;
    }
    repo.createPromptVariant(db, tenantId, clusterId, w.prompt, w.geo, w.language);
    created++;
  }
  return { created, kept };
}

export function stripLocalePrefix(prompt: string): string {
  for (const prefix of Object.values(LOCALISED_PREFIX)) {
    if (prefix && prompt.startsWith(prefix)) return prompt.slice(prefix.length);
  }
  return prompt;
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

export function marketBreakdown(db: DB, tenantId: string, brandId: string, windowLabel: string): MarketRate[] {
  const runs = repo.runsForWindow(db, tenantId, brandId, windowLabel);
  const observed = repo.observedForWindow(db, tenantId, brandId, windowLabel);
  const byMarket = new Map<string, MarketRate>();
  for (const r of runs) {
    const key = `${r.geo}|${r.language}`;
    const entry = byMarket.get(key) ?? {
      geo: r.geo, language: r.language, label: marketLabel(r.geo, r.language), runs: 0, defects: 0,
    };
    entry.runs++;
    const claims = observed.get(r.id) ?? [];
    if (claims.some((o) => o.verdict === 'CONTRADICTED' || o.verdict === 'STALE')) entry.defects++;
    byMarket.set(key, entry);
  }
  return [...byMarket.values()].sort((a, b) => b.runs - a.runs);
}
