# Fix or remove the relay Oracle service correctness cluster

Created: 2026-06-11
Model: Claude Fable 5

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The publicly-exported relay Oracle service (`createOracleNostrService`, from
`@anchr/sdk/adapters/nostr`) is non-functional against the canonical wire
contract and releases payment unsafely. Four audit findings share this one
surface and must be fixed together, or the surface must be explicitly removed
from v0. No example or e2e flow currently wires it, so the surface is shipped
but unexercised.

## Rationale

From the 2026-06-11 production-readiness audit §2.5/§2.6:

- **SPEC-01 (blocker)** — `packages/sdk/src/adapters/nostr/events/events.ts:42-64`
  defines `OracleResponsePayload` as `{nonce_echo, attachments[], notes}` and
  `parseOracleResponsePayload` does `JSON.parse(decrypted) as OracleResponsePayload`
  with no validation. The canonical Oracle-readable payload
  (`packages/protocol/src/events.ts:337-384,429-469`, spec
  `specs/messaging.md:185-197`) is `{schema, data, proof, query_id,
  request_event_id}`. The two share only the `oracle_payload` tag name, so a
  spec-conforming Provider response is read as empty.
- **PROT-02 (high)** — `packages/sdk/src/adapters/nostr/oracle-handlers.ts:23-38`
  `buildQueryFromPayload` hardcodes `verification_requirements: ["gps",
  "ai_check"]`, empty `description`/`challenge_rule`, `expires_at:
  Date.now()+600_000`, and no `tlsn_requirements`/`expected_gps`. The release
  decision verifies against this synthetic requirement; the payload `schema` is
  never used to dispatch a verifier.
- **PROT-01 (high)** — `packages/sdk/src/adapters/nostr/oracle-service.ts:139-145`
  skips the selected-Provider binding check when `selectedProviderPubkey` is
  unset (it is set only by the public `recordSelectedProvider`, which no relay
  handler auto-invokes). The preimage DM then goes to the first submitter and
  the store entry is deleted, stranding the legitimately selected Provider's
  bound token.
- **SPEC-03 (medium)** — `parseOracleResponsePayload` and `parseOracleDM`
  (`packages/sdk/src/adapters/nostr/events/dm.ts:117-128`) cast decrypted JSON
  with no discriminant/field validation.

## Acceptance

- The relay Oracle path either verifies against the real `Query` (its actual
  `verification_requirements`, `tlsn_requirements`, GPS policy, `quorum`,
  `visibility`) and reads the canonical `oracle_payload` shape, or
  `createOracleNostrService` and its non-canonical payload reader are removed
  from the public surface and the deletion is recorded.
- If kept: a result from a non-selected/unrecorded Provider produces no
  preimage DM; decrypted Oracle/DM payloads are validated before use.

## Verification

- `deno task test:unit`
- A new `*.integration.test.ts` runs a real `buildQueryResponseEvent` through
  `createOracleNostrService` on an in-memory relay and asserts release happens
  only when the real requirement is met.
- `deno task lint:strict`

## Plan

- Re-read `oracle-service.ts`, `oracle-handlers.ts`, `events/events.ts`, and
  the canonical `@anchr/protocol/events` parser to decide keep-and-fix vs
  remove-from-v0. This issue may be split with `make-issues` if keep-and-fix
  is one change too large.
- If kept: replace `parseOracleResponsePayload` with
  `parseOracleQueryResponseEvent`, carry the real `Query` into the watched
  entry, make the selected-Provider gate fail closed, and validate DM payloads.
- Lock each fix with a test that proves the bypass is closed.
