# AnswerOps — Product & Technical Specification

**Version:** 1.0
**Status:** Implemented (this repository is the reference implementation)

---

## 0. One-line promise

> Find the AI answers costing you trust or customers. Correct them. Prove the correction worked.

AnswerOps is not an AI-visibility dashboard. Visibility is an input, never the product.
The product is an operating loop:

```
Canonical truth + buyer demand
        -> Sample real AI surfaces (with provenance)
        -> Verify claims and citations against a dated truth registry
        -> Rank risk and upside with a transparent formula
        -> Ship controlled fixes as tracked experiments
        -> Measure crawl, answers and pipeline
        -> feed back into truth + demand
```

---

## 1. Positioning and non-goals

### 1.1 What we sell
- **Reputation protection** — AI systems repeating false, stale or damaging claims about a
  company is a live commercial risk. We detect it, quantify it, and prove it was fixed.
- **Demand capture** — high-intent question clusters where the brand is absent or misdescribed.
- **Evidence-backed improvement** — every recommendation carries evidence, assumptions,
  an expected range derived from observed data, and a running experiment.

### 1.2 Explicit non-goals (enforced in code, not just prose)
| Non-goal | Enforcement |
|---|---|
| A single blended "visibility score" | `dashboard` service refuses to aggregate across intent families; `assertNoBlending()` throws if asked. |
| Precise percentages without sample size | Every rate in the API and UI is a `Measurement {k, n, point, ciLow, ciHigh, method}`. Rendering a bare rate is a test failure. |
| Fabricated impact predictions | `actions.recommend()` rejects any recommendation whose `expectedRange` is not derived from an `evidence[]` array with at least one observation id. |
| "Control how AI talks about you" | Product copy uses *measure / influence / correct*. A copy lint test greps for banned claims. |
| Automated third-party posting, synthetic reviews, fake mentions | No connector exists. `ACTION_TYPES` is a closed enum; spam types are absent and rejected. |
| Prompt-level revenue attribution presented as fact | Business outcomes are labelled `correlational` and always ship with `alternativeExplanations[]`. |

### 1.3 Why not "Mentions plus automation"
Mentions-class tools measure *whether you are mentioned*. That is a proxy. The failure mode
that matters is an answer that is confident, positive, well-formatted, and **wrong** — which
a sentiment-and-share-of-voice tool scores as a win. AnswerOps' fundamental object is:

```
claim x buyer intent x model surface x market x time
```

---

## 2. Domain model

### 2.1 Core entities

| Table | Purpose |
|---|---|
| `tenants` | Workspace / billing boundary. All queries are tenant-scoped. |
| `users`, `sessions` | Auth. Roles: `owner`, `editor`, `viewer`. |
| `brands` | Subject of monitoring. A tenant may have many (agency mode). |
| `entities` | Any named org/product observed in answers. |
| `entity_relationships` | Typed edges: `competitor`, `partner`, `parent`, `subsidiary`, `integration`, `publisher`, `review_site`, `unrelated_comention`. Never inferred from co-occurrence alone. |
| `demand_signals` | Raw questions imported from GSC, site search, support, sales calls, CRM, reviews, communities. |
| `intent_clusters` | Clustered demand with an intent family, buyer stage, demand weight and economic value. |
| `prompt_variants` | Concrete prompts belonging to a cluster (paraphrases, locales). |
| `truth_sources` | Where a canonical fact came from (URL/doc, owner, approval). |
| `canonical_claims` | Customer-approved facts with `effective_from` / `effective_to`. |
| `model_runs` | One sampled execution with full provenance. |
| `observed_claims` | Atomic statements extracted from an answer, each verified. |
| `citations` | Sources the answer cited, with support checking and source-class. |
| `actions` | Interventions, with lifecycle state machine. |
| `experiments` | Baseline/treatment/control ledger per action. |
| `business_outcomes` | GA4 / GSC / CRM / self-reported attribution, always correlational. |
| `crawler_events` | Bot hits, classified by purpose. |
| `alerts` | Only statistically meaningful movements. |
| `audit_log` | Every mutating operation, tenant-scoped, append-only. |

### 2.2 Intent taxonomy (never blended)

| Family | Buyer stage | Example |
|---|---|---|
| `unaided_discovery` | awareness | "best L1 for payments" |
| `comparison` | consideration | "Vanar vs Base" |
| `branded_reputation` | consideration | "is Vanar legitimate?" |
| `factual` | evaluation | "what are Vanar's fees" |
| `transactional` | purchase | "where can I buy VANRY" |
| `support` | retention | "how do I migrate my tokens" |
| `navigational` | any | "Vanar docs" |

