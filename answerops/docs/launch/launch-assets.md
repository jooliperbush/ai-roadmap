# Miscited launch assets

Drafts prepared 5 September 2026. These are reviewable materials, not published posts. Verify the deployed URL, public repository version, live provider coverage and commercial offer before using them. No customer outcome, revenue figure, star count or testimonial is implied.

## Product Hunt listing draft

**Name:** Miscited

**Tagline:** Find wrong AI answers about your company

**Description:**

Miscited checks sampled AI answers against dated company facts. Inspect outdated prices and unsupported claims, follow citation evidence, track a source correction, and test what changes. Includes a labelled worked example; live coverage depends on configured providers.

**Suggested topic candidates:** Artificial Intelligence, Marketing, Developer Tools. Confirm the available taxonomy in the submission flow.

**Maker comment draft:**

Hi Product Hunt — I built Miscited around a question I wanted to make easier to investigate: when an assistant names a company, does it get the facts right?

The workflow connects a dated company fact, a sampled answer, the source behind it and a correction you can track. Then you can sample again and inspect whether the evidence supports a change.

There are deliberate limits. An API response is not the same measurement as a consumer app. Site-derived facts need review. A corrected page does not guarantee a changed answer. The example on the homepage is illustrative, and simulated reports are labelled.

I’d like feedback from SaaS content/product-marketing teams and agencies: is the evidence useful enough to decide what to fix, and what would you need before trusting the follow-up?

You can start with the worked example or request a bounded audit. I’ll be here to help with the workflow and hear what feels unclear.

**Gallery narrative:**

1. **Find the wrong fact.** Show the homepage example with the outdated limit highlighted. Visible caption: “Illustrative example — not a live provider result.”
2. **Inspect the evidence.** Show the dated fact, source reference and provenance, with provisional versus approved status clear. Use seeded data and label it.
3. **Track the follow-through.** Show an action, its approved correction and experiment state. If simulated, keep that disclosure on-screen. Never manufacture an improvement percentage.

Exported card files and reproduction command are listed in `README.md`. Confirm Product Hunt’s current accepted image dimensions and formats in the upload UI.

## 60–75 second demo storyboard

| Time | Screen/action | Spoken point |
|---|---|---|
| 0–8s | Homepage and highlighted outdated claim | “An answer can mention your company and still get a buying fact wrong.” |
| 8–18s | Example caption and source/dated fact | “Here’s a worked example. Miscited keeps the claim and the evidence together.” |
| 18–30s | Seeded report, provider/mode/date | “You can see what was asked and which surface answered. Simulated data stays labelled.” |
| 30–43s | Correction action and approval | “Turn the finding into a reviewable change to a source you control.” |
| 43–58s | Experiment view with sample counts/controls | “Ask again, compare, and keep uncertainty visible. A fix may not change the answer.” |
| 58–70s | Audit form and repo | “Try an audit or inspect the project. I’d like your feedback on the evidence workflow.” |

Record a real UI walkthrough; the storyboard is not a produced video. Use demo data, hide credentials/report tokens from public recordings, and display “Seeded demonstration” where appropriate.

## LinkedIn launch draft

Your product changed. The AI answer didn’t.

I built Miscited to make that mismatch easier to investigate: outdated pricing, retired plans and unsupported claims about a company.

The workflow connects the answer to a dated fact and its citation evidence, then helps you track a correction and a follow-up experiment.

I’m opening it up to B2B SaaS teams and specialist agencies. There’s a worked example on the site, clearly labelled as illustrative. Real audits depend on the configured model surfaces, and a source correction is not a promise that an assistant will change.

If you’ve dealt with an incorrect answer about your product, I’d be interested in how you discovered it and what you tried next.

Try the example: https://miscited.com/?utm_source=linkedin&utm_medium=organic_social&utm_campaign=miscited_launch_2026&utm_content=demo

Use this URL only after the reviewed site is deployed there. This work has not deployed it.

## X launch draft

Your product changed. The AI answer didn’t.

I built Miscited to connect wrong answers to dated facts, citation evidence and a correction you can recheck.

Try the worked example and tell me what evidence you’d need to trust it: https://miscited.com

## Opt-in email launch draft

**Subject:** Miscited is ready for a closer look

You asked to hear when Miscited was ready to try. The new site walks through how we investigate outdated facts in AI answers, connect them to evidence and track a correction.

Start with the worked example, or request an audit of your domain. Coverage depends on the configured providers, and simulated results are labelled.

I’d value your feedback on the report: does it make the next step clear?

https://miscited.com/?utm_source=email&utm_medium=launch&utm_campaign=miscited_launch_2026&utm_content=demo

Only use with people who actually requested an update. Do not substitute an unrelated mailing list or invent prior consent. No email has been sent.

## Agency conversation opener

“I’m testing an answer-accuracy workflow for SaaS teams. It links a dated product fact to an AI answer, its citation and a correction we can follow up. Would it be useful to walk through one client example you have permission to share, and see whether this could improve your existing reporting?”

Follow with discovery rather than a feature tour: who approves facts, who can edit the source, whether mistakes recur, and what proof the client needs. Do not imply that a competitor’s tool lacks a feature without checking it.

## GitHub README opening draft

# Miscited

AI answer accuracy for companies: dated facts, citation evidence, correction workflows and controlled rechecks.

Miscited helps you investigate whether AI answers describe your company accurately. It connects sampled answers with the facts and sources used to evaluate them, tracks reviewable corrections and measures follow-up results with uncertainty.

**Start here:** the application is in `answerops/`. Requires Node.js 22 or later. A local deterministic demo lets you inspect the workflow; live providers require separate API keys and incur usage costs. Read the application README for configuration and limitations.

```sh
cd answerops
npm ci
npm run dev
```

Before sharing these commands broadly, run them from a fresh clone on the intended supported platforms. The launch work used an existing dependency installation; a successful local test run is not a clean-install certification. Default local port is 4300 unless configured otherwise. To run an isolated, deterministic rehearsal with outbound providers disabled, use `node --import tsx scripts/e2e-server.mts` from `answerops/`; it serves port 4399 and deletes its temporary data on shutdown.

“If the workflow is useful, star the repository to find it again. Useful bug reports and reproducible examples are welcome too.”

License is still a founder decision. Do not call the project open source until a license has been deliberately added. This is a draft for the public repo’s root README, not a remote change.

## Starter issue briefs

- **Partial-provider audit coverage:** show an explicit attempted/succeeded/missing provider summary at the top of a report. Acceptance: injected single-provider failure is distinguishable from “no issue found”; no unavailable surface is counted as sampled.
- **Launch attribution:** persist an allowlisted campaign source on accepted audit requests. Acceptance: missing values default to public_site; invalid/overlong values are rejected or normalized; no report token/email leaks to analytics.
- **Pilot usage budget:** display the agreed sampling cap before monitoring is scheduled. Acceptance: the cap is validated server-side, the customer sees provider coverage and cadence, and a free audit never creates an implicit paid subscription.

These are uncreated issue proposals. Verify current behavior before opening one; do not label complex security/billing changes “good first issue” merely to attract contributors.

## Hacker News preparation — private notes only

HN’s rules prohibit generated or AI-edited posts/comments. The founder should write their own submission and responses, not paste a draft from this file. Prepare by answering privately: why did you personally build it; what can someone run without signing up; what is technically interesting; what assumptions make an experiment unreliable; what did an external tester find? Review the current guidelines linked in the launch plan.
