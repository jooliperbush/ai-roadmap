# Miscited roadmap: from instrument to service

**Written:** 21 August 2026
**Against:** branch `rename-miscited`, 8,897 lines of TypeScript, 231 unit + integration tests green,
14 e2e specs, `tsc --noEmit` clean.

---

## 0. What is actually here

Verified by reading the code, not the spec.

| Layer | State |
|---|---|
| Statistics | Real. Wilson intervals, two-proportion z, Benjamini-Hochberg, adaptive sampling planner, power targets. |
| Temporal truth registry | Real. `effective_from`/`effective_to` resolution, supersession, STALE distinct from CONTRADICTED. |
| Verifier | Real but narrow. 11 hardcoded predicate patterns, deterministic, auditable, unmeasured. |
| Priority | Real. Six factors stored and individually explainable, Wilson lower bound for defect probability. |
| Action engine | Real. Closed enum, state machine, illegal transitions throw, evidence required. |
| Experiments | Real. Difference-in-differences with matched controls, `inconclusive` when underpowered. |
| Providers | Simulated adapter is real and deterministic. Four live adapters exist and are half-wired. |
| Web | Server-rendered, three-section dashboard, nine secondary pages, public marketing page. |
| Deployment | Railway, manual `railway up`, no volume. |

## 1. The four holes that cap what this is worth today

```
  demand ─▶ sample ─▶ verify ─▶ rank ─▶ ship fix ─▶ measure ─┐
             ▲          │                   │                 │
             │          │                   │                 │
        [1] nobody   [2] no          [3] no connector,   [4] nobody
        runs it      snapshot,       so fixes die in     is told
                     so live         a doc
                     citations
                     are all
                     "unreachable"
```

**Hole 1: nothing runs the loop.** There is no scheduler, cron, queue or worker anywhere in `src/`.
Sampling happens when a human posts to `/sampling/run`. The product's value is a time series and a
time series nobody collects is a screenshot.

**Hole 2: the wedge does not work against live providers.** `src/providers/live.ts` returns
`snapshotText: null` for every citation. `checkCitation()` correctly returns `unreachable` when the
snapshot is null. So the moment a customer supplies real API keys, the headline capability -- "the page
they cited does not contain the claim" -- returns nothing but `unreachable` on every row.

**Hole 3: recommendations stop at the edge of the app.** `open_github_pr` and `create_cms_draft` are in
the closed enum and priced into `FIXABILITY`, but no integration exists. Fixes that never ship produce
no experiments, and no experiments means `deriveExpectedRange()` keeps returning `null` forever, which
means every recommendation ships as "no comparable prior".

**Hole 4: findings are stored and never delivered.** The `alerts` table exists, `insertAlert` and
`listAlerts` exist, and nothing in `src/` calls either. There is no email, Slack, or webhook code in the
repository.

Three more, smaller but real:

- `railway.json` declares no volume and the database is `data/miscited.sqlite`, so the live deployment
  loses every row on every deploy, including inbound audit requests.
- `Auth.role` is read into the session object and never checked; there is no CSRF token and no rate
  limiting on routes that spend money.
- `server.ts` calls `repo.primaryBrand()` in every handler, so the multi-brand schema and `listBrands()`
  are unreachable from the UI.

## 2. The thesis

The engine is good. What is missing is not measurement, it is autonomy.

```
  today                          10x
  ─────                          ───
  an instrument a person holds   a service that runs without one
  a report                       a monitor
  a concierge audit              a link
  "unreachable"                  a dated snapshot you can forward
  advice                         a merged pull request
```

Three multipliers, in order of size:

1. **Unattended** turns a one-off report into a subscription. (Phase 1)
2. **Provable** makes the central claim survive contact with real answers. (Phase 2)
3. **Self-serve** removes the human from acquisition, which is the only way the free audit scales. (Phase 4)

Two compounding assets follow: connectors produce confirmed experiments, which is the only thing that
makes expected ranges non-null; and the cross-customer corpus becomes an index a competitor cannot copy.

## 3. Sequence

```
wk 1    2    3    4    5    6    7    8    9   10   11   12   13   14
├─P0─┤
     ├────P1────┤
                ├──P2──┤
                       ├────P3────┤
                                  ├──────P4──────┤
                                                 ├────P5────┤
                                                            ├─P6─┤
                                                                 ├P7┤
                                                                    ├──P8──┤
```

