# Ship, send traffic, and learn from behavior

This replaces the interview-led sequence in the original launch plan. No scheduled customer interviews are required. Customer behavior can reveal friction and demand, although it will not always explain why people leave.

## Decision

Launch one specific job: **find an outdated or unsupported factual claim in an AI answer about your company, show the evidence, and make the next step clear.** Target SaaS founders and product/content marketers first. The agency channel can follow if those users show recurring use; it need not delay launch.

The site is already public. With no provider keys configured, it is currently suitable for demonstrating the workflow, not proving that a visitor’s company is misrepresented by real assistants. Spending heavily before connecting and checking a live provider would test interest in a demo rather than usefulness of the product.

## Implemented for a traffic-first experience

- With zero provider keys, the primary homepage CTA opens the existing worked example without email or signup. A short disclosure is visible beside the CTA; the optional audit is labelled a demo before submission. When a provider is configured, the CTA returns to the audit form.
- Allowlisted `utm_source` attribution now follows accepted audit requests. Supported values: `linkedin`, `x`, `producthunt`, `newsletter`, `partner`, `email`, `paid_search`, `github`; everything else is `public_site`. Campaign/content values are not persisted. No raw referrer or arbitrary source string is retained.
- Anonymous landing, example-view and primary-CTA events are aggregated by day and source. No visitor ID or tracking cookie is created. Optional browser events respect Do Not Track. Reloads and bots can affect counts; these are not unique visitors.
- An operator scorecard separates completed live reports with facts, live reports without checkable facts, simulated/mixed reports, empty reports, failures and monitoring activation. Account setup is not a payment, a reviewed finding, retention, or product-market fit.

Read the scorecard inside the application's runtime with:

```sh
node --import tsx scripts/traffic-scorecard.mts 2026-09-05
```

It opens the existing database read-only and does not seed or migrate it. `MISCITED_DB` selects an explicit database; otherwise the existing application defaults apply. It is deliberately not a public cross-workspace endpoint. Run it in the production container for live data; running it locally shows only local data. Operator shell access must be configured separately if unavailable.

## The next product improvements, in order

1. **Deliver one real audit reliably.** Configure one supported provider, cap the run budget, and run one permitted live case. Keep unavailable surfaces explicit. A smaller honest result is useful; a simulated result presented as live is not.
2. **Make the first finding understandable.** Start the result with the actual sentence, the conflicting source fact, the date and a concrete next step. Make missing evidence and “we could not read this site” obvious. Do not bury the useful result under portfolio features.
3. **Ask for commitment after value.** The example is ungated; an audit currently asks for email/domain. After a useful live result, invite the user to save it or enable monitoring. Test moving email later only after abuse/rate limits and anonymous-report recovery work; do not remove it blindly.
4. **Offer a small, fixed paid product.** Once delivery cost is known, test one clearly specified monitoring tier or periodic audit package. Avoid “book a call” as the only paid path. The site does not currently implement checkout: provider integration, usage enforcement, billing and terms need to agree before payment is accepted. A click on a price is interest, not a sale.
5. **Create a reason to return.** Tell users when the next scheduled check happens, expose its status and make comparisons easy. Only send alerts/email once delivery is configured and the user has chosen that behavior.
6. **Make results shareable deliberately.** Let a user choose which evidence to share; do not make private report URLs or customer domains appear in public analytics. Label sample versus live data and preserve the source date.

Do not rebuild more dashboards, add every model, or launch an agency program before checking whether users finish the core journey.

## A 14-day test without interviews

The following numbers are internal experiment caps/decision rules, not conversion benchmarks or performance forecasts. Reassess after observing the first cohort.

**Days 1–2:** connect and verify a provider, confirm a real report, check the aggregate counters and source attribution. Use the existing worked example for early organic feedback while this is pending. Write one narrow offer and use it consistently.

**Days 3–7:** publish a founder post and a 45–60 second product walkthrough on the channels where you already have reach. Show finding → evidence → next step, with simulated examples labelled. Use source-tagged links. Aim for the first 100 relevant visits from SaaS/product-marketing users, rather than buying a large unqualified audience. No interviews or calls are required; watch the recorded funnel and any unsolicited feedback.

**Days 8–14:** once at least five visitors have completed real audits with checkable facts, consider a $100–$200 total traffic test on one channel with a hard end date and daily cap. These are budget suggestions, not spend authorized or campaigns created here. Prefer traffic with explicit problem intent over generic “AI tool” reach. Review actual search terms/audience quality and stop if costs exceed the cap. A Product Hunt launch can follow a working self-serve path; do not make it the only source of users.

Do not buy GitHub stars. Ask useful-project users to star it optionally; stars do not substitute for product usage. Prepare Product Hunt around the real usable experience and feedback, following the rules linked in the main launch plan.

## What to change based on results

| Observation | Likely question to investigate | Product action |
|---|---|---|
| Landing events but almost no example/CTA events | Wrong audience or unclear promise? | Tighten the audience/message; inspect mobile CTA visibility |
| Example engagement but few audit requests | Demo not compelling, trust missing, or email friction? | Make evidence and privacy/coverage clear; test a simpler offer |
| Requests but failed/empty audits | Delivery or extraction issue? | Fix fetching/provider coverage before increasing traffic |
| Completed live reports but few monitoring activations | One-off problem or unclear recurring value? | Offer a periodic audit, clearer follow-up, or simpler save flow |
| Monitoring activated but nobody comes back | Weak recurring need or poor reminders? | Inspect completed scheduled rounds and chosen notifications |
| Repeat use but no paid commitment | Offer, price, or no billing path? | Test one bounded paid package and actual checkout |

At 100 relevant visits, treat the data as directional. At 10 completed live audits, examine raw outcomes rather than percentages without counts. If 200 relevant visits produce no completed live report despite a functioning pipeline, stop paying for traffic and revise the proposition or audience. If several people return voluntarily and complete a second review, prioritize that cohort. A zero-result audit can still be useful; do not manufacture defects to improve conversion.

## Limits of the current instrumentation

The implemented scorecard measures accepted requests and operational completion from first-party records. It does not yet measure unique visitors, subjective usefulness, human review completion, return cohorts or payment. Those remain the next instrumentation steps when the real path is working. Optional browser events can be blocked or spoofed; source tags are self-reported. Use them to compare direction, not to claim precise ROI.

Do not count simulated monitoring activation as validated live-product demand. Do not call public launch proof of product-market fit. The practical first milestone is a stranger getting an evidence-linked result and choosing to use the workflow again.

## Verification

TypeScript checking, all 1,038 unit/integration tests and all 31 browser journeys passed. New coverage checks provider-dependent CTA copy, event validation, attribution, report classification and Do Not Track. The original homepage-copy expectation has an explicit recorded contract change; other workflow expectations remain intact.
