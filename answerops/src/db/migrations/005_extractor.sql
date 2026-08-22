-- Phase 3: two-stage extraction. Which layer proposed a claim, and which version of it,
-- so a recall regression is attributable and a model-proposed predicate can be suppressed
-- from alerting without suppressing the pattern layer underneath it.

ALTER TABLE observed_claims ADD COLUMN extractor_stage   TEXT NOT NULL DEFAULT 'pattern';
ALTER TABLE observed_claims ADD COLUMN extractor_version TEXT NOT NULL DEFAULT 'v1';
CREATE INDEX IF NOT EXISTS idx_observed_stage ON observed_claims(tenant_id, extractor_stage);
