# Miscited rebuild verification

Reference: original `8c114f6` in `/Users/ashmohamed/Documents/code/ai-roadmap`.
Candidate: branch `codex/miscited-rebuild` in `/Users/ashmohamed/Documents/code/miscited-rebuild`.

## Delivered architecture

- Replaced domain and provider implementations behind compatible exports, preserving verdicts, sample floors, provenance, simulated outputs, statistical decisions and pricing/catalog contracts.
- Replaced the 1,409-line HTTP server with a 47-line composition module, explicit feature route registrars, shared request authentication and resource-aware authorization.
- Rebuilt database bootstrap, migration execution and repositories: transactional migration ledger, bounded prepared-statement cache, typed identity records and atomic batch writes. New passwords use versioned scrypt; existing SHA-256 accounts still authenticate.
- Rebuilt services around explicit orchestration and shared answer/evidence persistence. Network work precedes synchronous atomic persistence. Configuration, background work and graceful shutdown have explicit owners.
- Rebuilt server-rendered presentation with shared components, keyboard navigation, responsive layouts, escaped metadata and evidence highlighting, and reduced-motion support.
- Persisted active brand per session, isolated temporary browser-test databases and removed dependence on live provider credentials from browser verification.

The original SQL migrations, editorial content, seed fixtures, public interfaces, declarative catalogs, deterministic PRNG/formulas and some trivial standard helper expressions remain specification assets. This is a subsystem rebuild, not a claim that every source character was replaced.

## Behavioral specification and coverage

The original test files and eight released SQL migrations are SHA-256 guarded by `legacy-manifest.json`. Existing assertions were not weakened. Frozen fixtures additionally cover registered HTTP routes, headings/form contracts for 15 representative pages, exported runtime symbols and 278 numerical outputs from the reference version. Numerical comparisons preserve exact decisions/narratives and use a 1e-10 tolerance for floating-point results.

New tests cover authentication upgrades, atomic rollback, tenant and brand isolation, independent browser sessions, SQL query bounds, configuration/shutdown, provider boundaries, connector failure/retry behavior, single-use audit conversion, historical detail context, rate limiting, escaping, responsive rendering and human edits during in-flight sampling.

The relationship-edit regression was demonstrated failing before correction: a provider callback changed Slack to a human-declared competitor, and stale sampling state overwrote it. Sampling now refreshes classifications immediately before writing observations; the test passes.

Tests are substantial regression protection, not proof of every possible behavior. Contract coverage and source replacement were reviewed separately.

## Verification — 2026-09-05

Run from `answerops/`:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 1,028 passed in 43 files |
| `npm run test:e2e` | 27 passed |
| `git diff --check` | Passed |

Original baseline: 549 unit/integration tests and 25 browser tests. New browser journeys retain all original flows and add keyboard/mobile and reduced-motion checks. Screenshots are generated under ignored `artifacts/rebuild/`; desktop dashboard, mobile dashboard and landing page were visually inspected.

An independent final review inspected sampling/evidence persistence, fetching, database/cache and runtime lifecycle. Its confirmed relationship race was fixed and regression-tested.

## Concrete improvements and limits

The seeded experiment metric calculation fell from 212 prepared statements to one (99.5% fewer); a regression test enforces the one-statement bound. This measures database work for that operation, not whole-product latency or a blanket “10x” speedup.

Security improvements include target-brand authorization, tenant-scoped audit history and citation snapshots, session-isolated brand selection, validated audit credentials, single-use audit conversion and login lockout checked before password verification.

Live API providers, real notification delivery, production deployment and production-load performance were not exercised. Providers/transports were injected or simulated. The existing accuracy-index quarter remains a label over stored history rather than a date filter. Delivery marks an alert delivered if any channel succeeds; failed sibling channels are not retried on later dispatch. Detached evidence labels remain accepted for compatibility, while existing foreign references are rejected. These are documented follow-up product decisions, not verified improvements.

The candidate remains isolated for review; the original checkout is preserved. No deployment, remote push or external message was performed.

## Subsequent marketing work

The following market/website task deliberately changes the public pricing offer. Its single
legacy SEO assertion update is recorded in `tests/fixtures/approved-contract-changes.json`;
the original manifest remains unchanged. The rebuild results above describe commit `91fdc71`.
See [launch verification](launch/README.md) for the subsequent tests and deliverables.
