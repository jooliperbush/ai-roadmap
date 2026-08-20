-- AnswerOps core schema. SQLite dialect; column shapes chosen to port cleanly to Postgres.
-- Every tenant-scoped table carries tenant_id as the first discriminator.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'audit',      -- audit | monitor | operate | enterprise
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',     -- owner | editor | viewer
  created_at    TEXT NOT NULL,
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brands (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  name          TEXT NOT NULL,
  domain        TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brands_tenant ON brands(tenant_id);

-- ---------------------------------------------------------------- entity graph
CREATE TABLE IF NOT EXISTS entities (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'organisation', -- organisation | product | person | publication
  domain        TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entities_tenant ON entities(tenant_id);

-- Typed edges. relation is NEVER inferred from co-occurrence alone; `basis` records why.
CREATE TABLE IF NOT EXISTS entity_relationships (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  brand_id      TEXT NOT NULL REFERENCES brands(id),
  entity_id     TEXT NOT NULL REFERENCES entities(id),
  relation      TEXT NOT NULL,   -- competitor|partner|parent|subsidiary|integration|publisher|review_site|unrelated_comention
  basis         TEXT NOT NULL,   -- customer_declared | market_registry | contract | observed_comention
  confidence    REAL NOT NULL DEFAULT 0.5,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  UNIQUE (tenant_id, brand_id, entity_id)
);

-- ------------------------------------------------------------- demand + intent
CREATE TABLE IF NOT EXISTS demand_signals (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  brand_id      TEXT NOT NULL REFERENCES brands(id),
  source        TEXT NOT NULL,   -- gsc|site_search|support_chat|sales_call|crm_loss|review_site|community
  question      TEXT NOT NULL,
  volume        INTEGER NOT NULL DEFAULT 1,
  geo           TEXT NOT NULL DEFAULT 'US',
  language      TEXT NOT NULL DEFAULT 'en',
  observed_at   TEXT NOT NULL,
  cluster_id    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_demand_tenant ON demand_signals(tenant_id, brand_id);

CREATE TABLE IF NOT EXISTS intent_clusters (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  brand_id        TEXT NOT NULL REFERENCES brands(id),
  label           TEXT NOT NULL,
  intent_family   TEXT NOT NULL,  -- see domain/intent.ts
  buyer_stage     TEXT NOT NULL,
  demand_volume   INTEGER NOT NULL DEFAULT 0,
  demand_weight   REAL NOT NULL DEFAULT 0,   -- normalised 0..1 within brand
  economic_value  REAL NOT NULL DEFAULT 0.5, -- customer supplied 0..1
  volatility      REAL NOT NULL DEFAULT 0.2,
  is_control      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clusters_tenant ON intent_clusters(tenant_id, brand_id);

CREATE TABLE IF NOT EXISTS prompt_variants (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  cluster_id    TEXT NOT NULL REFERENCES intent_clusters(id),
  prompt        TEXT NOT NULL,
  geo           TEXT NOT NULL DEFAULT 'US',
  language      TEXT NOT NULL DEFAULT 'en',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_variants_tenant ON prompt_variants(tenant_id, cluster_id);

-- ---------------------------------------------------------------- truth graph
CREATE TABLE IF NOT EXISTS truth_sources (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  brand_id      TEXT NOT NULL REFERENCES brands(id),
  title         TEXT NOT NULL,
  url           TEXT NOT NULL DEFAULT '',
  source_class  TEXT NOT NULL DEFAULT 'owned', -- owned|independent_credible|regulatory|contract
  published_at  TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_claims (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id),
  brand_id          TEXT NOT NULL REFERENCES brands(id),
  subject           TEXT NOT NULL,
  predicate         TEXT NOT NULL,
  object            TEXT NOT NULL,
  claim_text        TEXT NOT NULL,
  effective_from    TEXT NOT NULL,
  effective_to      TEXT,
  superseded_by_id  TEXT,
  source_id         TEXT REFERENCES truth_sources(id),
  sensitivity       TEXT NOT NULL DEFAULT 'routine', -- routine|material|regulated
  approved_by       TEXT,
  approved_at       TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_lookup ON canonical_claims(tenant_id, brand_id, subject, predicate);

-- --------------------------------------------------------------- observatory
CREATE TABLE IF NOT EXISTS model_runs (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id),
  brand_id           TEXT NOT NULL REFERENCES brands(id),
  cluster_id         TEXT NOT NULL REFERENCES intent_clusters(id),
  variant_id         TEXT NOT NULL REFERENCES prompt_variants(id),
  provider           TEXT NOT NULL,
  model_id           TEXT NOT NULL,
  model_version      TEXT NOT NULL,
  surface            TEXT NOT NULL,   -- api|consumer_app|search_product
  grounding          TEXT NOT NULL,   -- grounded_search|training_memory|hybrid
  search_mode        TEXT NOT NULL DEFAULT 'off',
  geo                TEXT NOT NULL,
  language           TEXT NOT NULL,
  personalization    TEXT NOT NULL DEFAULT 'logged_out',
  system_config_hash TEXT NOT NULL,
  temperature        REAL,
  seed               INTEGER,
  simulated          INTEGER NOT NULL DEFAULT 1,
  answer_text        TEXT NOT NULL,
  raw_response_ref   TEXT NOT NULL,
  search_queries     TEXT NOT NULL DEFAULT '[]',
  latency_ms         INTEGER NOT NULL DEFAULT 0,
  cost_usd           REAL NOT NULL DEFAULT 0,
  sampling_reason    TEXT NOT NULL DEFAULT 'scheduled',
  window_label       TEXT NOT NULL DEFAULT 'baseline',
  requested_at       TEXT NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_tenant ON model_runs(tenant_id, brand_id, cluster_id);
CREATE INDEX IF NOT EXISTS idx_runs_window ON model_runs(tenant_id, window_label);

CREATE TABLE IF NOT EXISTS observed_claims (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  run_id          TEXT NOT NULL REFERENCES model_runs(id),
  statement       TEXT NOT NULL,
  subject         TEXT NOT NULL,
  predicate       TEXT NOT NULL,
  object          TEXT NOT NULL,
  polarity        TEXT NOT NULL DEFAULT 'affirm',
  temporal_marker TEXT,
  brand_role      TEXT NOT NULL DEFAULT 'absent', -- absent|mentioned|compared|recommended|disrecommended
  verdict         TEXT NOT NULL,                  -- SUPPORTED|CONTRADICTED|STALE|UNSUPPORTED|UNVERIFIABLE|NOT_APPLICABLE
  canonical_claim_id TEXT,
  severity        TEXT NOT NULL DEFAULT 'low',    -- low|medium|high|critical
  misconception_key TEXT,
  adjudication    TEXT NOT NULL DEFAULT 'not_required', -- not_required|pending|agreed|disputed
  evaluator_votes TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_observed_run ON observed_claims(tenant_id, run_id);
CREATE INDEX IF NOT EXISTS idx_observed_misc ON observed_claims(tenant_id, misconception_key);

CREATE TABLE IF NOT EXISTS citations (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  run_id         TEXT NOT NULL REFERENCES model_runs(id),
  url            TEXT NOT NULL,
  title          TEXT NOT NULL DEFAULT '',
  source_class   TEXT NOT NULL DEFAULT 'unknown',
  support        TEXT NOT NULL DEFAULT 'absent', -- supports|contradicts|absent|unreachable|paywalled
  supported_claim_id TEXT,
  snapshot_ref   TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_citations_run ON citations(tenant_id, run_id);

-- ------------------------------------------------------------------- actions
CREATE TABLE IF NOT EXISTS actions (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  brand_id       TEXT NOT NULL REFERENCES brands(id),
  cluster_id     TEXT REFERENCES intent_clusters(id),
  action_type    TEXT NOT NULL,
  title          TEXT NOT NULL,
  rationale      TEXT NOT NULL,
  evidence       TEXT NOT NULL DEFAULT '[]',
  assumptions    TEXT NOT NULL DEFAULT '[]',
  expected_low   REAL,
  expected_high  REAL,
  expected_basis TEXT NOT NULL DEFAULT '',
  crawler_class  TEXT,
  priority       REAL NOT NULL DEFAULT 0,
  priority_factors TEXT NOT NULL DEFAULT '{}',
  state          TEXT NOT NULL DEFAULT 'detected',
  experiment_id  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actions_tenant ON actions(tenant_id, brand_id);

CREATE TABLE IF NOT EXISTS action_transitions (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  action_id    TEXT NOT NULL REFERENCES actions(id),
  from_state   TEXT NOT NULL,
  to_state     TEXT NOT NULL,
  actor        TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

-- --------------------------------------------------------------- experiments
CREATE TABLE IF NOT EXISTS experiments (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id),
  brand_id            TEXT NOT NULL REFERENCES brands(id),
  action_id           TEXT NOT NULL REFERENCES actions(id),
  metric              TEXT NOT NULL DEFAULT 'supported_citation_rate',
  treatment_clusters  TEXT NOT NULL DEFAULT '[]',
  control_clusters    TEXT NOT NULL DEFAULT '[]',
  baseline_window     TEXT NOT NULL DEFAULT 'baseline',
  post_window         TEXT NOT NULL DEFAULT 'post',
  published_at        TEXT,
  crawled_at          TEXT,
  indexed_at          TEXT,
  baseline_k          INTEGER,
  baseline_n          INTEGER,
  post_k              INTEGER,
  post_n              INTEGER,
  control_baseline_k  INTEGER,
  control_baseline_n  INTEGER,
  control_post_k      INTEGER,
  control_post_n      INTEGER,
  p_value             REAL,
  probability_real    REAL,
  did_effect          REAL,
  verdict             TEXT NOT NULL DEFAULT 'pending', -- pending|confirmed|rejected|inconclusive
  alternative_explanations TEXT NOT NULL DEFAULT '[]',
  created_at          TEXT NOT NULL,
  analyzed_at         TEXT
);

CREATE TABLE IF NOT EXISTS business_outcomes (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  brand_id      TEXT NOT NULL REFERENCES brands(id),
  experiment_id TEXT REFERENCES experiments(id),
  source        TEXT NOT NULL,   -- ga4|gsc|crm|self_reported
  metric        TEXT NOT NULL,
  baseline_value REAL NOT NULL,
  post_value     REAL NOT NULL,
  unit           TEXT NOT NULL DEFAULT 'sessions',
  interpretation TEXT NOT NULL DEFAULT 'correlational',
  caveat         TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);

-- ----------------------------------------------------------------- crawlers
CREATE TABLE IF NOT EXISTS crawler_events (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  brand_id      TEXT NOT NULL REFERENCES brands(id),
  user_agent    TEXT NOT NULL,
  bot_name      TEXT NOT NULL,
  bot_class     TEXT NOT NULL,   -- training|search_index|user_fetch|agent|unknown
  path          TEXT NOT NULL,
  status_code   INTEGER NOT NULL,
  blocked_by    TEXT NOT NULL DEFAULT '',
  occurred_at   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crawler_tenant ON crawler_events(tenant_id, brand_id);

-- ------------------------------------------------------------------- alerts
CREATE TABLE IF NOT EXISTS alerts (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  brand_id      TEXT NOT NULL REFERENCES brands(id),
  kind          TEXT NOT NULL,
  headline      TEXT NOT NULL,
  detail        TEXT NOT NULL DEFAULT '',
  p_value       REAL,
  effect        REAL,
  q_value       REAL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  actor         TEXT NOT NULL,
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id, created_at);
