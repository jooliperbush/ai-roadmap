# Miscited founder-led launch plan

Prepared 5 September 2026. Planning assumption: one founder, 10–15 hours/week for distribution, no existing audience or revenue supplied, and a $500 cash ceiling for the first month. Amounts are USD planning allocations, not supplier quotes. Work backward from a launch date chosen only after the readiness gates pass.

The first objective is **five qualified teams completing an evidence review and three paid pilot commitments**. Treat these as internal targets. A GitHub star is a discovery signal; a Product Hunt position is an event outcome. Neither proves activation, retention or willingness to pay.

## 1. Launch readiness before amplification

| Item | Current finding | Required action and owner |
|---|---|---|
| Product demonstration | Local deterministic demo and tested workflows exist | Founder: verify fresh installation and offer a no-login worked example |
| Live audit | Local tests use simulated/injected providers | Founder: configure selected providers, run a bounded real audit, verify status/failures/cost and clearly label absent surfaces |
| Commercial consistency | Homepage/metadata use early access; methodology labels historical prices; no billing implemented | Founder/product: settle real offer, usage caps, contracts and billing before accepting paid users |
| Public repository | `jooliperbush/ai-roadmap`, public; description is AI Literacy Roadmap; 0 stars/0 forks; no detected license | Founder: choose repository presentation and license, publish the verified branch, update About/homepage/topics; do not advertise open source before the license exists |
| Source review | Rebuild isolated and committed; launch changes local | Founder: review deployment diff and ensure sample/test data contain no real secrets or customer material |
| Operations | Local type/browser coverage exists; production unverified | Founder: verify HTTPS, domain, persistent database, restore procedure, scheduling, budgets, audit task recovery and support contact |
| Data handling | Audit stores email/domain/report | Founder: publish actual privacy/terms/contact information and decide retention/deletion handling before collecting public user data |
| Proof | Worked example, no verified customer case study supplied | Founder: obtain permission for any named customer result; otherwise use labelled synthetic examples |
| Measurement | No configured launch analytics claimed | Founder: add/verify the event plan below or use manual cohort records; do not claim the CSV is automated tracking |

For public launch, choose a real audited example after reviewing the source facts. Do not release a simulated finding as evidence that a named provider is wrong. Do not promise every configured provider worked until the report confirms actual coverage.

## 2. First 30 days: earn evidence before reach

| Window | Concrete work | Output / gate | Owner |
|---|---|---|---|
| Days 1–3 | Fix repository/offer readiness, run a real audit, rehearse from clean install, check domain and support | Runnable demo, correct repo presentation and one inspected real report | Founder |
| Days 4–7 | Build 30 SaaS + 20 agency target list from public business pages; prioritize recent plan/pricing/docs changes; begin permission-based conversations | 10 scheduled conversations; no scraped personal-contact blast | Founder |
| Days 8–14 | Complete 10 SaaS + 5 agency discovery interviews; offer the bounded correction sprint to qualified prospects | 5 evidenced problem examples; 3 pilot commitments target | Founder |
| Days 15–18 | Help pilots review facts, agree one correction each, document unresolved findings | 3 usable pilot records and a clear onboarding failure list | Founder + customer fact owner |
| Days 19–21 | Publish a technical walkthrough and sample fixtures; share the runnable project where relevant | First external clean-install attempts and reproducible issues | Founder |
| Days 22–25 | Finish Product Hunt listing assets, video, demo and maker narrative; test source links and small-screen signup | Launch package reviewed, at least 5 real users available to give independent feedback | Founder |
| Days 26–30 | Launch on Product Hunt when ready, then repurpose results into an evidence-led article and agency demo | Qualified audit requests, completed reviews and follow-up calls; ranking is secondary | Founder |

If pilots or live readiness slip, move the launch date. An event can amplify a working experience; it cannot substitute for one.

## 3. GitHub: a route to authentic stars

**Repository presentation.** Recommend eventually naming the repository `miscited`, or creating a clearly scoped public project if the existing repository includes unrelated learning material. Keep redirects/history implications in mind. This plan does not rename or publish it. Recommended About text: “AI answer accuracy for companies: dated facts, citation evidence, correction workflows and controlled rechecks.” Suggested topics: `ai`, `aeo`, `geo`, `fact-checking`, `typescript`, `fastify`, `sqlite`—select only accurate, available topics.

