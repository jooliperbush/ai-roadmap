# Opportunities for improvement

Written after building the platform and driving every user flow in a browser. Ordered by how
much each would change the product's defensibility, not by how hard it is.

---

## 1. The things this build stubs that the moat actually depends on

### 1.1 Claim extraction is deterministic and therefore narrow

`domain/verifier.ts` extracts claims by pattern. That was the right call for a system whose
output must be auditable — a customer can read exactly why we decided their answer asserted
something — but it only sees predicates we have written patterns for. A model that says
"they were bought out a few years back by the NFT people" asserts an acquisition and we miss it.

**What to build:** a two-stage extractor. A model pass proposes `(subject, predicate, object,
polarity, temporal marker)` tuples against the registry's predicate vocabulary; the
deterministic layer then verifies and scores them. Keep the rule layer as the arbiter — never
let the model decide a verdict — but let it widen recall. Measure it: hold out a
human-labelled set and track precision and recall per predicate, published on `/methodology`.
The gate in the spec is ~90% precision on critical defect alerts; nothing in this build
measures that yet, and it is the single most load-bearing unmeasured number.

### 1.2 Citation snapshots are supplied, not fetched

`checkCitation()` takes a snapshot and does honest work with it, but nothing fetches or stores
snapshots. In production this is a fetcher with a content-addressed object store, politeness
rules, and a retention policy — and it is what makes "the cited page does not contain the
claim" a defensible statement six months later when the page has changed. Store the snapshot
hash on the citation row and show it in the drill-down.

### 1.3 Publishing connectors are named, not wired

`open_github_pr` and `create_cms_draft` are in the catalogue and priced into fixability, but
there is no GitHub/Webflow/WordPress integration. The 30%-of-recommendations-acted-on gate
from the 90-day plan is unreachable without them, because the friction between "we found it"
and "it shipped" is where recommendations go to die.

---

## 2. Statistical and methodological gaps I would close next

### 2.1 Sampling variance is treated as the only variance

Every interval here is binomial: the uncertainty of a proportion given n draws. But two other
sources move the number and are currently invisible:

- **Prompt-wording variance.** Three paraphrases of a cluster can differ more from each other
  than repeated draws of one paraphrase. A hierarchical model (variant nested in cluster)
  would separate "the model is inconsistent" from "our wordings disagree", which are different
  problems with different fixes.
- **Temporal drift.** A model version change mid-window silently pools two populations. We
  record `model_version` per run, so the fix is available: refuse to pool across versions, or
  report per-version and flag the change as an alternative explanation automatically.

### 2.2 The defect denominator is coarse

A misconception's rate is measured over all runs in the clusters where it appeared. But a
claim about fees can only be contradicted in an answer that discusses fees. The honest
denominator is "runs where the topic came up", which needs a topic-relevance classifier per
predicate. Today the rates are conservative in a way that is defensible but understates real
exposure on narrow predicates.

### 2.3 Alerting is per-round, not sequential

Benjamini–Hochberg is applied within a round. Customers sample daily, which is a sequential
testing problem: peeking every day at the same hypothesis inflates the false-positive rate no
matter how good the per-round correction is. Use an always-valid approach (alpha-spending or
e-values) for the "has this moved?" alert.

### 2.4 Difference-in-differences assumes parallel trends and never checks

`didTest` is correct arithmetic, but DiD is only causal if treatment and control were moving
in parallel before the intervention. We have the history to test that — several pre-windows
per cluster — and we should refuse a confirmed verdict when the pre-trends visibly diverge,
the same way we refuse when underpowered.

---

## 3. Product gaps a paying customer would hit in week two

| Gap | Why it bites |
|---|---|
| **No scheduler.** Sampling is manual or seeded; there is no Temporal/cron loop, no budget enforcement across a month, no backoff when a provider rate-limits. | The product's value is a time series, and a time series with gaps is a worse time series. |
| **One brand per workspace in the UI.** The schema is multi-brand and agency-ready; the views assume `primaryBrand`. | Agencies are the fastest-moving buyer, and this is a half-day of work the schema already supports. |
| **No notifications.** Alerts are stored and never delivered. | A defect found on Tuesday and read on Friday is three days of wrong answers. Weekly executive digest + immediate critical-defect alert. |
| **No registry-gap workflow.** `UNSUPPORTED` verdicts correctly identify facts we cannot adjudicate, but nothing routes them to the customer to approve. | The truth registry decays. `expiringClaims()` exists and is unused in the UI — surface it as "facts going stale". |
| **No geo/language depth.** Every run is US/en. The schema carries geo and language everywhere. | "Are we described differently in Germany?" is a question enterprises ask immediately, and it is nearly free to answer. |
| **No export.** No CSV, no API tokens, no scheduled report. | Enterprise buyers require it, and it is also the cheapest way to make the data feel like theirs. |

---

## 4. Engineering debt worth paying early

- **SQLite → Postgres.** The repository layer is written to port cleanly (no SQLite-specific
  SQL beyond `GROUP_CONCAT`), but `misconceptionRollup` uses `GROUP_CONCAT` and would move to
  `string_agg`/arrays. Do it before the first customer, not after.
- **`GROUP_CONCAT` for cluster and provider lists** is a correctness smell: a cluster label
  containing a comma would corrupt parsing. Today cluster ids are opaque so it is safe, which
  is exactly the kind of accidental safety that stops being true later.
- **N+1 reads in the dashboard.** `buildDashboard` walks runs and issues a query per run for
  observed claims. Fine at 300 runs, not at 30,000/month. One join, or a materialised
  per-run defect flag.
- **Session store in the primary table.** Fine now; move to a TTL store when there is more
  than one process.
- **No rate limiting or CSRF token on state-changing forms.** Same-site cookies cover a lot,
  but a token is cheap and this app performs spend-incurring actions from form posts.

---

## 5. Things I would deliberately *not* build

Worth stating, because each looks like an obvious feature request:

- **A chat interface over the data.** Every competitor is adding one. It converts a system of
  record into a system of plausible-sounding answers — the exact failure this product exists
  to detect.
- **More providers as a headline number.** Four grounded providers sampled properly beats
  twelve sampled once. "Number of LLMs monitored" is a spec-sheet metric, and competing on it
  means competing on the axis where the incumbents are already cheap.
- **An impact predictor.** The temptation to model "this change will lift citations 30–40%"
  is strong and every such number is fiction until there is a large cohort of confirmed
  experiments. When there is one, the cohort *is* the prediction — which is what
  `deriveExpectedRange` already does.
- **Automated outreach of any kind.** Publisher correction packets are prepared for a human to
  send. The moment the system posts anything itself, it becomes a spam vector and the trust
  that is the actual product is gone.

---

## 6. The distribution asset this build makes possible

Every run stored here carries model, version, surface, grounding, geo and a verified verdict.
Aggregated across customers and stripped of attribution, that is an **AI Brand Accuracy
Index**: which models produce the most stale or unsupported company claims, by category and
over time. It is proprietary, it is a press hook, it builds the labelled corpus that improves
the verifier, and it is the one asset a competitor cannot copy by shipping features.

The schema supports it today. What it needs is a consent model, an aggregation boundary that
cannot leak a single customer's defects, and a publishing cadence — in that order.
