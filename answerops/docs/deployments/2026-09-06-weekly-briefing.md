# Weekly briefing production deployment — 6 September 2026

- Application commit: `18fdce8`.
- Railway production service: `miscited`.
- Deployment: `7c97ba77-53ce-4bcd-a000-fcb7179cce76`, SUCCESS.
- Additive migration 011: weekly schedule metadata, durable jobs and email outbox.
- All 1,048 application tests and 32 browser journeys passed. After tightening provider-snapshot matching, TypeScript and all ten weekly integration tests passed again.
- A real OpenAI test exercised the new two-stage scheduler in memory, with zero planning calls followed by five live samples after test-clock advancement. Estimated cost $0.16556; zero simulated answers and zero emails.
- Live verification: health HTTP 200; anonymous `/weekly` HTTP 302; authenticated `/weekly` HTTP 200 with Monday timing and missing-email-configuration disclosure. No production schedule was enabled, customer audit created, or external email sent by verification.

New self-serve conversions default to the Monday workflow. Existing schedules remain unchanged and existing accounts explicitly enable it. Configured self-serve audits now use live providers rather than mixing them with simulated samples; unconfigured demos remain labelled.

Email is not active: `RESEND_API_KEY` and a verified-domain `MISCITED_FROM` are still required in Railway. See [setup and behavior](../launch/weekly-briefing.md). Provider acceptance and inbox delivery have not been verified. Existing dependency-audit notes from the earlier deployment still apply; this feature did not update dependencies.
