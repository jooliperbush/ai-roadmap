# Miscited market and launch kit

**Recommendation:** AI answer accuracy for B2B SaaS, with specialist agencies as an initial partner channel. Validate paid correction sprints before treating recurring monitoring as a proven business.

## Read in this order

1. [Market analysis](market-analysis.md): competitive landscape, buyer fit, pricing hypotheses, revenue scenarios, risks and discovery gates.
2. [Launch plan](launch-plan.md): readiness, GitHub discovery/stars, Product Hunt runbook, amplification, budget and 30/60/90-day milestones.
3. [Launch assets](launch-assets.md): listing and founder-post drafts, demo storyboard, README opening and issue briefs.
4. [Launch tracker](launch-tracker.csv): editable targets with empty actual/spend fields; no automated analytics is implied.

## Website and artwork

The implemented site is the anonymous `/` route in this app. It uses the existing audit endpoint and sign-in flow, with a new editorial layout, responsive styling, visible FAQs, consistent early-access metadata and honest live/simulated coverage.

- [Position card](assets/01-position.png)
- [Evidence card](assets/02-evidence.png)
- [Workflow card](assets/03-workflow.png)
- [240px thumbnail](assets/thumbnail-240.png)

Cards are 1270 × 760 PNGs, original typographic artwork with synthetic examples, ready to review for a launch gallery. Confirm the platform’s current upload requirements. Reproduce with `node --import tsx scripts/launch-assets.mts`. The demo video is a storyboard, not a rendered video.

Website screenshots are in ignored `artifacts/launch/`: `website-390.png`, `website-768.png`, `website-1440.png`, `website-hero.png`. Browser tests regenerate them.

## Verification and deliberate contract change

The market/website work follows rebuild commit `91fdc71`. All original workflows remain covered. One intentional marketing change updates the original SEO test’s paid price expectation to the free audit; its new hash and original reference hash are recorded in `tests/fixtures/approved-contract-changes.json`. This is a new offer decision, not a hidden relaxation of the rebuild’s compatibility promise. The old fixture manifest is unchanged. All other original assertion files and released migrations retain their hash guards.

**Verified:** `npm run typecheck` passed; `npm test` passed 1,034 tests in 44 files; `npm run test:e2e` passed all 29 browser journeys; `git diff --check` passed. Desktop and mobile rendering and the evidence launch card were visually inspected. The shared preview graphic resolves from the static route. No website deployment, repository rename, remote publication, Product Hunt submission, email delivery or social post has been performed. The current public repo is still packaged as AI Literacy Roadmap and has no detected license; resolve that before calling it open source. Historical methodology prices are now labelled as old planning examples. Paid terms and billing still require a founder decision before a commercial launch.

Research and targets are dated 2026-09-05. Commercial assumptions have not been validated by customer interviews or live pilot payments.
