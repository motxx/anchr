# Refresh chaos engineering report

Created: 2026-05-15
Model: Codex (GPT-5)
Completed: 2026-05-15

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`docs/chaos-engineering-report.md` has drifted from the current code and public vocabulary. Refresh it or explicitly archive it as a historical report so readers do not treat obsolete paths, states, and recommendations as current guidance.

## Rationale

The report still references `quote`, `quotes`, `quote_event_id`, and `awaiting_quotes`, while the current implementation and closed issue #0019 use Provider offer vocabulary such as `recordOffer`, `offer_event_id`, `offers`, and `awaiting_offers`.

The report also points to old `src/...` paths and old service names such as `src/infrastructure/oracle/oracle-server.ts`, while the current files live under `packages/bounty/src/...`, for example `packages/bounty/src/infrastructure/oracle-service/server.ts` and `packages/bounty/src/infrastructure/oracle-service/nostr-service.ts`.

Some findings appear to have been fixed already. For example, the report says `verifying` is not expirable, but `packages/bounty/src/domain/query-transitions.ts` includes `"verifying"` in `EXPIRABLE_STATUSES`, and `packages/bounty/src/domain/query-transitions.test.ts` covers that behavior.

## Plan

- Decide whether `docs/chaos-engineering-report.md` is an active maintenance document or a dated historical report.
- If active, update public actor vocabulary from Requester/Worker to Customer/Provider where appropriate, and update quote vocabulary to offer vocabulary.
- Replace obsolete file references with current `packages/bounty/src/...` paths and remove references to deleted locations.
- Recheck each recommendation against current code and tests, removing items already implemented or rewriting them as current residual risks.
- If historical, add a clear dated status note at the top and create or link a current chaos/resilience checklist.

## Resolution

Implemented by updating:

- `docs/archive/chaos-engineering-report-2026-04-06.md`
- `docs/resilience-checklist.md`

Verified with:

- `deno task lint:strict`

Harness update:

- `docs/resilience-checklist.md` now provides the current resilience review entry point and links the active architecture, protocol, messaging, and threat-model sources.

Review residuals:

- None

Follow-up:

- None
