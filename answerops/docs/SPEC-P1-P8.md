# Miscited — Specification for Phases 1 to 8

**Status:** contract for the build. Every numbered requirement below has at least one test.
**Companion:** `docs/ROADMAP.md` holds the rationale and the acceptance criteria in prose.
**Base:** SPEC.md v1.0 remains in force. Nothing here weakens a v1.0 commitment.

Phase 0 items that Phase 1 structurally depends on (cost accounting, WAL/busy_timeout, the
route-role table, CSRF) are folded into Phase 1's foundation section rather than skipped,
because a budget ledger cannot be built on a hardcoded `costUsd: 0`.

---

## F. Foundation (folded-in Phase 0)

### F.1 Cost accounting
- `PRICE_TABLE` maps `modelId -> {inputPerMTok, outputPerMTok, searchPerCall}` in USD.
- `usageOf(providerKey, json)` extracts `{inputTokens, outputTokens, searchCalls}` or `null`.
- `RunResult.costUsd: number | null`. `null` means unknown and is never coerced to 0.
- `model_runs.cost_known = 0` marks a run whose cost we do not know. SQLite cannot drop a NOT
  NULL cheaply, so the flag carries the nullability. Spend totals filter on `cost_known = 1`
  and report the count of unpriced runs alongside.

### F.2 Route role table
- `ROUTE_ROLES: Record<string, Role>` declares a minimum role for every non-GET route.
- `ROLE_RANK = { viewer: 0, editor: 1, owner: 2 }`.
- A request below the minimum receives 403 and an `audit_log` row.
- A boot-time assertion fails if any registered non-GET route is missing from the table.

### F.3 CSRF
- Each session carries a `csrf` token. Every form embeds it; every non-GET route verifies it.
- Exemptions are explicit and listed: `/login`, `/audit-request` (pre-session, rate limited).

### F.4 Rate limiting
- In-memory fixed-window counter keyed by `route + ip`.
- `/login` 10 per 15 min. `/audit-request` 5 per hour. `/sampling/run` 20 per hour.
- Over limit returns 429 with `Retry-After`.

### F.5 Query budget
- `buildDashboard` prefetches observed claims and citations per window in single statements.
- A `countQueries()` test helper wraps `db.prepare` and asserts fewer than 25 statements.

---

## P1. Run unattended

### P1.1 Clock
- `Clock` interface `{ now(): Date }`. `SystemClock` in production, `TestClock` in tests with
  `advance(ms)`. Every scheduler and budget decision reads the injected clock, never `Date.now()`.

### P1.2 Schedules
Table `schedules`:
`id, tenant_id, brand_id, cadence ('daily'|'weekly'|'manual'), hour_utc, timezone,
monthly_budget_usd, surfaces (json), enabled, next_run_at, lease_owner, lease_expires_at,
last_run_at, last_window_label, created_at`.

- `dueSchedules(db, now)` returns enabled rows with `next_run_at <= now` and no live lease.
- `claimSchedule(db, id, owner, now, leaseMs)` is a single conditional `UPDATE ... WHERE
  (lease_expires_at IS NULL OR lease_expires_at < now)`; it returns true only for the winner.
- `computeNextRun(cadence, from, hourUtc)` is pure and returns the next boundary strictly after `from`.
- `windowLabelFor(cadence, date)` returns `YYYY-MM-DD` for daily and `YYYY-Www` for weekly.
- Round failure: the lease is released, `schedules.next_run_at` is advanced, an audit row is
  written, and the partial window is marked `partial`.

### P1.3 Window status
Table `windows`: `tenant_id, brand_id, window_label, status ('complete'|'partial'),
started_at, finished_at, planned_runs, actual_runs, cost_usd, gaps (json)`.
- A window is `partial` if `actual_runs < planned_runs` or any surface circuit opened.
- `assertUsableBaseline(window)` throws `PartialWindowError` when a partial window is used as
  an experiment baseline.

### P1.4 Budget ledger
- `monthToDateSpend(db, tenantId, month)` sums non-null `cost_usd`.
- `projectRoundCost(plan, surfaces, priceTable)` estimates before spending.
- `trimToBudget(plan, projectedUnitCost, remaining)` drops whole clusters in ascending
  priority; never reduces a surviving cluster below `MIN_SAMPLES`; returns the dropped ids.
- Exhaustion emits alert kind `budget_exhausted`.