Branded prompts nearly guarantee a mention. Aggregating them with unaided discovery inflates
visibility. The API returns metrics **keyed by family**; there is no global rollup.

### 2.3 Model surface provenance

Every `model_runs` row records: `provider`, `model_id`, `model_version`, `surface`
(`api` | `consumer_app` | `search_product`), `grounding` (`grounded_search` |
`training_memory` | `hybrid`), `search_mode`, `geo`, `language`, `personalization`
(`none` | `logged_out` | `logged_in_default`), `system_config_hash`, `temperature`,
`seed`, `requested_at`, `latency_ms`, `raw_response_ref` (object-store key),
`sampling_reason`, `cost_usd`.

"ChatGPT" is not a surface. `openai/gpt-x @ api, grounded_search, US-en, logged_out` is.

---

## 3. Statistical contract

LLM outputs are non-deterministic. Every rate we display obeys:

1. **Repetition.** Each prompt variant is sampled `n >= MIN_SAMPLES` times per surface per
   window. `MIN_SAMPLES = 5` (floor), adaptive up to 20.
2. **Interval.** Point estimates ship with a 95% **Wilson score interval**. Wilson, not
   normal-approximation, because k is often 0 or n.
3. **Alerting.** An alert fires only when a **two-proportion z-test** on baseline vs current
   yields `p < 0.05` **and** the absolute effect exceeds `MIN_EFFECT = 0.10`. Multiple
   comparisons across clusters are controlled with **Benjamini-Hochberg** at q = 0.10.
4. **Adaptive sampling.** Allocation per cluster is proportional to
   `demand x economicValue x volatility x defectRisk`, subject to a monthly budget.
   `volatility` is the observed variance of the mention indicator over the trailing window.
5. **Honesty.** If `n < MIN_SAMPLES` the UI shows `insufficient data (n=k)` and the number is
   suppressed, not rounded.

### 3.1 Formulas

Wilson interval for k successes of n at z = 1.96:

```
p̂ = k/n
centre = (p̂ + z²/2n) / (1 + z²/n)
half   = z/(1 + z²/n) * sqrt( p̂(1-p̂)/n + z²/4n² )
```

Two-proportion z-test with pooled variance:

```
p_pool = (k1 + k2) / (n1 + n2)
z = (p̂1 - p̂2) / sqrt( p_pool(1-p_pool) (1/n1 + 1/n2) )
```

"Probability the improvement is real" is reported as `1 - p` from the one-sided test, and is
always labelled as a frequentist complement, not a Bayesian posterior.

---

## 4. Truth graph (temporal)

A canonical claim is:

```ts
{
  id, brandId, subject, predicate, object,
  claimText,              // human-readable canonical statement
  effectiveFrom: Date,
  effectiveTo: Date|null, // null = current
  supersededById: string|null,
  sourceId,               // truth_sources
  approvedBy, approvedAt,
  sensitivity: 'routine'|'material'|'regulated'
}
```

Resolution: `resolveTruth(brand, subject, predicate, asOf)` returns the claim whose
`[effectiveFrom, effectiveTo)` contains `asOf`. This is what catches **stale-but-sourced**
answers: a model citing a real 2021 press release for a fact superseded in 2023 is
`STALE`, not `SUPPORTED`.

Verdicts: `SUPPORTED | CONTRADICTED | STALE | UNSUPPORTED | UNVERIFIABLE | NOT_APPLICABLE`.

`CONTRADICTED` on a `material` or `regulated` claim = **critical defect**, regardless of
sentiment. The reference example: an answer that says a company was acquired in 2021 when
the acquisition closed in 2023 is a critical defect even if sentiment is 73% positive.

---

## 5. Claim & citation verifier

For each answer:

1. **Segment** into atomic statements (sentence-level + clause splitting on coordinating
   conjunctions when both halves carry a predicate).
2. For each statement extract `(subject, predicate, object, polarity, temporalMarker)`.
3. **Brand role**: `absent | mentioned | compared | recommended | disrecommended`.
4. **Fit**: does the answer describe the right customer/use case?
5. **Truth check** against the temporal graph -> verdict above.
6. **Citation support**: for each cited URL, fetch a **snapshot** and check whether the page
   actually contains support for the claim. Outcomes:
   `supports | contradicts | absent | unreachable | paywalled`.
