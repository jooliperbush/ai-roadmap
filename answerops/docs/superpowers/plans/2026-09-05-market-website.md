# Market Website Implementation Plan

**Goal:** Deliver source-backed positioning, a runnable new marketing website and an actionable launch kit.

**Architecture:** Keep the existing public Fastify route and audit contract; replace marketing composition and CSS, share FAQ data between HTML and structured metadata, preserve all existing tests.

**Tech Stack:** TypeScript, semantic HTML/CSS, existing progressive-enhancement JavaScript, Vitest and Playwright.

- [x] Inspect product, repo metadata and official competitor/pricing/platform sources.
- [x] Choose a documented position and visual direction in the matching design spec.
- [x] Add `tests/unit/launch-site.test.ts` for partial-provider copy, honest early-access offer and matching public FAQ; run it and observe failure.
- [x] Replace `src/web/views/landing.ts`, `src/web/public/landing.css`; update `src/http/public-copy.ts` and `src/web/seo.ts` to align offer and provider limits.
- [x] Add `tests/e2e/launch.spec.ts` for menu/FAQ/keyboard, audit success and failure, and screenshots at 390/768/1440px. Keep the original exhibit and audit tests intact.
- [x] Write `docs/launch/market-analysis.md`, `launch-plan.md`, `launch-assets.md` and `launch-tracker.csv`, clearly separating sourced observations and hypotheses.
- [x] Run typecheck, all unit/integration tests and all browser tests; inspect desktop/mobile screenshots and fix regressions.
- [x] Record final evidence, commit the candidate and open the website preview for review.

Verification commands: `npx vitest run tests/unit/launch-site.test.ts`; `npm run typecheck`; `npm test`; `npm run test:e2e`; `git diff --check`.
