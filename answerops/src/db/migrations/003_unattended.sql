-- Phase 1: the loop runs itself.
-- Foundation columns first, then the scheduler, window ledger and delivery tables.

-- CSRF token per session. Same-site cookies cover a lot, but this app spends money from
-- form posts, so the token is not optional.
ALTER TABLE sessions ADD COLUMN csrf TEXT NOT NULL DEFAULT '';

-- Cost. `cost_usd` was NOT NULL DEFAULT 0, which made an unpriced run indistinguishable from
-- a free one. `cost_known = 0` means we do not know what this run cost, and it is excluded
-- from spend totals rather than counted as zero.
ALTER TABLE model_runs ADD COLUMN cost_known INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS schedules (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id),
  brand_id           TEXT NOT NULL REFERENCES brands(id),
  cadence            TEXT NOT NULL DEFAULT 'daily',    -- daily | weekly | manual
  hour_utc           INTEGER NOT NULL DEFAULT 6,
  timezone           TEXT NOT NULL DEFAULT 'UTC',
  monthly_budget_usd REAL NOT NULL DEFAULT 500,
  budget_runs        INTEGER NOT NULL DEFAULT 60,      -- runs per round before budget trimming
  surfaces           TEXT NOT NULL DEFAULT '[]',       -- [] means every available surface
  enabled            INTEGER NOT NULL DEFAULT 1,
  next_run_at        TEXT NOT NULL,
  lease_owner        TEXT,
  lease_expires_at   TEXT,
  last_run_at        TEXT,
  last_window_label  TEXT,
  last_error         TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_schedules_tenant ON schedules(tenant_id, brand_id);

-- A window is the unit a measurement belongs to. Knowing a window was incomplete is what
-- stops a half-collected day being used as an experiment baseline.
CREATE TABLE IF NOT EXISTS windows (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  brand_id      TEXT NOT NULL REFERENCES brands(id),
  window_label  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'complete',      -- complete | partial
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  planned_runs  INTEGER NOT NULL DEFAULT 0,
  actual_runs   INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL NOT NULL DEFAULT 0,
  cost_known    INTEGER NOT NULL DEFAULT 1,
  gaps          TEXT NOT NULL DEFAULT '[]',
  dropped       TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_windows_label ON windows(tenant_id, brand_id, window_label);

-- Alerts gain the fields that make a duplicate impossible to insert.
ALTER TABLE alerts ADD COLUMN window_label TEXT NOT NULL DEFAULT '';
ALTER TABLE alerts ADD COLUMN subject_key  TEXT NOT NULL DEFAULT '';
ALTER TABLE alerts ADD COLUMN severity     TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE alerts ADD COLUMN link         TEXT NOT NULL DEFAULT '';
ALTER TABLE alerts ADD COLUMN delivered_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_dedupe
  ON alerts(tenant_id, brand_id, window_label, kind, subject_key);
CREATE INDEX IF NOT EXISTS idx_alerts_tenant ON alerts(tenant_id, brand_id, created_at);

CREATE TABLE IF NOT EXISTS delivery_channels (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  kind          TEXT NOT NULL,                          -- email | slack | webhook
  target        TEXT NOT NULL,
  secret        TEXT NOT NULL DEFAULT '',
  enabled       INTEGER NOT NULL DEFAULT 1,
  min_severity  TEXT NOT NULL DEFAULT 'high',
  digest        INTEGER NOT NULL DEFAULT 1,
  state         TEXT NOT NULL DEFAULT 'ok',             -- ok | failing
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_channels_tenant ON delivery_channels(tenant_id);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  alert_id      TEXT,
  channel_id    TEXT NOT NULL REFERENCES delivery_channels(id),
  kind          TEXT NOT NULL DEFAULT 'alert',          -- alert | digest
  attempt       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL,                          -- sent | failed
  error         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_tenant ON delivery_attempts(tenant_id, created_at);
