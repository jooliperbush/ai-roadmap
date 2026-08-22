/**
 * Repository layer.
 *
 * Every function that touches a tenant-scoped table takes `tenantId` as its first argument
 * and includes a tenant_id predicate in its SQL. `tests/unit/tenancy.test.ts` enforces this
 * by static inspection of this file — a missing predicate is a build failure, not a bug
 * waiting to be found by a customer seeing another customer's data.
 */

import type { DB } from '../index.js';
import { id, nowIso, jsonParse } from '../index.js';

export interface Row {
  [k: string]: any;
}

// ---------------------------------------------------------------- tenants/users
export function createTenant(db: DB, name: string, plan = 'operate'): Row {
  const t = { id: id('ten'), name, plan, created_at: nowIso() };
  db.prepare('INSERT INTO tenants (id, name, plan, created_at) VALUES (@id, @name, @plan, @created_at)').run(t);
  return t;
}

/** Every tenant. Cross-tenant by necessity: the scheduler and digest jobs iterate them. */
export function listTenants(db: DB): Row[] {
  return db.prepare('SELECT * FROM tenants ORDER BY created_at').all() as Row[];
}

export function getTenant(db: DB, tenantId: string): Row | undefined {
  return db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId) as Row | undefined;
}

export function createUser(db: DB, tenantId: string, email: string, hash: string, salt: string, role = 'owner'): Row {
  const u = { id: id('usr'), tenant_id: tenantId, email: email.toLowerCase(), password_hash: hash, password_salt: salt, role, created_at: nowIso() };
  db.prepare(
    'INSERT INTO users (id, tenant_id, email, password_hash, password_salt, role, created_at) VALUES (@id, @tenant_id, @email, @password_hash, @password_salt, @role, @created_at)',
  ).run(u);
  return u;
}

export function findUserByEmail(db: DB, email: string): Row | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as Row | undefined;
}

export function createSession(db: DB, tenantId: string, userId: string, sessionId: string, ttlHours = 24, csrf = ''): Row {
  const s = {
    id: sessionId,
    tenant_id: tenantId,
    user_id: userId,
    csrf,
    created_at: nowIso(),
    expires_at: new Date(Date.now() + ttlHours * 3600_000).toISOString(),
  };
  db.prepare('INSERT INTO sessions (id, tenant_id, user_id, csrf, created_at, expires_at) VALUES (@id, @tenant_id, @user_id, @csrf, @created_at, @expires_at)').run(s);
  return s;
}

export function getSession(db: DB, sessionId: string): Row | undefined {
  const row = db
    .prepare('SELECT s.*, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?')
    .get(sessionId) as Row | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    deleteSession(db, sessionId);
    return undefined;
  }
  return row;
}

