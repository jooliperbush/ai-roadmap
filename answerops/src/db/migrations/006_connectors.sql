-- Phase 5: shipping the fix.
--
-- An action that reached a connector carries where it went and, if it failed, why. A failed
-- connector must never look like a shipped action, so the error lives on the row and the
-- state does not advance.

ALTER TABLE actions ADD COLUMN connector      TEXT;
ALTER TABLE actions ADD COLUMN external_ref   TEXT;
ALTER TABLE actions ADD COLUMN external_url   TEXT;
ALTER TABLE actions ADD COLUMN last_error     TEXT;
ALTER TABLE actions ADD COLUMN shipped_at     TEXT;
ALTER TABLE actions ADD COLUMN crawled_at     TEXT;

CREATE TABLE IF NOT EXISTS connector_configs (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  kind         TEXT NOT NULL,              -- github | webflow | wordpress
  target       TEXT NOT NULL,              -- owner/repo, site id, or base url
  token        TEXT NOT NULL DEFAULT '',
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connectors_tenant ON connector_configs(tenant_id);
