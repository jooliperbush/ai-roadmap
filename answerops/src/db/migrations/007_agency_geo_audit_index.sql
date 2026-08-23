-- Phases 4, 6 and 8.
--
-- Per-brand roles (an agency's analyst may edit one client and only read another), geo and
-- language fan-out per cluster, the demand basis flag that keeps estimated demand out of
-- economic claims, the self-serve audit report, and index consent.

CREATE TABLE IF NOT EXISTS user_brand_roles (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  brand_id    TEXT NOT NULL REFERENCES brands(id),
  role        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_brand ON user_brand_roles(tenant_id, user_id, brand_id);

-- Fan-out. Existing clusters inherit US/en, which is what every run has been until now.
ALTER TABLE intent_clusters ADD COLUMN geos         TEXT NOT NULL DEFAULT '["US"]';
ALTER TABLE intent_clusters ADD COLUMN languages    TEXT NOT NULL DEFAULT '["en"]';
ALTER TABLE intent_clusters ADD COLUMN demand_basis TEXT NOT NULL DEFAULT 'imported';

-- The self-serve audit.
CREATE TABLE IF NOT EXISTS audit_reports (
  id            TEXT PRIMARY KEY,
  request_id    TEXT,
  token         TEXT NOT NULL,
  domain        TEXT NOT NULL,
  brand_name    TEXT NOT NULL DEFAULT '',
  tenant_id     TEXT,
  status        TEXT NOT NULL DEFAULT 'queued',
  findings      TEXT NOT NULL DEFAULT '{}',
  candidates    TEXT NOT NULL DEFAULT '[]',
  clusters      TEXT NOT NULL DEFAULT '[]',
  sample_size   INTEGER NOT NULL DEFAULT 0,
  surfaces      TEXT NOT NULL DEFAULT '[]',
  cost_usd      REAL NOT NULL DEFAULT 0,
  cost_known    INTEGER NOT NULL DEFAULT 1,
  powered_for   REAL,
  not_tested    TEXT NOT NULL DEFAULT '[]',
  error         TEXT,
  created_at    TEXT NOT NULL,
  completed_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_reports_token ON audit_reports(token);

ALTER TABLE audit_requests ADD COLUMN tenant_id TEXT;
ALTER TABLE audit_requests ADD COLUMN report_id TEXT;

-- The index. Default off, revocable, and the consent page names what leaves the tenant.
ALTER TABLE tenants ADD COLUMN index_consent      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN industry_category  TEXT NOT NULL DEFAULT 'unclassified';
ALTER TABLE tenants ADD COLUMN consent_changed_at TEXT;
