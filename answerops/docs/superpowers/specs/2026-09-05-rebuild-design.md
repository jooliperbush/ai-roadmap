# Miscited rebuild design

## Authority and scope

The user authorized a complete rebuild, using the old version as the specification, with a development plan and tests written before replacement implementation. The reference is git commit `8c114f6` in `/Users/ashmohamed/Documents/code/ai-roadmap/answerops`. Work happens in `/Users/ashmohamed/Documents/code/miscited-rebuild/answerops` on `codex/miscited-rebuild`. The reference checkout and customer databases are not modified.

## Approach

A clean replacement behind existing contracts is preferred to either a cosmetic refactor or a simultaneous framework/database migration. Keep TypeScript, Fastify, SQLite and server-rendered pages to preserve deployment and data compatibility. Replace implementation by bounded subsystem, with compatibility exports where needed. Preserve editorial content, deterministic seed fixtures and released SQL migrations as product data/specification; do not rewrite historical migrations. New migrations are additive.

Preserve all existing product capabilities: authentication, tenant and brand access, demand clustering, dated truth approval and supersession, sampling across providers and markets, cost accounting, grounded extraction and verification, citation evidence and rechecks, priorities, action lifecycles, experiments, crawl classification, entity relationships, scheduling, budgets, notifications/digests, public audit conversion, accuracy-index consent and suppression, marketing/blog/SEO and JSON APIs.

## Replacement boundaries

- HTTP: explicit route modules with a small composition root, shared request-scoped authentication/context, fail-closed route authorization and centralized error handling.
- Domain/providers: independently testable deterministic rules and adapters. Preserve statistical formula outputs, simulation determinism and provider provenance. Separate runtime I/O from mathematical rules.
- Persistence/services: compatible schema and exports, atomic writes, batched reads, explicit dependencies, reliable worker lifecycle, isolation at every database boundary.
- Presentation: reusable escaping-by-default UI primitives, smaller page modules, semantic accessible HTML, responsive layout, all existing navigation/actions/test contracts.

## What “better” must mean in evidence

“10x” is an aspiration, not a claim supported merely by a rewrite. Record actual measurements and regressions. Targets: eliminate the 1,409-line HTTP composition monolith; remove per-user mutable brand-selection state from request rendering; introduce versioned memory-hard password hashes while retaining old account login; transactional migrations; preserve every legacy test assertion; add complete route inventory and representative differential HTTP behavior tests; demonstrate browser workflows; document remaining external-provider verification limits. Additional subsystem improvements must have tests.

## Compatibility oracle

The 549 existing unit/integration tests and existing Playwright flows remain regression requirements. Add characterization tests for every declared route, authentication boundaries, deterministic public responses, response headings/forms and representative seeded read APIs. Compare the reference and replacement using isolated SQLite databases and injected simulated providers/transports. Normalize only nonsemantic nondeterminism (generated identifiers, dates, CSRF tokens). Never normalize away rates, verdicts, role decisions, evidence, costs or action state.

New safety behavior is tested independently rather than turning a historical vulnerability into a compatibility requirement. Existing data and public URLs remain compatible. No paid provider requests, external notifications, deployment or database replacement are required to validate the rebuild.

## Completion gate

All baseline and added tests pass; typecheck passes; browser workflows pass against a fresh isolated database; source diff and compatibility coverage reviewed; startup/shutdown verified; original checkout clean. Report implementation coverage and any remaining scope honestly. Passing tests alone does not prove that every possible behavior is covered or that the system is ten times better.
