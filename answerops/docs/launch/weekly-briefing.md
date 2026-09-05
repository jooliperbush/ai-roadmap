# Weekly plan, check and report

## Customer flow

New audit conversions now receive a weekly schedule. Existing accounts choose **Weekly briefing → Enable weekly monitoring**. Existing daily schedules are not rewritten; pause unwanted old schedules separately.

Every Monday at 06:00 UTC the scheduler publishes a question plan. An hour after publication it automatically samples the planned questions. Delayed deployments publish when the worker resumes and still allow the one-hour review window. The plan records actual start time. Manual schedule runs may create a plan outside Monday.

Up to ten questions, five samples per question. Customer edits preserve the selected set between weeks. A pending plan is editable; a running plan is frozen and edits apply to future weeks. Customers can skip before execution, pause monitoring, and opt into plan/results emails to their account address. Original plan emails are snapshots; the app carries edits.

Live provider/model surfaces are recorded in each plan. Simulations are excluded from the weekly workflow, including adapters returning simulated output. Configured live providers also replace mixed simulation/live sampling in self-serve audits; no-key deployments retain the explicitly labelled demo audit.

Briefings include completed versus planned samples, potential issue groups, recorded facts, answer excerpts, evidence links and a recommended review action. New/continuing labels require an earlier complete run with identical question and provider snapshots. Issues absent in the next complete run are labelled not observed again, never proven fixed. Missing evidence remains visible; the app does not approve site-derived facts on behalf of the customer.

## Email provisioning required

The existing Resend transport is used. Production had neither `RESEND_API_KEY` nor `MISCITED_FROM` configured when this feature was built.

1. Use a verified sending domain in the owner's Resend account.
2. Add `RESEND_API_KEY` and `MISCITED_FROM` (an address on that verified domain) to the Miscited Railway production service. Never add keys to Git or chat.
3. Deploy variables; opt into weekly email on the account settings page.
4. Verify delivery to a user-approved test recipient. No external message was sent during implementation.

Plans and results work in-app without email. Durable email messages retry hourly up to three attempts, with stable Resend idempotency keys. Failures are visible and can be manually requeued without repeating sampling. Disabling email cancels outstanding pending/failed messages. Pausing monitoring suppresses pending delivery until resumed. Email submission success means provider acceptance, not proof of inbox arrival.

## Operations and limits

New schedules use a 50-sample round budget and $20 monthly model-spend budget. This is an internal estimated usage guard, not the proposed $49 subscription or an exact invoice cap. Actual provider costs can vary. Paid entitlement enforcement and checkout remain separate work.

Migration 011 adds weekly mode, a unique schedule per tenant/brand, job snapshots and an outbox. Existing rows default to legacy mode. Background ticks use leases, refresh long-running weekly leases, and atomically store plans/results with outgoing messages. Interrupted runs are marked incomplete instead of automatically repeated. Missed weeks are recorded explicitly.

Question suggestions following website changes and customer-selectable timezones are deferred. No claim of automatic source correction or guaranteed factual accuracy is made.

## Verification

Typecheck, all 1,048 application tests and 32 browser journeys passed. A five-sample live OpenAI check used the new two-stage scheduler in an isolated in-memory database: zero calls during planning, five live answers after advancing the test clock, no simulations or outgoing emails. Estimated provider cost $0.16556. Desktop and mobile views were inspected. This is not a production customer audit or an email inbox-delivery test.