P0 survive · P1 unattended · P2 evidence · P3 recall · P4 self-serve · P5 ship · P6 agency · P7 stats · P8 index

Phases 0 to 4 are the 10x. Phases 5 to 8 are the compounding.

---

# Phase 0 — Survive first contact

**3 to 4 days.** Nothing else is safe to build on top of a deployment that loses its database.

### 0.1 Durable storage

- `railway.json` declares a volume mounted at `/data`, and `MISCITED_DB` defaults to `/data/miscited.sqlite`
  when `RAILWAY_ENVIRONMENT` is set.
- SQLite runs in WAL mode with `busy_timeout` set, so the Phase 1 scheduler can share the file.
- **AC:** a row inserted into `audit_requests`, followed by `railway up`, is still readable afterwards;
  the check is scripted as `npm run verify:persistence` and its output is pasted into the deploy notes.
- **AC:** a fresh boot against a populated volume does not re-seed; seeding is guarded on an empty
  `tenants` table and logs which branch it took.

Postgres is deliberately deferred to Phase 6. A volume-backed SQLite carries this workload, and the port
costs a week that Phase 1 needs more.

### 0.2 CSRF and rate limiting

- Every state-changing POST carries a per-session token rendered into the form and checked server-side.
- **AC:** a POST to `/sampling/run` with a valid session cookie but no token returns 403 and writes an
  `audit_log` row with actor and route.
- **AC:** `/login` allows 10 attempts per IP per 15 minutes and `/audit-request` allows 5 per IP per hour;
  both return 429 with a `Retry-After` header.
- **AC:** an integration test forges a cross-site POST against every mutating route and asserts 403.

### 0.3 Roles that mean something

- A single route table declares the minimum role for every mutating route.
- **AC:** a `viewer` receives 403 on `/sampling/run`, `/truth`, `/truth/:id/approve`, `/actions`,
  `/actions/:id/transition` and `/demand/import`.
- **AC:** a unit test enumerates the Fastify route table at boot and fails if any non-GET route lacks a
  declared minimum role, so a new route cannot be added without a decision.

### 0.4 Cost accounting that is not zero

`LiveProvider.run()` currently hardcodes `costUsd: 0`, which makes the budget enforcement in Phase 1
impossible and the unit economics on `/methodology` fictional.

- A per-model price table maps input, output and search-tool tokens to dollars.
- **AC:** a live run parses the provider's usage block and records a non-zero `cost_usd` accurate to
  within 5% of the provider's own billing for a 100-run sample.
- **AC:** a provider response with no usage block records `cost_usd = NULL`, not `0`, and rows with NULL
  are excluded from spend totals rather than counted as free.
- **AC:** `/methodology` shows month-to-date spend per provider computed from `model_runs.cost_usd`.

### 0.5 Dashboard query count

`buildDashboard` walks runs and issues a query per run for observed claims.

- **AC:** a test harness wraps `db.prepare` and counts statements; `buildDashboard` issues fewer than 25
  queries regardless of run count.
- **AC:** a synthetic 30,000-run window renders the dashboard in under 500ms on the CI machine.

---

# Phase 1 — Run unattended

**2 weeks.** This is the largest single multiplier: it converts the product from a thing you visit into a
thing that tells you.

### 1.1 Scheduler

- New `schedules` table: tenant, brand, cadence, surfaces, monthly budget, timezone, `next_run_at`,
  `lease_expires_at`.
- One in-process loop claims due schedules with a transactional lease, so a second process cannot
  double-run the same schedule.
- The clock is injectable, because a scheduler you cannot fast-forward is a scheduler you cannot test.
- **AC:** a daily schedule advanced through 7 simulated days produces exactly 7 rounds, each with a
  distinct `window_label`.
- **AC:** a round that throws mid-way leaves the schedule claimable after the lease expires, writes an
  `audit_log` row naming the error, and does not leave a half-window that a later experiment can use as a
  baseline.
- **AC:** two scheduler instances started against the same database produce exactly one round per due
  schedule, asserted by a test that runs both loops concurrently.

### 1.2 Budget ledger

- Monthly budget per tenant, checked before each round using projected cost from the price table.
- **AC:** when projected spend would exceed the budget, the round drops whole clusters in ascending
  priority order and names them in `droppedClusters`; it never reduces any cluster below `MIN_SAMPLES`.
- **AC:** hitting the budget writes an alert of kind `budget_exhausted` and the affected window is
  labelled `partial` in the UI.
