-- When a public audit started, which is later than its request when the daily cap held it. The cap counts
-- starts in the last 24 hours. Until now every audit started when it was requested.
ALTER TABLE audit_reports ADD COLUMN started_at TEXT;
UPDATE audit_reports SET started_at = created_at WHERE status != 'queued';
