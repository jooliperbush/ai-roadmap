-- Phase 2: the evidence locker.
--
-- Snapshots are content-addressed and NOT tenant-scoped. A snapshot is a copy of a public web
-- page keyed by the hash of its bytes; two tenants citing the same page share one row, which
-- is the point of content addressing. Nothing tenant-specific is stored on it. The link from a
-- tenant to a snapshot lives on `citations`, which is tenant-scoped.

CREATE TABLE IF NOT EXISTS snapshots (
  sha256        TEXT PRIMARY KEY,
  url           TEXT NOT NULL,
  body          TEXT NOT NULL,
  bytes         INTEGER NOT NULL DEFAULT 0,
  content_type  TEXT NOT NULL DEFAULT '',
  truncated     INTEGER NOT NULL DEFAULT 0,
  http_status   INTEGER,
  fetched_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_url ON snapshots(url);

ALTER TABLE citations ADD COLUMN snapshot_sha256    TEXT;
ALTER TABLE citations ADD COLUMN snapshot_fetched_at TEXT;
ALTER TABLE citations ADD COLUMN http_status        INTEGER;
ALTER TABLE citations ADD COLUMN fetch_error        TEXT;
ALTER TABLE citations ADD COLUMN checked_claim      TEXT NOT NULL DEFAULT '';
ALTER TABLE citations ADD COLUMN reason             TEXT NOT NULL DEFAULT '';