- **AC:** a window labelled `partial` is rejected as an experiment baseline with a stated reason.

### 1.3 Provider resilience

- **AC:** 429 and 5xx responses retry three times with exponential backoff plus jitter, honouring
  `Retry-After` when present.
- **AC:** five consecutive failures on one provider open a circuit for 15 minutes; the round continues on
  the remaining surfaces rather than aborting.
- **AC:** runs lost to an open circuit are recorded as gaps on the window, and per-surface coverage is
  displayed on the observatory page, so a missing provider is visible rather than silently absent.

### 1.4 Alerts, written and read

The table already exists. Nothing writes to it.

- **AC:** after each round, every comparison passing the existing gates (`p < 0.05`, effect `>= 0.10`,
  BH `q <= 0.10`) inserts exactly one alert per misconception per window; re-running the same round
  inserts none.
- **AC:** a `critical` contradiction on a `material` or `regulated` claim alerts on first observation
  regardless of movement, but only once `adjudication = 'agreed'`.
- **AC:** every alert body names the surface, the cluster, the measurement with `n` and interval, and a
  link to the drill-down; a test asserts no alert body contains a bare percentage.

### 1.5 Delivery

- Three channels: email via Resend, Slack incoming webhook, generic signed webhook. Configured per tenant.
- **AC:** a critical alert is delivered within 5 minutes of round completion; delivery attempts are rows
  with status, and three failures surface a banner in the UI rather than failing silently.
- **AC:** a weekly digest sends at 08:00 Monday in the tenant's timezone containing the three dashboard
  sections and nothing else.
- **AC:** a tenant with no new findings receives a digest that says so and reports the sample size it had,
  rather than a generated summary of nothing.
- **AC:** the webhook payload is signed with a per-tenant secret and the signature scheme is documented on
  `/methodology`.

---

# Phase 2 — Evidence locker

**1 week.** Closes the hole that makes the product's central claim inoperative in production.

### 2.1 Snapshot fetcher

- Every cited URL is fetched at sampling time and stored content-addressed by sha256.
- Migration `003` adds `snapshot_sha256`, `snapshot_fetched_at`, `http_status`, `fetch_error` to `citations`.
- **AC:** a live-provider run in a test with a stubbed fetch produces `support = 'supports'` for a page
  containing the claim. This single assertion is the proof the hole is closed.
- **AC:** `robots.txt` is honoured, per-host concurrency is capped at 2, timeout is 8 seconds, three
  retries, and the user agent is identifiable with a contact URL.
- **AC:** `unreachable` records a specific cause from a closed set (`dns`, `timeout`, `http_404`,
  `http_5xx`, `robots_disallowed`, `too_large`), never a generic string.
- **AC:** snapshots larger than 2MB store the first 2MB plus the full hash of the original, and are flagged
  truncated.

### 2.2 Evidence display

- **AC:** the defect drill-down shows, per citation, the snapshot date, the first 12 characters of the
  sha256, the HTTP status, and a link to the stored copy.
- **AC:** the stored copy renders behind a banner stating it is a snapshot captured on a date and is not
  the live page.

### 2.3 Re-check and regression

- **AC:** a "re-check" action refetches, stores a new snapshot, and shows which lines around the claim
  changed.
- **AC:** a citation whose support flips from `supports` to `absent` on re-check fires an alert of kind
  `citation_regressed`.

### 2.4 Retention

- **AC:** snapshots referenced by an open defect or a shipped experiment are retained indefinitely; others
  are pruned after 180 days.
- **AC:** the retention policy is published on `/methodology` and a test asserts the page states the same
  number the pruning job uses.

---

# Phase 3 — Recall you can defend

**2 weeks.** The 90% precision gate is the most load-bearing number in the product and nothing currently
measures it.

### 3.1 Gold set

- **AC:** 300 human-labelled answer and claim pairs covering all 11 existing predicates plus at least 5
  predicates with no pattern today, stored as a fixture, split 200 development and 100 held out.
- **AC:** `npm run eval:extractor` prints per-predicate precision, recall and F1 against the held-out
  split and exits non-zero if any gate is breached.

### 3.2 Two-stage extraction

- Stage one is a model pass proposing `(subject, predicate, object, polarity, temporalMarker)` restricted
  to the registry's predicate vocabulary. Stage two is the existing deterministic verifier, which alone
  assigns verdicts.
- **AC:** the model never assigns a verdict; a test asserts `verifyClaim()` is the only writer of the
  `verdict` column.