**README above the fold.** Show a one-sentence job, labelled product screenshot, a short worked example, demo instructions, prerequisites and the exact path to run it. Explain simulated versus live modes, usage costs and limitations. Add contribution guidance, a changelog, a security-reporting route and useful issue templates. The runnable app currently lives under `answerops/`; make that impossible to miss. License choice is a founder decision still outstanding, so source availability must not be presented as blanket reuse permission.

**Useful assets people can keep:** a dated-claim fixture format, a small synthetic evaluation set, a repeatable before/after experiment walkthrough, and a “five runs is not statistical certainty” notebook/article. Publish only assets that actually exist and can run. They give technical users a reason to save the project beyond a launch badge.

**First 50 stars, as a target rather than a promise:**

1. Get 10 external people to try the demo and report one confusing step. Fix the common failure before requesting broader attention.
2. Share one substantive technical artifact each week on founder channels, pointing to the repository and the relevant file.
3. Invite relevant newsletter/community maintainers to evaluate the project after checking their submission rules. No mass issue/PR posting to unrelated repositories.
4. Put a small optional CTA after the quickstart: “If the workflow is useful, star the repository to find it again.” Do not gate the sample or support on stars.
5. Add three genuinely scoped starter issues, each with expected behavior, relevant files and acceptance criteria; respond to contributions within two working days.
6. Review unique clones, visitors, issues, outside contributions and activated teams each week. A star spike without successful installation is a packaging/debugging problem.

No star purchases, exchanges, fake accounts, automated starring or rewards tied to stars. GitHub explicitly restricts rank abuse and inauthentic activity. [GitHub acceptable-use policy](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)

**Measurement:** snapshot stargazer count at T−7, T0, T+1, T+7 and T+30 using `gh repo view jooliperbush/ai-roadmap --json stargazerCount,forkCount`. Repository traffic may require owner access; inspect GitHub Insights or its traffic API promptly because its reporting window is limited. Do not attribute every star to one channel without referral evidence.

## 4. Product Hunt playbook