### P1.5 Provider resilience
- `withResilience(adapter, policy, clock)` wraps any `ProviderAdapter`.
- Retries on 429/5xx: 3 attempts, base 500ms, exponential, full jitter, honours `Retry-After`.
- Circuit: 5 consecutive failures opens for 15 minutes; open circuit throws `CircuitOpenError`
  without calling the network; a success closes it.
- The round catches `CircuitOpenError`, records a gap, and continues on other surfaces.

### P1.6 Alerts
- `generateAlerts(db, tenantId, brandId, windowLabel, dashboard, clock)`.
- Kinds: `defect_movement`, `critical_defect`, `budget_exhausted`, `citation_regressed`,
  `registry_gap`.
- Dedupe key `(tenant, brand, window_label, kind, subject_key)` is unique; re-running a round
  inserts nothing new.
- `critical_defect` requires `adjudication = 'agreed'`.
- Alert bodies must contain `n=` and an interval. A lint test rejects a bare percentage.

### P1.7 Delivery
Table `delivery_channels`: `tenant_id, kind ('email'|'slack'|'webhook'), target, secret,
enabled, min_severity`.
Table `delivery_attempts`: `alert_id, channel_id, status, attempt, error, created_at`.
- `Transport` interface `{ kind, send(payload): Promise<{ok, error?}> }`; injected in tests.
- Critical alerts dispatch immediately; three failures mark the channel `failing`, surfaced in UI.
- Webhook payloads carry `X-Miscited-Signature: sha256=<hmac>` over the raw body.
- `buildDigest()` renders the three dashboard sections; with no findings it states the sample
  size and the effect it was powered to detect, and never invents a summary.

---

## P2. Evidence locker

### P2.1 Snapshots
Table `snapshots`: `sha256 PRIMARY KEY, bytes, content_type, truncated, fetched_at, http_status,
url, body`.
Citations gain `snapshot_sha256, snapshot_fetched_at, http_status, fetch_error`.

- `Fetcher.fetch(url)` returns `{sha256, body, status, truncated, error}`.
- Robots: `robots.txt` fetched and cached per host; a disallowed path returns
  `error='robots_disallowed'` and no request to the path.
- Per-host concurrency 2, timeout 8s, 3 retries, UA
  `Miscited/1.0 (+https://miscited.example/bot)`.
- Bodies over 2MB store the first 2MB, `truncated=1`, and the hash of the full stream.
- `FetchError` is a closed set: `dns | timeout | http_404 | http_5xx | robots_disallowed |
  too_large | invalid_url | blocked`.
- `checkCitation` receives real snapshot text, so a live run can return `supports`.

### P2.2 Display
- Drill-down shows snapshot date, `sha256.slice(0,12)`, HTTP status, and a link to
  `/snapshot/:sha256`, which renders behind a banner naming the capture date.

### P2.3 Re-check
- `POST /citations/:id/recheck` refetches, stores the new snapshot, diffs the ±2 lines around
  the claim, and emits `citation_regressed` when support falls from `supports` to `absent`.

### P2.4 Retention
- `pruneSnapshots(db, now, days=180)` keeps anything referenced by an open defect or a shipped
  experiment; `/methodology` reads the same constant.

---

## P3. Recall you can defend

### P3.1 Gold set
- `tests/fixtures/gold-set.json`: `{id, text, brand, expected: [{predicate, object, polarity}],
  split: 'dev'|'holdout', origin: 'handwritten'|'systematic'}`.
- Covers the 11 existing predicates plus `funding`, `employee_count`, `founded_year`,
  `certification`, `partnership`.

### P3.2 Two-stage extraction
- `ClaimProposer` interface `{ key, propose(text, vocab, brand): Promise<ProposedClaim[]> }`.
- `PatternProposer` is today's regex layer. `HeuristicProposer` widens recall deterministically.
  `ModelProposer` calls a live model when a key is present. Tests use the first two.
- `groundProposal()` discards any proposal whose object is not present in the source text within
  Levenshtein distance 2, so nothing is invented.
- `verifyClaim()` remains the only writer of a verdict. A test asserts no other module assigns one.
- `observed_claims` gains `extractor_stage` and `extractor_version`.

### P3.3 Evaluation
- `npm run eval:extractor` writes `docs/extractor-eval.json` with per-predicate precision,
  recall, F1, support and the run date; exits non-zero on a gate breach.
- `PRECISION_GATE = 0.90`. Predicates below it are recall-only: excluded from alerting, listed
  on `/methodology`.
