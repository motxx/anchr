# Add runnable Quick Start

Created: 2026-06-01
Model: GPT-5 Codex
Completed: 2026-06-10

## Priority

feature

## Dependencies

Depends on:
- 0088
- 0097
- 0098

Blocks:
- 0080

## Summary

Replace the root README API sketch with a Quick Start that users can run and
see a result from. The first code path should use the real SDK surface and a
real Nostr relay configuration, while keeping non-production payment behavior
explicit until a production-safe setup is available.

## Rationale

The current README discussion exposed a DX problem: a copy-paste code block
that cannot run teaches the API shape but does not prove the project works.
Fake-only success is also misleading. A useful Quick Start should exercise the
actual SDK and relay path, produce an externally observable relay round trip,
require only minimal Nostr knowledge, and avoid presenting public relay
plaintext as the normal way to pass private execution or payment material.

This should build on #0088 instead of creating a separate examples track.

Relevant files:

- `README.md`
- `packages/sdk/README.md`
- `examples/`
- `docs/example-delivery-lifecycle.md`

## Acceptance

- Root README has a `Quick Start` section whose commands and code path are
  runnable from a clean checkout after documented prerequisites are installed.
- The flow uses a user-configurable Nostr relay list rather than requiring a
  local relay container for the first result.
- The flow produces a real relay round trip with SDK-built events.
- Any dry-run, simulation, or test-only payment boundary is narrower than the
  whole example and is named in the body text.
- The first README code path avoids non-public data in public relay content.
- A deterministic smoke test detects SDK/API drift for the Quick Start without
  depending on a third-party public relay.

## Verification

- `deno task test:examples`
- `deno task test:all`
- Manual check: run the README Quick Start from a clean checkout using a
  user-supplied relay URL.
- Manual check: the smoke test uses a deterministic relay target and does not
  publish CI events to third-party public relays.
- Manual check: the section title is concise and does not pack explanatory
  qualifiers into the heading.

## Plan

- Use #0088 to select or create the smallest verified public example.
- Wire the root README Quick Start to that example instead of an illustrative
  API-only sketch.
- Keep payment and relay assumptions explicit in the body text, not the
  heading.

## Example requirements

Target status:
- Testnet

User flow proved:
- A user supplies a relay URL; the example publishes a kind 5300 Public
  Request Advertisement under a fresh ephemeral keypair and prints the
  advertisement the relay echoes back. Success = echoed `query_id` matches.

Actors:
- Customer: the single CLI actor (publish + subscribe).
- Provider: none (out of scope for this lesson).
- Oracle: none (a placeholder pubkey fills the advertisement field).
- Other app roles: none.

Allowed Anchr packages:
- `@anchr/protocol/events`, `@anchr/protocol/nostr`, `@anchr/sdk`
  (`createRelayClient`, `ProofSchema`), `@anchr/sdk/testing` (smoke only).

Real dependencies:
- One user-supplied NIP-01 Nostr relay.

Simulated dependencies:
- The smoke test swaps in `createInMemoryRelayClient` from
  `@anchr/sdk/testing`; no payment, proof, or oracle services exist.

Data handled:
- Public discovery fields only; fresh ephemeral keys per run.

Non-production boundary:
- No payment is locked; no proof is produced or verified; not a custody or
  production-readiness claim.

Out of scope:
- The full exchange (owned by `paid-request-simulation`), relay selection
  guidance, and production key management.

## Resolution

Implemented by updating:

- `examples/quick-start/` — `mod.ts` (publish + echo-back round trip),
  `main.ts` (CLI), `mod.test.ts` (deterministic smoke), `README.md`
  (status, flow, boundaries, runbook), `.env.example`, `deno.json`
  (`smoke` task); added to the root workspace.
- `packages/sdk/src/testing/relay.ts` — `createInMemoryRelayClient`, the
  deterministic relay used by the smoke test; `examples/paid-request-simulation`
  and `e2e/protocol/anonymous-relay-flow.test.ts` now consume it instead of
  their own copies.
- `README.md` — runnable Quick Start section (clean checkout + user-supplied
  relay; payment boundary named in body text) and a `quick-start` row in the
  examples table.
- `docs/example-delivery-lifecycle.md` — advertised-example inventory updated.
- `deno.json` — `test:examples` now also discovers the root-level
  `examples/*.test.ts` files, which the workspace walk silently skipped.

Verified with:

- `deno task test:examples` (5 tests, including the deterministic smoke)
- `deno task test:all`
- Manual check: `NOSTR_RELAYS=wss://relay.damus.io deno run --allow-net
  --allow-env examples/quick-start/main.ts` published event
  `19a5fedc04a311fd...` and received the echo from the live relay.
- Manual check: the smoke test contacts no third-party relay (in-memory
  client only).

Harness update:

- The quick-start smoke runs in `test:examples` and catches SDK/API drift;
  `test:examples` discovery fix prevents silent example-test skips.

Review residuals:

- None

Follow-up:

- None
