-- Inbound requests for the free Answer Risk Audit, captured from the public page.
-- Deliberately not tenant-scoped: these arrive before a tenant exists.

CREATE TABLE IF NOT EXISTS audit_requests (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  domain        TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'public_site',
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_requests_created ON audit_requests(created_at);