- `/methodology` renders from the JSON. A test fails if the file is older than 90 days.

---

## P4. Self-serve Answer Risk Audit

### P4.1 Site reading
- `crawlSite(domain, fetcher)` visits `/`, `/pricing`, `/about`, `/docs`, `/security`,
  `/changelog`, `/blog` when present, plus same-host links from the homepage nav (max 12 pages).
- `proposeClaims(pages)` returns candidates with `sourceUrl` and an inferred `effectiveFrom`
  when the page carries a date.
- Candidates are inserted with `approved_by = NULL`. A test asserts the automated path cannot
  set `approved_by`.

### P4.2 Estimated demand
- `autoDemand(pages, brand, competitors)` builds clusters from FAQ/doc headings, comparison
  pairs, and per-family templates.
- `intent_clusters.demand_basis` is `'estimated'` or `'imported'`. Estimated clusters are
  excluded from economic-value statements.

### P4.3 Report
Table `audit_reports`: `id, request_id, token, domain, tenant_id, status, findings (json),
sample_size, surfaces (json), cost_usd, powered_for, created_at, completed_at`.
- `GET /audit/:token` renders the report; the token is 32 hex characters.
- The report states sample size, surfaces, cost, and a "what this did not test" section.
- A report with no findings states the effect size it was powered to detect.

### P4.4 Conversion
- `POST /audit/:token/start` creates the tenant, imports approved candidates and clusters, and
  writes a daily schedule. `audit_requests.tenant_id` records the conversion.

---

## P5. Ship the fix

- `Connector` interface `{ key, ship(action, ctx): Promise<{externalRef, url, state}> }`.
- `GithubConnector` opens a PR; the body carries defect, evidence ids, canonical claim,
  experiment id. `shipped` only on `pull_request.closed && merged == true` for the recorded
  PR number.
- `WebflowConnector` and `WordpressConnector` create drafts and never publish.
- Connector failure leaves the action `approved` with `last_error` set; a test asserts no path
  writes `shipped` on failure.
- `buildJsonLd(action)` validates against the declared schema.org type and returns a diff.
- `correctionPacket(action)` renders HTML. A test asserts no transport exists for it.
- `crawled` requires a `crawler_events` row whose class equals `relevantBotClassFor(defect)`.
  After 14 days without one the dashboard shows "shipped but not yet crawled".

---

## P6. Agency and geography

- Every view takes `brandId` from `/b/:brandId/...` or a switcher cookie; `primaryBrand()` is
  used only by seeding and by the redirect that picks a default.
- `user_brand_roles`: `user_id, brand_id, role`. Effective role is the per-brand row when
  present, else the user row.
- `GET /portfolio` ranks brands by open critical defects.
- `prompt_variants` fan out over `cluster.geos × cluster.languages` within budget.
- `assertNoGeoBlending()` mirrors `assertNoBlending()`.
- Seed ships DE, FR, ES, JP variants.
- `Dialect` abstraction: `groupConcat()` returns `GROUP_CONCAT(x, char(31))` on SQLite and
  `string_agg(x, chr(31))` on Postgres. Unit separator, not comma, so a label containing a
  comma cannot corrupt parsing.

---

## P7. Statistics that survive daily peeking

- `evalue(k, n, p0)` and `SequentialTest` accumulate evidence across looks; alert fires when the
  running product of e-values exceeds `1/alpha`.
- `simulateNullPeeking(series, days)` asserts a false-alert rate at or below 5%.
- `parallelTrends(pre)` returns divergence; `didTest` downgrades `confirmed` to `inconclusive`
  above `PARALLEL_TREND_TOLERANCE`.
- `poolByVersion(runs)` groups by `model_version`; more than one version in a window is reported
  per version and adds an automatic alternative explanation.
- `hierarchicalVariance(byVariant)` returns `{within, between, icc}` so wording disagreement is
  separable from model inconsistency.

---

## P8. AI Brand Accuracy Index

- `tenants.index_consent` default 0, revocable, with a page listing exactly the exported fields.
- `indexRows(db, quarter)` exports only
  `{provider, model_version, predicate_class, verdict, industry_category, quarter}`.
- `K_ANON = 5`. Cells below it are suppressed. A test asserts suppression and asserts the export
  schema contains no free-text column.
- `GET /index` renders the current public index. `buildIndexReport(quarter)` renders the
  quarterly document with sample sizes and methodology.