Use the official launch flow, supply a working product URL, concise tagline, description, thumbnail, useful gallery images, a short demo and a maker comment. Self-submission is viable; a paid hunter is unnecessary. Review current fields and media requirements in the submission UI just before preparing final uploads. [Product Hunt posting instructions](https://help.producthunt.com/en/articles/479557-how-to-post-a-product)

**T−14 to T−7:** use Product Hunt as a participant; collect genuine product feedback; choose a day the founder can support; prepare a 60–75 second demo and 3 gallery screens showing finding → source → follow-up. Write an honest limitation: API surfaces differ from consumer apps and fixes can be inconclusive. Ensure the linked repo contains the advertised version.

**T−7 to T−1:** create/review the scheduled listing, check every link, ask existing consenting users whether they want a launch announcement, and rehearse audit success, failure, mobile and no-provider states. Product Hunt advises preparing the community before launch and warns about paid promotion tactics that break its policies. [Preparation guide](https://www.producthunt.com/launch/before-launch)

**Launch-day relative runbook**—use the actual scheduled start shown in Product Hunt; convert it to Europe/London in the calendar rather than assuming a fixed offset:

| Time relative to start | Action |
|---|---|
| T+0–30m | Verify listing and live website, post founder’s reviewed maker comment, inspect the first audit end to end |
| T+1h | Publish founder LinkedIn/X announcement; send one launch note only to people who opted in |
| T+2–4h | Answer specific questions, reproduce reported failures, keep notes on objections |
| T+6h | Share a useful product walkthrough for a different time-zone audience; avoid repeating an empty promotional post |
| T+10h | Recheck costs, queues, rate limits and support; prioritize users over leaderboard watching |
| T+24h | Capture visits, completed reports, qualified conversations and bugs; thank participants |
| T+48–72h | Help interested users finish a review; publish an honest learning update |

Ask people to try the product and give feedback, not to upvote. Product Hunt specifically disallows asking for upvotes and rewards tied to them. No vote groups or “support for support.” [Promotion rules](https://www.producthunt.com/launch/sharing-your-launch)

Product Hunt success target: 20 completed reports, 5 qualified conversations and 2 pilot discussions attributed to the launch. These are planning targets with no forecasted probability. If the launch produces few visits but high activation, improve distribution; many visits but few reviews suggests offer/onboarding trouble.

## 5. Amplification beyond launch day

| Channel | Useful contribution | CTA | Cadence / success signal |
|---|---|---|---|
| LinkedIn founder profile | An annotated, permitted wrong-answer case and what the source actually says | Inspect the example / request an audit | 2 posts/week; qualified replies and completed reviews |
| X | Short screen recording, technical insight, honest failed experiment | Try the demo / inspect source | 2–3 substantive posts/week; relevant visits and issues |
| Agency partners | Co-review one client finding, then a small training session | Bring one client with permission | 2 partner conversations/week; recurring client use |
| Product Hunt | New-product demonstration and direct user support | Try and share feedback | One prepared launch, then follow-up |
| Hacker News | Runnable technical project with a personally written explanation | Try the project | Only when usable without signup friction |
| Relevant Reddit communities | Answer a question with a useful method and disclose authorship where linking is allowed | Optional artifact link | Check each community’s rules; no drive-by duplicate promotion |
| SEO/content newsletters | Pitch the measurement lesson or reproducible artifact | Read the walkthrough | 3 personalized editorial pitches/week after proof exists |
| Owned writing | Search-intent articles with worked examples and product limits | Worked example → audit | 1 strong article/week for 6 weeks |

HN requires something people can try and discourages signup barriers. Its guidelines also prohibit soliciting votes/comments and publishing generated or AI-edited text. **The founder should write HN submissions/comments personally; the launch-assets file provides only private preparation questions for this channel.** [Show HN requirements](https://news.ycombinator.com/showhn.html), [HN guidelines](https://news.ycombinator.com/newsguidelines.html)

Recommended first four article topics: “How to check whether an AI answer uses an old price”; “Why five answers are not enough to prove a correction worked”; “API results and consumer-chat results are different measurements”; “A correction experiment that did not work—and what we learned.” The last requires a real documented experiment before publication; do not invent it.

Each real, permissioned case becomes one long-form walkthrough, one 60-second clip, three annotated images, one agency training example and a fixture when rights permit. Keep the same evidence and caveats in every version.

## 6. Days 31–90

**Days 31–60:** observe repeat use, improve the top two onboarding blockers, repeat the sprint offer with comparable prospects, and build 2–3 active agency relationships. Publish one permitted case with complete sampling context. Test $149 monitoring only after costs and responsibilities are clear. Internal target: 10 active teams, 5 paying accounts, 2 recurring agency partners.

**Days 61–90:** double down on the channel producing paid continuation; introduce a repeatable agency onboarding pack; decide whether the business is software, a periodic correction service, or a combination. Target 10 paying accounts and 50% of the first paid cohort still completing reviews at day 60; these are internal gates, not industry benchmarks. Stop low-quality promotion. Consider a small newsletter sponsorship only after a source has produced qualified conversations organically.

## 7. Budget and measurement

First-month $500 cash ceiling: $150 bounded live-audit/provider usage, $50 hosting/storage allowance, $50 demo production tools if needed, $150 reserved for one relevant newsletter experiment after activation is demonstrated, and $100 contingency. Unspent allocations remain unspent. Founder time is additional: 10–15 hours/week for discovery, content, support and distribution. No paid acquisition before measuring the full audit-to-review journey.

Event plan (to implement/verify before public launch): `landing_view`, `audit_started` after server acceptance, `audit_completed` on completed report status, `report_viewed`, `finding_reviewed`, `correction_started`, `followup_reviewed`, `pilot_paid`. Record timestamp, source/campaign, deployment mode and pseudonymous workspace/account ID; exclude raw email, domain, prompt and report-token URLs from third-party analytics.

UTM convention: `utm_source=linkedin|x|producthunt|newsletter|partner`; `utm_medium=organic_social|launch|referral`; `utm_campaign=miscited_launch_2026`; `utm_content=demo|case01|methodology`. The present audit endpoint stores `public_site`; it does not persist these UTMs. Use manual attribution in pilot conversations until an explicit attribution implementation is tested.

Activation = a live (not simulated) report with at least one human-reviewed finding or a consciously reviewed “no material issue” outcome. Rate = activated teams / completed live reports, reported with counts. Primary weekly metric = teams completing a review and returning for a follow-up. Revenue metric = paid pilot acceptance and continuation. Track stars and listing engagement separately; do not optimize the former at the expense of product use.

Use `launch-tracker.csv` for planned work; actual fields start empty. Every Friday record cohort counts, acquisition source, spend, review time, objections and next decision. Pause a channel after two substantive attempts produce no qualified conversations; inspect the message/audience before buying more reach.
