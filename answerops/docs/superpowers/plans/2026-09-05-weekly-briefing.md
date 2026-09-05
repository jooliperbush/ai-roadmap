# Weekly briefing implementation plan

User approved automatic Monday planning, sampling and reporting. Implement in the existing candidate worktree.

1. Add a weekly mode to schedules and a tenant-scoped durable weekly job/outbox ledger. Existing schedules remain unchanged; new self-serve monitoring defaults weekly. Freeze up to ten selected questions and provider surfaces in each Monday plan. Run after one hour, automatically. Expose UTC timing explicitly.
2. Extend sampling with optional exact planned questions, minimum five samples each, rejecting simulated answers in live-only mode. Preserve existing generic demo callers. Self-serve production audits prefer configured live providers; no-key demos remain labelled.
3. Hook two-stage jobs into scheduler leases. Retried ticks must not repeat finished jobs or overlapping runs. On uncertain interrupted runs report incomplete rather than spend again. Carry explicit failure/partial status and retry notification delivery with bounded attempts and stable provider idempotency keys.
4. Add weekly page with next question set, plan/result history, skip and pause links, manual run via existing schedules, question editing, explicit email opt-in and status. No mailbox promises without configured Resend key and verified sender. No external test email without a user-selected recipient.
5. Briefing compares potential misconception keys across completed comparable jobs, names new/continuing/not-observed, links evidence, and avoids equating absence with correction. Count samples and missing coverage explicitly; no automatic factual approval.
6. Test Monday timing, snapshots, live-only selection, pause/skip, no-provider failure, retry/deduplication, tenant/role boundaries and render/replay regressions. Run typecheck, full application/browser suites. Deploy and read-only smoke check; document email provisioning blocker if credentials absent.

Deferred: automatic new-question suggestions from website changes, timezone selection, paid billing allowances, statistically attributing improvements to a source edit. Existing question/fact controls remain available.
