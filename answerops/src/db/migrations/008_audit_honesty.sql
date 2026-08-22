-- The public audit report is the one page a stranger reads, and it was the one page that did
-- not say whether the sample came from a real model. Every run already carries a `simulated`
-- flag and the console shows it in three places; the report never read the column.
--
-- `simulated_runs` is stored on the report rather than counted at render time so a report is
-- self-describing: it says what it was even if the provisional workspace is later deleted.
--
-- `facts_read` records how many canonical candidates the site read produced. Zero facts means
-- no accuracy check was possible, which is a different statement from "no defects found", and
-- the report has to be able to tell them apart after the fact.

ALTER TABLE audit_reports ADD COLUMN simulated_runs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audit_reports ADD COLUMN facts_read     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audit_reports ADD COLUMN thin_pages     TEXT    NOT NULL DEFAULT '[]';