- **AC:** a proposed tuple whose object cannot be located in the answer text within an edit distance of 2
  is discarded, so no claim is invented.
- **AC:** every `observed_claims` row records `extractor_stage` of `pattern` or `model_proposed`, plus the
  extractor model version.
- **AC:** held-out recall rises at least 25 points over pattern-only while precision on critical defect
  alerts stays at or above 90%.
- **AC:** any predicate whose precision falls below 90% has its model-proposed claims excluded from
  alerting and is listed on `/methodology` as recall-only.

### 3.3 Publish the numbers

- **AC:** `/methodology` renders current per-predicate precision and recall, the gold-set size, and the
  evaluation date, generated from the eval output rather than typed into the template.
- **AC:** a test fails if the published evaluation is more than 90 days old.

---

# Phase 4 — The self-serve Answer Risk Audit

**3 weeks.** Today `/audit-request` captures an email and a domain into a table. The audit itself is a
human. This phase makes the free tier deliverable at zero marginal cost, which is what turns the public
page from a lead form into distribution.

### 4.1 Domain to draft registry

- **AC:** given a domain, the crawler visits the pricing, about, docs, security and changelog pages where
  they exist and proposes canonical claim candidates, each with a source URL and an effective date where
  one can be inferred from the page.
- **AC:** every candidate enters as `proposed`; nothing reaches the registry without a human approval
  click, and a test asserts the auto path cannot write `approved_by`.
- **AC:** a typical B2B SaaS marketing site yields at least 8 candidates across at least 4 predicates.

### 4.2 Demand without a customer

- **AC:** clusters are seeded from the brand's own FAQ and docs headings, competitor comparison pairs from
  entity extraction, and a fixed template set per intent family.
- **AC:** every auto-created cluster carries `demand_basis = 'estimated'`, and estimated demand is
  excluded from any economic value statement until real GSC data is imported.
- **AC:** the report states in plain language that demand was estimated and how.

### 4.3 The report

- **AC:** the audit produces a dated report at an unguessable URL showing the three sections, every rate
  with its `n` and interval, every defect with the sampled answer text, the conflicting canonical
  candidate, and the citations with their snapshot dates.
- **AC:** the report states the sample size, the exact surfaces used, the cost of the sample, and a
  section naming what it did not test.
- **AC:** generation completes within 20 minutes of the request and the link is emailed.
- **AC:** an audit that finds nothing says so and reports the effect size it was powered to detect,
  instead of promoting a weak finding. A test asserts the no-findings path renders the power statement.

### 4.4 Convert

- **AC:** the report carries exactly one action, which creates the tenant, imports the approved registry
  candidates and clusters, and schedules the first round.
- **AC:** the originating `audit_requests` row records the tenant it became, so conversion is measurable.

---

# Phase 5 — Ship the fix

**2 weeks.** Every shipped fix produces an experiment, and a cohort of confirmed experiments is the only
honest source of an expected range.

### 5.1 GitHub

- **AC:** a GitHub App install scoped to repositories the customer selects; no write scope beyond those.
- **AC:** `open_github_pr` creates a branch, commits the diff, and opens a PR whose body contains the
  defect statement, the evidence ids, the canonical claim and the experiment id.
- **AC:** the action moves to `shipped` on merge webhook, never on open, and a merge of an unrelated PR
  does not move it.

### 5.2 CMS drafts

- **AC:** Webflow and WordPress adapters create a draft and never publish; the draft URL is written onto
  the action.
- **AC:** a connector failure leaves the action in `approved` with the error recorded, never a false
  `shipped`.

### 5.3 Structured data

- **AC:** `update_structured_data` emits a JSON-LD patch validated against the declared schema.org type
  and shown as a diff against the page's current markup.

### 5.4 Correction packets

- **AC:** `publisher_correction_packet` exports a document containing the wrong statement, the canonical
  fact, the sources, and the snapshot permalinks, addressed to a named publisher.
- **AC:** the system has no send path. A test asserts no outbound transport exists for this action type.

### 5.5 Crawl confirmation

- **AC:** after `shipped`, the action enters `crawled` only on a `crawler_events` row from the bot class
  that `relevantBotClassFor()` names for the observed defect.
- **AC:** an action not crawled within 14 days surfaces "shipped but not yet crawled" on the dashboard
  rather than sitting silently.

---

# Phase 6 — Agency and geography

**1.5 weeks.** The schema already supports both. The UI does not.

