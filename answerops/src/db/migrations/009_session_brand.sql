-- Browser sessions keep independent workspace focus across processes and restarts.
ALTER TABLE sessions ADD COLUMN active_brand_id TEXT;