7. **Source class**: `owned | independent_credible | independent_low_quality | ugc | spam |
   competitor | unknown`.
8. **Misconception**: named, reusable misconception records so repetition across surfaces is
   countable ("models keep saying we lack SSO").

High-risk verdicts (material/regulated + CONTRADICTED) require **dual adjudication**:
two independent evaluators must agree, else the defect is queued for human review and is
excluded from alerting until adjudicated.

---

## 6. Prioritisation

```
Priority = Demand x BuyerIntent x EconomicValue x DefectProbability x Fixability x Confidence
```

All six factors are stored, displayed, and individually explainable in the UI.

| Factor | Range | Source |
|---|---|---|
| Demand | 0..1 | normalised cluster volume from real demand signals |
| BuyerIntent | 0..1 | fixed weights per intent family (transactional 1.0 ... navigational 0.2) |
| EconomicValue | 0..1 | customer-supplied value per cluster (ACV-weighted) |
| DefectProbability | 0..1 | Wilson **lower bound** of defect rate (conservative) |
| Fixability | 0..1 | action-type prior: owned page 0.9 ... third-party correction 0.35 |
| Confidence | 0..1 | `1 - (ciWidth / 2)` clamped; small samples cannot rank high |

Using the Wilson *lower bound* for DefectProbability means a 1-of-2 observation cannot
outrank a 30-of-100 observation.

---

## 7. Action engine

Closed enum of action types (spam vectors intentionally absent):

`update_owned_page`, `create_comparison_page`, `create_evidence_page`,
`fix_fact_inconsistency`, `fix_crawler_access`, `update_product_feed`,
`open_github_pr`, `create_cms_draft`, `publisher_correction_packet`,
`request_genuine_reviews`, `update_structured_data`.

Lifecycle:

```
detected -> approved -> shipped -> crawled -> observed -> confirmed | rejected
                 \-> dismissed
```

Illegal transitions throw. Every transition writes an audit row.

Each action must carry:
- `evidence[]` — ids of observed claims / citations / crawler events. Empty = rejected.
- `assumptions[]` — stated in plain language.
- `expectedRange` — derived from a comparable-cohort baseline, never invented. If no
  comparable cohort exists, the range is `null` and the UI says
  "no comparable prior — this ships as an experiment".
- `experimentId` — every shipped action has one.

---

## 8. Experiment & outcome layer

Each experiment stores: baseline window + baseline measurement, treatment cluster ids,
**control cluster ids** (matched on family + demand decile, untouched by the action),
publish/crawl/index timestamps, post-window measurement, and analysis:

- Treatment delta vs control delta (difference-in-differences where controls exist).
- Two-proportion test -> `pValue`, `probabilityReal = 1 - p`.
- `alternativeExplanations[]` always populated (model version change, seasonality,
  competitor change, sampling drift, base-rate shift).
- Verdict: `confirmed | rejected | inconclusive` (inconclusive when underpowered).

Business outcomes (GA4/GSC/CRM/self-reported "how did you hear about us") are attached but
**labelled correlational**, with the AI-referral caveat stated inline.

---

## 9. Crawler intelligence

Bots are classified by **purpose**, not lumped:

| Class | Examples | What a fix means |
|---|---|---|
| `training` | GPTBot, ClaudeBot, Google-Extended | affects future model memory only |
| `search_index` | OAI-SearchBot, PerplexityBot | affects grounded answer retrieval — usually the one that matters |
| `user_fetch` | Claude-User, ChatGPT-User | affects live user-triggered fetches |
| `agent` | agentic browsers | affects task completion |
| `unknown` | unmatched UA | listed, never counted as signal |

Recommendations are scoped to the class that actually blocks the observed defect.

---

## 10. API surface

All routes are tenant-scoped; cross-tenant access returns 404 (not 403 — no existence leak).

```
POST   /api/auth/login | /api/auth/logout
GET    /api/dashboard                       -> three sections
GET    /api/defects/:id                     -> drill-down bundle
GET    /api/clusters                        -> per-family metrics
POST   /api/demand/import                   -> demand signals -> clusters
GET    /api/truth  | POST /api/truth        -> canonical claims (approval required)
POST   /api/runs/sample                     -> execute a sampling round
GET    /api/runs/:id
POST   /api/actions/:id/transition
POST   /api/actions/:id/experiment/analyze
GET    /api/experiments/:id
GET    /api/crawlers
GET    /api/entities
GET    /api/audit
GET    /api/methodology                     -> machine-readable methodology disclosure
```