### 6.1 Multi-brand

- **AC:** every view resolves the brand from the route or an explicit switcher, and `repo.primaryBrand()`
  has no callers left outside seeding.
- **AC:** a tenant with 12 brands gets a portfolio view ranking brands by open critical defects.
- **AC:** the isolation test suite is extended from tenant isolation to per-brand isolation for
  brand-scoped users.

### 6.2 Per-brand roles

- **AC:** a user can hold `viewer` on one brand and `editor` on another, enforced through the same route
  table built in Phase 0.

### 6.3 Geo and language

- **AC:** a cluster declares a set of geos and languages, and the planner fans out across them within the
  same budget.
- **AC:** the dashboard compares one misconception across geos and refuses to pool them into a single
  rate, in the same way `assertNoBlending()` refuses to pool intent families.
- **AC:** the seeded world ships localised variants for DE, FR, ES and JP so the fan-out is demonstrable
  without live keys.

### 6.4 Postgres

- **AC:** the full integration suite passes against Postgres, with `GROUP_CONCAT` replaced by `array_agg`
  and no delimiter-based parsing left in `misconceptionRollup`.
- **AC:** a documented one-command migration from a customer's SQLite file.

---

# Phase 7 — Statistics that survive daily peeking

**1 week.** Once Phase 1 samples daily, the current per-round correction is no longer sufficient, and this
product cannot afford to be wrong about its own error rate.

### 7.1 Always-valid sequential testing

- **AC:** the movement alert uses an e-value or alpha-spending approach instead of a fresh per-round test.
- **AC:** a simulation test runs 1,000 null time series peeked daily for 90 days and fires a false alert in
  5% or fewer. The current implementation is expected to fail this test, which is the reason to write it
  first.

### 7.2 Parallel trends

- **AC:** `didTest` refuses `confirmed` when pre-period trends of treatment and control diverge beyond a
  stated threshold, returning `inconclusive` with the divergence named.

### 7.3 Version pooling

- **AC:** a window containing more than one `model_version` for a surface is reported per version and never
  pooled.
- **AC:** a version change inside an experiment window is added to `alternativeExplanations` automatically.

### 7.4 Wording variance

- **AC:** a hierarchical estimate separates variant-level from cluster-level variance, and the UI can state
  that the customer's wordings disagree more than the model does.

---

# Phase 8 — The AI Brand Accuracy Index

**2 weeks.** The one asset a competitor cannot ship their way into.

### 8.1 Consent

- **AC:** opt-in per tenant, default off, revocable, with a plain-language list of exactly which fields
  leave the tenant.

### 8.2 Aggregation boundary

- **AC:** no published cell derives from fewer than 5 tenants; a test asserts suppression of thin cells.
- **AC:** brand names, cluster labels and answer text never cross the boundary; only provider,
  model version, predicate class, verdict, industry category and date do. A test asserts the export schema
  contains no free text.

### 8.3 Publication

- **AC:** a quarterly report of stale and contradicted rates per model per category, with sample sizes and
  methodology.
- **AC:** a public methodology page detailed enough for a journalist to challenge the numbers.

---

## 9. What stays unbuilt

Restating, because each looks like an obvious next feature.

- **A chat interface over the data.** It converts a system of record into a system of plausible answers,
  which is the failure this product exists to detect.
- **More providers as a headline count.** Four sampled properly beats twelve sampled once.
- **An impact predictor.** Until there is a large cohort of confirmed experiments, every predicted lift is
  fiction, and once there is, the cohort is the prediction.
- **Automated outreach of any kind.** The moment the system posts anything itself it is a spam vector and
  the trust that is the product is gone.

## 10. Risks worth naming now

| Risk | Where it bites | What to do |
|---|---|---|
| The extractor cannot hit 90% precision. | Phase 3 gates Phase 4. | Stop and reconsider the alerting product rather than shipping a lower gate. |
| The self-serve audit produces a weak report. | A bad free audit burns the lead permanently. | Do not ship Phase 4 before Phase 2 and 3 are green. |
| Live sampling costs $400 to $1,000 per customer per month. | Gross margin. | Budget enforcement in Phase 1 is not optional, and cost per confident measurement belongs on the pricing page. |
| Snapshot fetching looks like scraping. | Legal and reputational. | Robots compliance, identifiable agent, and a published retention policy in Phase 2. |
| The Index leaks a customer. | The whole trust position. | k of 5 suppression and a no-free-text export schema, tested. |
