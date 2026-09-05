-- Aggregate anonymous launch events; no visitor IDs, URLs, emails or report tokens.
CREATE TABLE IF NOT EXISTS launch_counts (
  day TEXT NOT NULL,
  source TEXT NOT NULL,
  event TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source, event)
);
