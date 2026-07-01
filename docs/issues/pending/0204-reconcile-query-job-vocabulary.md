# Reconcile Query/Job vocabulary with CONTEXT.md

Created: 2026-07-02
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

CONTEXT.md forbids "Query"/"Job"/"task" under the "Paid Request" glossary entry,
yet those are the dominant identifiers across ~47 source files and appear as the
canonical kind names in the wire spec. The repo rule says CONTEXT.md vocabulary
must be used in code, docs, and specs; this is the most pervasive glossary
violation. Decide whether to grandfather the terms or rename toward the glossary
before doing a large rename.

## Rationale

- `CONTEXT.md` (~line 9): _Avoid_ Query, job, task.
- `packages/protocol/src/nostr.ts` (~lines 25-29
  `KIND_QUERY_REQUEST/RESPONSE/FEEDBACK`), `events.ts` (~line 27
  `QueryRequestPayload`), the `Query` aggregate / `query-service.ts` /
  `query-verifier.ts`, and `specs/messaging.md` (~lines 51-53 "Job
  Request/Result/Feedback").
- `query_id` as a raw wire field is grandfathered by architecture.md ~line 279;
  internal type/const/module names and spec table labels are not wire fields.

## Acceptance

- A recorded decision: either CONTEXT.md accepts "Query"/"Job Request" as
  grandfathered synonyms with an explicit note, or the internal identifiers and
  the messaging.md kind-table labels are renamed toward "Paid Request". Follow-up
  rename issues are created if the decision is to rename.

## Verification

- CONTEXT.md and the code/specs agree; no un-annotated glossary contradiction
  remains.

## Plan

- Decide grandfather vs rename; if rename, split the code and spec renames into
  child issues.