---

## 11. MVP interface

The landing screen has exactly three sections:

1. **Critical answer defects** — "Claude and Grok incorrectly describe your acquisition status
   in 38% ± 8% of sampled answers (n=52)."
2. **Missed commercial demand** — "You are absent from 4 high-intent comparison clusters worth
   an estimated 31% of tracked category demand."
3. **Confirmed wins** — "After updating the integration page, supported citations rose from
   9% to 27%; probability the improvement is real: 96%."

Clicking any item opens the drill-down: sampled answers, conflicting canonical fact, cited
sources with support verdicts, recommended intervention with evidence and assumptions, and
experiment history.

No generic chatbot. No nine-section mega-dashboard. No AI-generated advice Kanban.

Secondary pages (reachable, not on the landing screen): Truth Registry, Intent Clusters,
Observatory (runs), Actions, Experiments, Crawlers, Entities, Methodology, Audit.

---

## 12. Providers

Adapter interface:

```ts
interface ProviderAdapter {
  key: string;                       // 'openai' | 'anthropic' | 'google' | 'perplexity' | 'simulated'
  surfaces: SurfaceDescriptor[];
  run(req: RunRequest): Promise<RunResult>;   // returns answer, citations, provenance, cost
}
```

Four grounded providers are targeted first: OpenAI, Google Gemini, Anthropic Claude,
Perplexity. Each real adapter is activated only when its API key is present.

A **deterministic simulated provider** (seeded PRNG, fixture corpus) is the default in dev,
CI and demo. It is not a mock of our own code — it is a stand-in *upstream*, producing
answers with realistic defect patterns so the whole pipeline is testable and reproducible
without spend. Runs are labelled `simulated: true` everywhere and are excluded from any
customer-facing claim.

### Unit economics (documented in `/methodology`)
50 clusters x 4 providers x 5 reps x 30 days = 30,000 answers/month. At current grounded
search-tool pricing plus tokens this is ~$400-$1,000/month of inference for robust daily
coverage — which is why statistically serious monitoring cannot be sold at $49.

Pricing: free one-time Answer Risk Audit; $750/mo (50 clusters, 4 surfaces, adaptive);
$2,000/mo (100 clusters, daily, truth registry, execution, experiments);
$5,000+/mo (multi-brand agency / enterprise, CRM, governance, export).
Billed on **monitored intent coverage and confidence**, not raw prompt count.

---

## 13. Security, tenancy, trust

- Every repository function takes `tenantId` as its first argument. A lint test asserts no
  SQL in `src/db/repo` reads a tenant-scoped table without a `tenant_id` predicate.
- Sessions are httpOnly cookies, random 256-bit ids, server-side stored.
- Append-only `audit_log` with actor, action, target, before/after hash.
- `/methodology` publishes sampling design, sample sizes, provider surfaces, known
  limitations and what we deliberately do **not** claim. Trust is the product.

---

## 14. Test strategy

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | stats, truth resolution, verifier, priority, intent classification, action state machine, crawler classification, entity graph, sampling planner |
| Integration | Vitest + real SQLite + HTTP inject | every API route, tenant isolation, audit, auth, full pipeline end-to-end |
| Copy/product lint | Vitest | banned claims, no bare percentages, no fabricated impact, closed action enum |
| E2E | Playwright (real Chromium) | all 12 user flows below, driven in a browser |

### The 12 user flows (must all pass in a browser)
1. Sign in / sign out, bad password rejected.
2. Landing screen shows exactly three sections with intervals and sample sizes.
3. Import demand signals -> clusters created with intent families.
4. Add + approve a canonical claim; supersede it and see the temporal history.
5. Run a sampling round; observe runs with full provenance.
6. Open a critical defect drill-down: answers, conflicting fact, citations, verdicts.
7. Missed-demand drill-down shows absent clusters with demand share.
8. Create an action from a defect; evidence-less action is rejected.
9. Move an action through the lifecycle; illegal transition blocked in UI.
10. Analyze an experiment -> confirmed win appears in section 3.
11. Crawler page classifies bots by purpose; entity page shows typed relations.
12. Methodology + audit pages; tenant isolation (second tenant sees none of tenant 1's data).
