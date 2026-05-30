# Reconcile Nostr messaging wire drift

Created: 2026-05-30
Model: GPT-5 Codex
Completed: 2026-05-30

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0080
- 0087

## Summary

Reconcile `specs/messaging.md` with the active Nostr event builders, parsers,
and service behavior in `@anchr/protocol/events` and
`@anchr/sdk/adapters/nostr`. The protocol profile should identify the canonical
wire helper surface and either align code to the spec or update the spec to the
implemented profile.

## Rationale

The protocol conformance audit in `docs/protocol-conformance-audit.md` found
that NIP-90 event kinds and basic causal links are implemented, but detailed
wire behavior has drift:

- `specs/messaging.md` describes encrypted kind `5300` request content, while
  `packages/protocol/src/events.ts` publishes JSON request content and relies on
  public tags plus signed content.
- The spec's request, offer, selection, proof submission, completion, and
  release payload tables do not exactly match the public `@anchr/protocol`
  payload types or the older SDK adapter-level event helpers.
- The spec's release retry-store and deletion policy are stronger than the
  current public event helper and Provider wait-loop coverage.

This issue should decide the Nostr profile contract before public SDK dogfooding
or release cleanup presents the wire format externally.

## Acceptance

- `specs/messaging.md` names the canonical implementation owner for each Nostr
  message class.
- Kind `5300`, `6300`, `7000`, and direct-message encryption behavior in code
  matches the spec, or each deliberate implementation-only deviation is removed
  from the public spec.
- Request tags, schema tags, `p` tags, `e` references, proof payload fields,
  Oracle-readable payloads, completion feedback, and release delivery semantics
  have focused tests or explicitly tracked follow-ups.
- `@anchr/protocol/events` and `@anchr/sdk/adapters/nostr` no longer appear to
  be two competing public wire contracts.

## Verification

- `deno task check`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- `NOSTR_RELAYS=ws://127.0.0.1:7777 deno task test:e2e:relay`
- `deno task test:all`
- `check-silent-bypass` review: no findings in
  `packages/sdk/src/adapters/nostr/index.ts`
- Manual check: `docs/protocol-conformance-audit.md` still maps the final
  messaging implementation and test owner.

## Plan

- Compare `specs/messaging.md` against `packages/protocol/src/events.ts` and
  `packages/sdk/src/adapters/nostr/`.
- Decide whether to change code, spec prose, or both.
- Add or update focused tests for any public wire behavior that changes.

## Resolution

Implemented by updating:

- `specs/messaging.md`
- `docs/protocol-conformance-audit.md`
- `packages/sdk/src/adapters/nostr/index.ts`
- `packages/protocol/src/events.test.ts`
- `docs/issues/pending/0080-prepare-public-release-cleanup.md`
- `docs/issues/pending/0094-standardize-nostr-completion-release-retry.md`

Verified with:

- `deno task check`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- `deno task test:e2e:relay`

Harness update:

- `packages/protocol/src/events.test.ts` now locks the canonical request,
  feedback, Oracle-readable result, and preimage delivery wire behavior; #0094
  tracks completion feedback and release retry-store semantics.

Review residuals:

- #0094 must decide whether completion feedback, FROST release messages, and
  retry-store deletion policy are universal Nostr wire contract or SDK adapter
  policy before public release.

Follow-up:

- #0094