export function deleteSession(db: DB, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

// ---------------------------------------------------------------------- brands
export function createBrand(db: DB, tenantId: string, name: string, domain: string, category = ''): Row {
  const b = { id: id('brd'), tenant_id: tenantId, name, domain, category, created_at: nowIso() };
  db.prepare('INSERT INTO brands (id, tenant_id, name, domain, category, created_at) VALUES (@id, @tenant_id, @name, @domain, @category, @created_at)').run(b);
  return b;
}

export function listBrands(db: DB, tenantId: string): Row[] {
  return db.prepare('SELECT * FROM brands WHERE tenant_id = ? ORDER BY created_at').all(tenantId) as Row[];
}

export function getBrand(db: DB, tenantId: string, brandId: string): Row | undefined {
  return db.prepare('SELECT * FROM brands WHERE tenant_id = ? AND id = ?').get(tenantId, brandId) as Row | undefined;
}

export function primaryBrand(db: DB, tenantId: string): Row | undefined {
  return db.prepare('SELECT * FROM brands WHERE tenant_id = ? ORDER BY created_at LIMIT 1').get(tenantId) as Row | undefined;
}

// --------------------------------------------------------------------- demand
export function insertDemandSignal(db: DB, tenantId: string, brandId: string, s: Row): Row {
  const row = {
    id: id('dmd'),
    tenant_id: tenantId,
    brand_id: brandId,
    source: s.source,
    question: s.question,
    volume: s.volume ?? 1,
    geo: s.geo ?? 'US',
    language: s.language ?? 'en',
    observed_at: s.observed_at ?? nowIso(),
    cluster_id: null,
    created_at: nowIso(),
  };
  db.prepare(
    'INSERT INTO demand_signals (id, tenant_id, brand_id, source, question, volume, geo, language, observed_at, cluster_id, created_at) VALUES (@id, @tenant_id, @brand_id, @source, @question, @volume, @geo, @language, @observed_at, @cluster_id, @created_at)',
  ).run(row);
  return row;
}

export function listDemandSignals(db: DB, tenantId: string, brandId: string): Row[] {
  return db.prepare('SELECT * FROM demand_signals WHERE tenant_id = ? AND brand_id = ? ORDER BY volume DESC').all(tenantId, brandId) as Row[];
}

export function attachSignalsToCluster(db: DB, tenantId: string, clusterId: string, signalIds: string[]): void {
  const stmt = db.prepare('UPDATE demand_signals SET cluster_id = ? WHERE tenant_id = ? AND id = ?');
  for (const sid of signalIds) stmt.run(clusterId, tenantId, sid);
}

export function createCluster(db: DB, tenantId: string, brandId: string, c: Row): Row {
  const row = {
    id: id('clu'),
    tenant_id: tenantId,
    brand_id: brandId,
    label: c.label,
    intent_family: c.intent_family,
    buyer_stage: c.buyer_stage,
    demand_volume: c.demand_volume ?? 0,
    demand_weight: c.demand_weight ?? 0,
    economic_value: c.economic_value ?? 0.5,
    volatility: c.volatility ?? 0.2,
    is_control: c.is_control ?? 0,
    geos: c.geos ?? '["US"]',
    languages: c.languages ?? '["en"]',
    demand_basis: c.demand_basis ?? 'imported',
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO intent_clusters (id, tenant_id, brand_id, label, intent_family, buyer_stage, demand_volume,
      demand_weight, economic_value, volatility, is_control, geos, languages, demand_basis, created_at)
     VALUES (@id, @tenant_id, @brand_id, @label, @intent_family, @buyer_stage, @demand_volume,
      @demand_weight, @economic_value, @volatility, @is_control, @geos, @languages, @demand_basis, @created_at)`,
  ).run(row);
  return row;
}

/** Markets a cluster is sampled in. Empty or malformed falls back to US/en, never to nothing. */
export function setClusterMarkets(db: DB, tenantId: string, clusterId: string, geos: string[], languages: string[]): void {
  db.prepare('UPDATE intent_clusters SET geos = ?, languages = ? WHERE tenant_id = ? AND id = ?')
    .run(JSON.stringify(geos.length ? geos : ['US']), JSON.stringify(languages.length ? languages : ['en']), tenantId, clusterId);
}

export function listClusters(db: DB, tenantId: string, brandId: string): Row[] {
  return db
    .prepare('SELECT * FROM intent_clusters WHERE tenant_id = ? AND brand_id = ? ORDER BY demand_weight DESC, label')
    .all(tenantId, brandId) as Row[];
}

export function getCluster(db: DB, tenantId: string, clusterId: string): Row | undefined {
  return db.prepare('SELECT * FROM intent_clusters WHERE tenant_id = ? AND id = ?').get(tenantId, clusterId) as Row | undefined;
}

export function updateClusterWeights(db: DB, tenantId: string, clusterId: string, weight: number, volume: number): void {
  db.prepare('UPDATE intent_clusters SET demand_weight = ?, demand_volume = ? WHERE tenant_id = ? AND id = ?').run(weight, volume, tenantId, clusterId);
}

export function createPromptVariant(db: DB, tenantId: string, clusterId: string, prompt: string, geo = 'US', language = 'en'): Row {
  const row = { id: id('pvr'), tenant_id: tenantId, cluster_id: clusterId, prompt, geo, language, created_at: nowIso() };
  db.prepare('INSERT INTO prompt_variants (id, tenant_id, cluster_id, prompt, geo, language, created_at) VALUES (@id, @tenant_id, @cluster_id, @prompt, @geo, @language, @created_at)').run(row);
  return row;
}

export function listVariants(db: DB, tenantId: string, clusterId: string): Row[] {
  return db.prepare('SELECT * FROM prompt_variants WHERE tenant_id = ? AND cluster_id = ? ORDER BY created_at').all(tenantId, clusterId) as Row[];
}

// ---------------------------------------------------------------------- truth
export function createTruthSource(db: DB, tenantId: string, brandId: string, s: Row): Row {
  const row = {
    id: id('src'),
    tenant_id: tenantId,
    brand_id: brandId,
    title: s.title,
    url: s.url ?? '',
    source_class: s.source_class ?? 'owned',
    published_at: s.published_at ?? null,
    created_at: nowIso(),
  };
  db.prepare('INSERT INTO truth_sources (id, tenant_id, brand_id, title, url, source_class, published_at, created_at) VALUES (@id, @tenant_id, @brand_id, @title, @url, @source_class, @published_at, @created_at)').run(row);
  return row;
}

export function listTruthSources(db: DB, tenantId: string, brandId: string): Row[] {
  return db.prepare('SELECT * FROM truth_sources WHERE tenant_id = ? AND brand_id = ? ORDER BY created_at').all(tenantId, brandId) as Row[];
}

export function createCanonicalClaim(db: DB, tenantId: string, brandId: string, c: Row): Row {
  const row = {
    id: id('cla'),
    tenant_id: tenantId,
    brand_id: brandId,
    subject: c.subject,
    predicate: c.predicate,
    object: c.object,
    claim_text: c.claim_text,
    effective_from: c.effective_from,
    effective_to: c.effective_to ?? null,
    superseded_by_id: null,
    source_id: c.source_id ?? null,
    sensitivity: c.sensitivity ?? 'routine',
    approved_by: c.approved_by ?? null,
    approved_at: c.approved_by ? nowIso() : null,
    created_at: nowIso(),
  };
  db.prepare(
    'INSERT INTO canonical_claims (id, tenant_id, brand_id, subject, predicate, object, claim_text, effective_from, effective_to, superseded_by_id, source_id, sensitivity, approved_by, approved_at, created_at) VALUES (@id, @tenant_id, @brand_id, @subject, @predicate, @object, @claim_text, @effective_from, @effective_to, @superseded_by_id, @source_id, @sensitivity, @approved_by, @approved_at, @created_at)',
  ).run(row);
  return row;
}

export function listCanonicalClaims(db: DB, tenantId: string, brandId: string): Row[] {
  return db
    .prepare('SELECT * FROM canonical_claims WHERE tenant_id = ? AND brand_id = ? ORDER BY subject, predicate, effective_from DESC')
    .all(tenantId, brandId) as Row[];
}

export function getCanonicalClaim(db: DB, tenantId: string, claimId: string): Row | undefined {
  return db.prepare('SELECT * FROM canonical_claims WHERE tenant_id = ? AND id = ?').get(tenantId, claimId) as Row | undefined;
}

export function approveClaim(db: DB, tenantId: string, claimId: string, approver: string): void {
  db.prepare('UPDATE canonical_claims SET approved_by = ?, approved_at = ? WHERE tenant_id = ? AND id = ?').run(approver, nowIso(), tenantId, claimId);
}

/** Supersede: close the old interval and link forward. Nothing is ever deleted. */
export function supersedeClaim(db: DB, tenantId: string, oldClaimId: string, newClaimId: string, effectiveTo: string): void {
  db.prepare('UPDATE canonical_claims SET effective_to = ?, superseded_by_id = ? WHERE tenant_id = ? AND id = ?').run(effectiveTo, newClaimId, tenantId, oldClaimId);
}

// ------------------------------------------------------------------ model runs
export function insertRun(db: DB, tenantId: string, r: Row): Row {
  const row = { id: id('run'), tenant_id: tenantId, created_at: nowIso(), ...r };
  db.prepare(
    `INSERT INTO model_runs (id, tenant_id, brand_id, cluster_id, variant_id, provider, model_id, model_version, surface,
      grounding, search_mode, geo, language, personalization, system_config_hash, temperature, seed, simulated, answer_text,
      raw_response_ref, search_queries, latency_ms, cost_usd, sampling_reason, window_label, requested_at, created_at)
     VALUES (@id, @tenant_id, @brand_id, @cluster_id, @variant_id, @provider, @model_id, @model_version, @surface,
      @grounding, @search_mode, @geo, @language, @personalization, @system_config_hash, @temperature, @seed, @simulated, @answer_text,
      @raw_response_ref, @search_queries, @latency_ms, @cost_usd, @sampling_reason, @window_label, @requested_at, @created_at)`,
  ).run(row);
  return row;
}

export function listRuns(db: DB, tenantId: string, brandId: string, limit = 100): Row[] {
  return db
    .prepare('SELECT * FROM model_runs WHERE tenant_id = ? AND brand_id = ? ORDER BY requested_at DESC LIMIT ?')
    .all(tenantId, brandId, limit) as Row[];
}

export function getRun(db: DB, tenantId: string, runId: string): Row | undefined {
  return db.prepare('SELECT * FROM model_runs WHERE tenant_id = ? AND id = ?').get(tenantId, runId) as Row | undefined;
}

export function runsForCluster(db: DB, tenantId: string, clusterId: string, windowLabel?: string): Row[] {
  if (windowLabel) {
    return db
      .prepare('SELECT * FROM model_runs WHERE tenant_id = ? AND cluster_id = ? AND window_label = ? ORDER BY requested_at')
      .all(tenantId, clusterId, windowLabel) as Row[];
  }
  return db.prepare('SELECT * FROM model_runs WHERE tenant_id = ? AND cluster_id = ? ORDER BY requested_at').all(tenantId, clusterId) as Row[];
}

export function insertObservedClaim(db: DB, tenantId: string, o: Row): Row {
  const row = {
    id: id('obs'),
    tenant_id: tenantId,
    created_at: nowIso(),
    extractor_stage: 'pattern',
    extractor_version: 'v1',
    ...o,
  };
  db.prepare(
    `INSERT INTO observed_claims (id, tenant_id, run_id, statement, subject, predicate, object, polarity, temporal_marker,
      brand_role, verdict, canonical_claim_id, severity, misconception_key, adjudication, evaluator_votes,
      extractor_stage, extractor_version, created_at)
     VALUES (@id, @tenant_id, @run_id, @statement, @subject, @predicate, @object, @polarity, @temporal_marker,
      @brand_role, @verdict, @canonical_claim_id, @severity, @misconception_key, @adjudication, @evaluator_votes,
      @extractor_stage, @extractor_version, @created_at)`,
  ).run(row);
  return row;
}

export function observedForRun(db: DB, tenantId: string, runId: string): Row[] {
  return db.prepare('SELECT * FROM observed_claims WHERE tenant_id = ? AND run_id = ? ORDER BY created_at').all(tenantId, runId) as Row[];
}

export function insertCitation(db: DB, tenantId: string, c: Row): Row {
  const row = {
    id: id('cit'),
    tenant_id: tenantId,
    created_at: nowIso(),
    snapshot_sha256: null,
    snapshot_fetched_at: null,
    http_status: null,
    fetch_error: null,
    checked_claim: '',
    reason: '',
    ...c,
  };
  db.prepare(
    `INSERT INTO citations (id, tenant_id, run_id, url, title, source_class, support, supported_claim_id,
      snapshot_ref, snapshot_sha256, snapshot_fetched_at, http_status, fetch_error, checked_claim, reason, created_at)
     VALUES (@id, @tenant_id, @run_id, @url, @title, @source_class, @support, @supported_claim_id,
      @snapshot_ref, @snapshot_sha256, @snapshot_fetched_at, @http_status, @fetch_error, @checked_claim, @reason, @created_at)`,
  ).run(row);
  return row;
}

export function getCitation(db: DB, tenantId: string, citationId: string): Row | undefined {
  return db.prepare('SELECT * FROM citations WHERE tenant_id = ? AND id = ?').get(tenantId, citationId) as Row | undefined;
}

export function updateCitationCheck(db: DB, tenantId: string, citationId: string, patch: Row): void {
  db.prepare(
    `UPDATE citations SET support = @support, source_class = @source_class, reason = @reason,
        snapshot_sha256 = @snapshot_sha256, snapshot_fetched_at = @snapshot_fetched_at,
        http_status = @http_status, fetch_error = @fetch_error, checked_claim = @checked_claim
      WHERE tenant_id = @tenant_id AND id = @id`,
  ).run({ ...patch, tenant_id: tenantId, id: citationId });
}

/** Every citation in a window, in one statement, for the dashboard's query budget. */
export function citationsForWindow(db: DB, tenantId: string, brandId: string, windowLabel: string): Row[] {
  return db
    .prepare(
      `SELECT c.* FROM citations c JOIN model_runs r ON r.id = c.run_id AND r.tenant_id = c.tenant_id
        WHERE c.tenant_id = ? AND r.brand_id = ? AND r.window_label = ?`,
    )
    .all(tenantId, brandId, windowLabel) as Row[];
}

/**
 * Every observed claim in a window keyed by run. One statement instead of one per run, which
 * is the difference between a dashboard that works at 300 runs and one that works at 30,000.
 */
export function observedForWindow(db: DB, tenantId: string, brandId: string, windowLabel: string): Map<string, Row[]> {
  const rows = db
    .prepare(
      `SELECT o.* FROM observed_claims o JOIN model_runs r ON r.id = o.run_id AND r.tenant_id = o.tenant_id
        WHERE o.tenant_id = ? AND r.brand_id = ? AND r.window_label = ?
        ORDER BY o.created_at`,
    )
    .all(tenantId, brandId, windowLabel) as Row[];
  const byRun = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byRun.get(row.run_id) ?? [];
    list.push(row);
    byRun.set(row.run_id, list);
  }
  return byRun;
}

/** Every run in a window, in one statement. */
export function runsForWindow(db: DB, tenantId: string, brandId: string, windowLabel: string): Row[] {
  return db
    .prepare('SELECT * FROM model_runs WHERE tenant_id = ? AND brand_id = ? AND window_label = ? ORDER BY created_at')
    .all(tenantId, brandId, windowLabel) as Row[];
}

export function citationsForRun(db: DB, tenantId: string, runId: string): Row[] {
  return db.prepare('SELECT * FROM citations WHERE tenant_id = ? AND run_id = ? ORDER BY created_at').all(tenantId, runId) as Row[];
}

/*
 * `misconceptionRollup` lived here and used GROUP_CONCAT to return comma-joined provider and
 * cluster lists. It is gone for two reasons that turned out to be the same reason: it issued a
 * query per defect from the dashboard, and the comma delimiter was safe only because cluster
 * ids happen to contain no commas today. The rollup is now computed in memory from one
 * prefetched window in `services/dashboard.ts`.
 */

export function runCountForWindow(db: DB, tenantId: string, brandId: string, windowLabel: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM model_runs WHERE tenant_id = ? AND brand_id = ? AND window_label = ?')
    .get(tenantId, brandId, windowLabel) as Row;
  return row?.n ?? 0;
}

export function runsWithMisconception(db: DB, tenantId: string, brandId: string, misconceptionKey: string, windowLabel: string): Row[] {
  return db
    .prepare(
      `SELECT r.* FROM model_runs r
         JOIN observed_claims o ON o.run_id = r.id AND o.tenant_id = r.tenant_id
        WHERE r.tenant_id = ? AND r.brand_id = ? AND o.misconception_key = ? AND r.window_label = ?
        ORDER BY r.requested_at`,
    )
    .all(tenantId, brandId, misconceptionKey, windowLabel) as Row[];
}

// -------------------------------------------------------------------- actions
export function insertAction(db: DB, tenantId: string, a: Row): Row {
  const row = { id: id('act'), tenant_id: tenantId, created_at: nowIso(), updated_at: nowIso(), ...a };
  db.prepare(
    `INSERT INTO actions (id, tenant_id, brand_id, cluster_id, action_type, title, rationale, evidence, assumptions,
      expected_low, expected_high, expected_basis, crawler_class, priority, priority_factors, state, experiment_id, created_at, updated_at)
     VALUES (@id, @tenant_id, @brand_id, @cluster_id, @action_type, @title, @rationale, @evidence, @assumptions,
      @expected_low, @expected_high, @expected_basis, @crawler_class, @priority, @priority_factors, @state, @experiment_id, @created_at, @updated_at)`,
  ).run(row);
  return row;
}

export function listActions(db: DB, tenantId: string, brandId: string): Row[] {
  return db.prepare('SELECT * FROM actions WHERE tenant_id = ? AND brand_id = ? ORDER BY priority DESC, created_at DESC').all(tenantId, brandId) as Row[];
}

export function getAction(db: DB, tenantId: string, actionId: string): Row | undefined {
  return db.prepare('SELECT * FROM actions WHERE tenant_id = ? AND id = ?').get(tenantId, actionId) as Row | undefined;
}

export function setActionState(db: DB, tenantId: string, actionId: string, state: string): void {
  db.prepare('UPDATE actions SET state = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(state, nowIso(), tenantId, actionId);
}

export function setActionExperiment(db: DB, tenantId: string, actionId: string, experimentId: string): void {
  db.prepare('UPDATE actions SET experiment_id = ?, updated_at = ? WHERE tenant_id = ? AND id = ?').run(experimentId, nowIso(), tenantId, actionId);
}

export function insertTransition(db: DB, tenantId: string, actionId: string, from: string, to: string, actor: string, note = ''): Row {
  const row = { id: id('trn'), tenant_id: tenantId, action_id: actionId, from_state: from, to_state: to, actor, note, created_at: nowIso() };
  db.prepare('INSERT INTO action_transitions (id, tenant_id, action_id, from_state, to_state, actor, note, created_at) VALUES (@id, @tenant_id, @action_id, @from_state, @to_state, @actor, @note, @created_at)').run(row);
  return row;
}

export function listTransitions(db: DB, tenantId: string, actionId: string): Row[] {
  return db.prepare('SELECT * FROM action_transitions WHERE tenant_id = ? AND action_id = ? ORDER BY created_at').all(tenantId, actionId) as Row[];
}

// ---------------------------------------------------------------- experiments
export function insertExperiment(db: DB, tenantId: string, e: Row): Row {
  const row = { id: id('exp'), tenant_id: tenantId, created_at: nowIso(), analyzed_at: null, ...e };
  db.prepare(
    `INSERT INTO experiments (id, tenant_id, brand_id, action_id, metric, treatment_clusters, control_clusters, baseline_window,
      post_window, published_at, crawled_at, indexed_at, baseline_k, baseline_n, post_k, post_n, control_baseline_k, control_baseline_n,
      control_post_k, control_post_n, p_value, probability_real, did_effect, verdict, alternative_explanations, created_at, analyzed_at)
     VALUES (@id, @tenant_id, @brand_id, @action_id, @metric, @treatment_clusters, @control_clusters, @baseline_window,
      @post_window, @published_at, @crawled_at, @indexed_at, @baseline_k, @baseline_n, @post_k, @post_n, @control_baseline_k, @control_baseline_n,
      @control_post_k, @control_post_n, @p_value, @probability_real, @did_effect, @verdict, @alternative_explanations, @created_at, @analyzed_at)`,
  ).run(row);
  return row;
}

export function getExperiment(db: DB, tenantId: string, experimentId: string): Row | undefined {
  return db.prepare('SELECT * FROM experiments WHERE tenant_id = ? AND id = ?').get(tenantId, experimentId) as Row | undefined;
}

export function listExperiments(db: DB, tenantId: string, brandId: string): Row[] {
  return db.prepare('SELECT * FROM experiments WHERE tenant_id = ? AND brand_id = ? ORDER BY created_at DESC').all(tenantId, brandId) as Row[];
}

export function updateExperimentAnalysis(db: DB, tenantId: string, experimentId: string, patch: Row): void {
  db.prepare(
    `UPDATE experiments SET baseline_k=@baseline_k, baseline_n=@baseline_n, post_k=@post_k, post_n=@post_n,
      control_baseline_k=@control_baseline_k, control_baseline_n=@control_baseline_n, control_post_k=@control_post_k,
      control_post_n=@control_post_n, p_value=@p_value, probability_real=@probability_real, did_effect=@did_effect,
      verdict=@verdict, alternative_explanations=@alternative_explanations, crawled_at=@crawled_at, indexed_at=@indexed_at,
      analyzed_at=@analyzed_at WHERE tenant_id=@tenant_id AND id=@id`,
  ).run({ ...patch, tenant_id: tenantId, id: experimentId, analyzed_at: nowIso() });
}

export function insertBusinessOutcome(db: DB, tenantId: string, o: Row): Row {
  const row = { id: id('out'), tenant_id: tenantId, created_at: nowIso(), ...o };
  db.prepare(
    `INSERT INTO business_outcomes (id, tenant_id, brand_id, experiment_id, source, metric, baseline_value, post_value, unit, interpretation, caveat, created_at)
     VALUES (@id, @tenant_id, @brand_id, @experiment_id, @source, @metric, @baseline_value, @post_value, @unit, @interpretation, @caveat, @created_at)`,
  ).run(row);
  return row;
}

export function outcomesForExperiment(db: DB, tenantId: string, experimentId: string): Row[] {
  return db.prepare('SELECT * FROM business_outcomes WHERE tenant_id = ? AND experiment_id = ? ORDER BY created_at').all(tenantId, experimentId) as Row[];
}

// ------------------------------------------------------------------- crawlers
export function insertCrawlerEvent(db: DB, tenantId: string, e: Row): Row {
  const row = { id: id('crw'), tenant_id: tenantId, created_at: nowIso(), ...e };
  db.prepare(
    `INSERT INTO crawler_events (id, tenant_id, brand_id, user_agent, bot_name, bot_class, path, status_code, blocked_by, occurred_at, created_at)
     VALUES (@id, @tenant_id, @brand_id, @user_agent, @bot_name, @bot_class, @path, @status_code, @blocked_by, @occurred_at, @created_at)`,
  ).run(row);
  return row;
}

export function listCrawlerEvents(db: DB, tenantId: string, brandId: string, limit = 500): Row[] {
  return db.prepare('SELECT * FROM crawler_events WHERE tenant_id = ? AND brand_id = ? ORDER BY occurred_at DESC LIMIT ?').all(tenantId, brandId, limit) as Row[];
}

// ------------------------------------------------------------------- entities
export function upsertEntity(db: DB, tenantId: string, name: string, kind = 'organisation', domain: string | null = null): Row {
  const existing = db.prepare('SELECT * FROM entities WHERE tenant_id = ? AND name = ?').get(tenantId, name) as Row | undefined;
  if (existing) return existing;
  const row = { id: id('ent'), tenant_id: tenantId, name, kind, domain, created_at: nowIso() };
  db.prepare('INSERT INTO entities (id, tenant_id, name, kind, domain, created_at) VALUES (@id, @tenant_id, @name, @kind, @domain, @created_at)').run(row);
  return row;
}

export function upsertRelationship(db: DB, tenantId: string, brandId: string, entityId: string, relation: string, basis: string, confidence: number, note = ''): Row {
  const existing = db
    .prepare('SELECT * FROM entity_relationships WHERE tenant_id = ? AND brand_id = ? AND entity_id = ?')
    .get(tenantId, brandId, entityId) as Row | undefined;
  if (existing) {
    db.prepare('UPDATE entity_relationships SET relation = ?, basis = ?, confidence = ?, note = ? WHERE tenant_id = ? AND id = ?').run(
      relation, basis, confidence, note, tenantId, existing.id,
    );
    return { ...existing, relation, basis, confidence, note };
  }
  const row = { id: id('rel'), tenant_id: tenantId, brand_id: brandId, entity_id: entityId, relation, basis, confidence, note, created_at: nowIso() };
  db.prepare('INSERT INTO entity_relationships (id, tenant_id, brand_id, entity_id, relation, basis, confidence, note, created_at) VALUES (@id, @tenant_id, @brand_id, @entity_id, @relation, @basis, @confidence, @note, @created_at)').run(row);
  return row;
}

export function listRelationships(db: DB, tenantId: string, brandId: string): Row[] {
  return db
    .prepare(
      `SELECT r.*, e.name AS entity_name, e.domain AS entity_domain, e.kind AS entity_kind
         FROM entity_relationships r JOIN entities e ON e.id = r.entity_id AND e.tenant_id = r.tenant_id
        WHERE r.tenant_id = ? AND r.brand_id = ? ORDER BY r.relation, e.name`,
    )
    .all(tenantId, brandId) as Row[];
}

// --------------------------------------------------------------------- alerts
export function insertAlert(db: DB, tenantId: string, a: Row): Row {
  const row = { id: id('alt'), tenant_id: tenantId, created_at: nowIso(), ...a };
  db.prepare('INSERT INTO alerts (id, tenant_id, brand_id, kind, headline, detail, p_value, effect, q_value, created_at) VALUES (@id, @tenant_id, @brand_id, @kind, @headline, @detail, @p_value, @effect, @q_value, @created_at)').run(row);
  return row;
}

export function listAlerts(db: DB, tenantId: string, brandId: string): Row[] {
  return db.prepare('SELECT * FROM alerts WHERE tenant_id = ? AND brand_id = ? ORDER BY created_at DESC').all(tenantId, brandId) as Row[];
}

// ---------------------------------------------------------------------- audit
export function audit(db: DB, tenantId: string, actor: string, action: string, targetType: string, targetId: string, summary = ''): void {
  db.prepare('INSERT INTO audit_log (id, tenant_id, actor, action, target_type, target_id, summary, created_at) VALUES (@id, @tenant_id, @actor, @action, @target_type, @target_id, @summary, @created_at)').run({
    id: id('aud'), tenant_id: tenantId, actor, action, target_type: targetType, target_id: targetId, summary, created_at: nowIso(),
  });
}

export function listAudit(db: DB, tenantId: string, limit = 200): Row[] {
  return db.prepare('SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?').all(tenantId, limit) as Row[];
}

export { jsonParse };

/** Completeness of a sampling window, or undefined for windows recorded before the ledger. */
export function getWindowStatus(db: DB, tenantId: string, brandId: string, windowLabel: string): Row | undefined {
  return db
    .prepare('SELECT * FROM windows WHERE tenant_id = ? AND brand_id = ? AND window_label = ?')
    .get(tenantId, brandId, windowLabel) as Row | undefined;
}

// -------------------------------------------------------------- connectors (P5)

export function setActionConnector(db: DB, tenantId: string, actionId: string, patch: Row): void {
  db.prepare(
    `UPDATE actions SET connector = @connector, external_ref = @external_ref, external_url = @external_url,
        last_error = @last_error, updated_at = @updated_at
      WHERE tenant_id = @tenant_id AND id = @id`,
  ).run({ ...patch, tenant_id: tenantId, id: actionId, updated_at: nowIso() });
}

export function setActionShipped(db: DB, tenantId: string, actionId: string, at: string): void {
  db.prepare('UPDATE actions SET shipped_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
    .run(at, nowIso(), tenantId, actionId);
}

export function setActionCrawled(db: DB, tenantId: string, actionId: string, at: string): void {
  db.prepare('UPDATE actions SET crawled_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?')
    .run(at, nowIso(), tenantId, actionId);
}

/** Crawler hits of a given class since a timestamp — the gate between shipped and crawled. */
export function crawlerEventsSince(db: DB, tenantId: string, brandId: string, botClass: string, sinceIso: string): Row[] {
  return db
    .prepare(
      `SELECT * FROM crawler_events WHERE tenant_id = ? AND brand_id = ? AND bot_class = ? AND occurred_at >= ?
        ORDER BY occurred_at`,
    )
    .all(tenantId, brandId, botClass, sinceIso) as Row[];
}
