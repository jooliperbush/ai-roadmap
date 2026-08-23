# Miscited

**Find the AI answers costing you trust or customers. Correct them. Prove the correction worked.**

Miscited is not an AI-visibility dashboard. Visibility is an input; the product is an
operating loop:

```
canonical truth + real buyer demand
  → sample real model surfaces, with full provenance
  → verify every claim and citation against a dated truth registry
  → rank risk and upside with a published formula
  → ship controlled fixes as tracked experiments
  → measure crawl, answers and pipeline
  → feed back into truth and demand
```

The full product and technical specification is in [SPEC.md](./SPEC.md).

---

## Why this instead of a visibility dashboard

The failure mode that costs money is not "we were not mentioned". It is an answer that is
confident, positive, well-formatted and **wrong** — which a sentiment-and-share-of-voice tool
scores as a win. So the fundamental object here is not a mention. It is:

```
claim × buyer intent × model surface × market × time
```

Six commitments are enforced in code and covered by tests, not just written in the copy:

| Commitment | Where it is enforced |
|---|---|
| No blended visibility score — metrics are keyed by intent family | `assertNoBlending()` throws; `tests/unit/intent.test.ts` |
| No rate without its sample size and 95% Wilson interval; below the floor the number is suppressed | `domain/stats.ts`; `tests/unit/stats.test.ts`, `tests/e2e/flows.spec.ts` flow 2 |
| No alert on noise — two-proportion test, minimum effect, Benjamini–Hochberg | `domain/stats.ts`; `services/dashboard.ts` |
| No invented impact percentages — expected ranges come from this workspace's confirmed experiments or are null | `deriveExpectedRange()`; `tests/unit/priority.test.ts` |
| No spam vectors — the action catalogue is a closed enum | `ACTION_TYPES`; `tests/unit/product-copy.test.ts` |
| No "control what AI says" claims — measure, influence, correct | copy lint in `tests/unit/product-copy.test.ts` |

---

## What runs without anyone watching

The engine below was always good at turning an answer into a number. Phases 1 to 8 made it a
service rather than an instrument someone has to hold:

| | What it does | Where |
|---|---|---|
| **Schedules** | A leased daily or weekly loop samples on its own; a failed round marks its window partial so it can never become an experiment baseline. | `services/scheduler.ts` |
| **Budgets** | A round is priced before it spends and trimmed by dropping whole clusters, never by thinning one below the floor. | `domain/budget.ts` |
| **Alerts and delivery** | Findings reach a person by email, Slack or a signed webhook. Every body carries its sample size. | `services/alerts.ts`, `services/delivery.ts` |
| **Evidence locker** | Every cited page is fetched and stored by content hash, so "the cited page does not contain this claim" is still checkable after the page changes. | `domain/fetcher.ts`, `services/recheck.ts` |
| **Two-stage extraction** | A proposer widens recall; only `verifyClaim()` assigns a verdict; nothing survives that is not present in the text. Accuracy is measured and published. | `domain/extractor.ts`, `npm run eval:extractor` |
| **Self-serve audit** | A domain goes in, the real pipeline runs against it, and a dated report comes out at an unguessable URL. | `services/audit.ts`, `services/siteReader.ts` |
| **Connectors** | GitHub PRs and CMS drafts, never a publish. A failed connector leaves the action where it was. | `services/connectors.ts` |
| **Agency and markets** | Many brands per workspace, per-brand roles, and prompts fanned out across markets that are never pooled. | `domain/geo.ts`, `db/repo/agency.ts` |
| **Peek-proof statistics** | E-values for daily looks, a parallel-trends gate on difference-in-differences, per-version reporting. | `domain/sequential.ts` |
| **Accuracy index** | Opt-in, k-of-5 suppressed, six fields and no free text. | `services/index-report.ts` |

Two commitments were added to the six above, and are enforced the same way:

| Commitment | Where it is enforced |
|---|---|
| No mutating route without a declared minimum role, and no form post without a CSRF token | `domain/roles.ts`; the server refuses to boot otherwise; `tests/integration/security.test.ts` |
| No run recorded as free when its cost is unknown | `domain/pricing.ts` returns null, `cost_known = 0`; `tests/unit/foundation.test.ts` |

## Running it

```bash
npm install
npm start            # http://localhost:4300, seeds a demo workspace on first boot
```

The scheduler runs in the web process and is safe to run more than once, because a schedule is
claimed with a lease before it runs. Useful switches:

```bash
MISCITED_NO_SCHEDULER=1   # console only, nothing samples on its own
MISCITED_NO_FETCH=1       # never fetch a cited page
MISCITED_DEMO_FETCH=1     # serve the stand-in upstream's cited pages from memory
npm run scheduler -- --once      # one tick, then exit
npm run scheduler -- --digests   # send the weekly digests now
npm run eval:extractor           # re-measure the extractor and rewrite docs/extractor-eval.json
```

Sign in with the credentials printed on the sign-in page
(`ops@vanar.example` / `miscited-demo`).

By default the app samples a **deterministic stand-in upstream** rather than live providers,
so the whole pipeline is reproducible with no spend. Every such run is flagged `simulated`
in the database and in the UI, and simulated runs are excluded from any customer-facing
claim. Live adapters (OpenAI, Anthropic, Google, Perplexity) activate automatically when
their API keys are present:

```bash
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... GEMINI_API_KEY=... PERPLEXITY_API_KEY=... npm start
```

## Tests

```bash
npm test             # unit + integration (vitest, real SQLite)
npm run test:e2e     # every user flow in a real browser (playwright)
npm run typecheck
npm run eval:extractor   # fails the build if precision or recall lift drops below its gate
```

The e2e suite boots a fresh server against a fresh database and drives every flow through
the UI — sign-in, demand import, truth supersession, sampling, defect drill-down, action
lifecycle, experiment analysis, crawler and entity classification, methodology, audit and
tenant isolation.

## Layout

```
SPEC.md                     product + technical specification
src/domain/                 pure logic: stats, intent, truth, verifier, priority,
                            actions, experiments, crawlers, entities, sampling
src/providers/              adapter contract, deterministic stand-in, live adapters
src/db/                     schema, migrations, tenant-scoped repository
src/services/               observatory, demand, dashboard, action engine
src/web/                    server-rendered views and stylesheet
seed/simulation.ts          the Vanar seed world: truth registry, demand, belief profiles
tests/                      unit, integration, e2e
```

## Notes on the demo data

The seeded workspace is Vanar, chosen because fast-moving infrastructure brands are where
this product earns its keep: the facts change quarterly, models keep repeating the previous
version of the story, and being wrong about fees, listings or supply has consequences for
the reader.

The seed runs the real pipeline rather than fabricating a dashboard: it imports demand,
approves a temporal truth registry, samples a baseline, ships one evidenced action, samples
again and lets the experiment analysis reach whatever verdict the numbers support. One
seeded experiment comes back **confirmed**; a second, deliberately scoped one with a matched
holdout comes back **inconclusive**, because its control moved almost as much. That second
result is not a bug — it is the reason controls exist.
