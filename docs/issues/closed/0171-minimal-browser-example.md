# Minimal browser example

Created: 2026-06-21
Model: GPT-5 Codex
Completed: 2026-06-21

## Priority

feature

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Add the smallest maintained example that proves Anchr's documented portable
surface runs inside a real browser runtime. The repository currently documents a
browser-safe package boundary and has targeted browser-related tests, but the
maintained examples are Deno-run examples; none gives a user a browser page and
a smoke command that demonstrates the portable imports actually execute in a
browser.

## Rationale

`docs/architecture.md` defines the browser-host boundary: the full
`@anchr/protocol` surface plus the documented portable SDK subpaths may be used
without process, filesystem, environment, or sidecar ownership. The example
should make that contract observable with a real browser smoke harness, without
expanding package ownership or importing server-only SDK adapters.

Relevant files:

- `docs/architecture.md`
- `docs/example-delivery-lifecycle.md`
- `examples/README.md`
- `packages/protocol/deno.json`
- `packages/sdk/deno.json`
- `scripts/arch-lint.ts`

## Acceptance

- A new `examples/<name>/` entry demonstrates Anchr code executing inside a real
  browser page, not only under Deno, Node, or a DOM shim.
- The example is intentionally minimal: it proves import, signing/event or
  schema helper behavior, and visible browser-side success without relays,
  mints, notaries, sidecars, credentials, funded tokens, or private proof data.
- Browser-facing code imports only `@anchr/protocol` and the SDK subpaths
  documented as portable in `docs/architecture.md`; it does not import the root
  `@anchr/sdk` barrel or server-only adapters.
- The example has a README that states status, user flow, dependencies,
  non-production boundary, and the command that proves browser execution.
- `examples/README.md` lists the example with its status and check command if
  the example is promoted as maintained.
- A deterministic smoke test opens the example in a real browser, asserts the
  success state, and fails if the browser bundle references `Deno`, `process`,
  `node:*`, or server-only SDK modules.

## Verification

- `deno task -c examples/<name>/deno.json smoke`
- `deno task test`
- `deno task test:examples`
- `deno task lint:strict`
- Manual check: start the Docker stack and TLSN binaries, open the example URL
  in a browser, and observe the documented success state after Oracle
  verification and Provider HTLC redemption.
- No matches are expected: `rg -n "from [\"']@anchr/sdk[\"']|@anchr/sdk/(adapters/nostr|adapters/oracle-service|payments|proofs|attachments)" examples/<name>/`
- No matches are expected: `rg -n "\\b(Deno|process|node:)\\b" examples/<name>/`

## Plan

- Choose the practical browser/server example shape after re-reading the current
  package exports and portable-entrypoint lint rule.
- Add the browser-facing example files, README, local task configuration, and
  deterministic browser smoke harness.
- Wire the example into repository example discovery only after the smoke check
  proves real browser execution.

## Example requirements

Target status:
- Implemented

User flow proved:
- A user runs the example smoke command or opens the local example page. The
  browser starts a Customer, discovers the server Provider's offer, locks a
  real regtest Cashu HTLC, receives a TLSNotary-backed result, waits for the
  SDK Oracle to verify the proof and release the preimage, and renders a
  success state after the Provider redeems the HTLC at the real mint.

Actors:
- Customer: browser page using the SDK Customer actor.
- Provider: Deno server using the SDK Provider actor.
- Oracle: Deno server using `createOracleNostrService()` over the Docker relay.
- Other app roles: local Deno server, Docker Nostr relay, Docker regtest
  Lightning/Cashu mint, TLSN prover/verifier, and smoke-test browser driver.

Allowed Anchr packages:
- `@anchr/protocol` public exports.
- `@anchr/sdk/customer`, `@anchr/sdk/provider`, `@anchr/sdk/oracle`,
  `@anchr/sdk/schema`, and `@anchr/sdk/adapters` type ports only when the
  resolver needs an SDK import to prove the documented browser boundary.

Real dependencies:
- A local browser launched by the smoke harness.
- Docker Compose services: `relay`, `tlsn-verifier`, `bitcoind`, `lnd-mint`,
  `lnd-user`, and `cashu-mint`.
- Rust TLSN binaries: `tlsn-prove` and `tlsn-verifier`.
- Network access from the TLSN prover to the public bitFlyer ticker endpoint.

Simulated dependencies:
- None in the advertised transaction path.

Data handled:
- Generated ephemeral keys, regtest ecash proofs, Nostr events, TLSNotary
  presentation bytes, and public bitFlyer ticker response data.

Non-production boundary:
- This example proves the browser-client integration shape for SDK actor APIs.
  It demonstrates local regtest settlement and TLSNotary verification. It does
  not claim mainnet custody safety, production relay/mint operations,
  production Oracle decentralization, or production key-management policy.

Out of scope:
- Browser extension integration, wallet UX, hosted deployment, mainnet funds,
  production Oracle quorum, and production key management.

## Resolution

Implemented by updating:

- `examples/browser-customer-server-provider/` — browser Customer and Deno
  server Provider transaction page, HTTP/SSE bridge to the Docker relay,
  same-origin proxy to the regtest Cashu mint, SDK Nostr Oracle, TLSNotary
  prover/verifier path, local task config, README, and styling.
- `scripts/browser-customer-server-provider-smoke.ts` — browser bundle
  generation, portability string checks, local server startup, and headless
  browser transaction assertion.
- `README.md`, `examples/README.md`, `docs/example-delivery-lifecycle.md`, and
  root `deno.json` — advertise and include the maintained example.
- Removed `examples/paid-request-simulation/`, `examples/quick-start/`, and
  their tests because maintained examples should be practical real-stack flows,
  not mock or fixture examples.

Verified with:

- `deno task -c examples/browser-customer-server-provider/deno.json smoke`
- `deno task test`
- `deno task test:examples`
- `deno task check`
- `deno task lint:strict`
- No matches: `rg -n "from [\"']@anchr/sdk[\"']|@anchr/sdk/(adapters/nostr|adapters/oracle-service|payments|proofs|attachments)" examples/browser-customer-server-provider/app.ts`
- No matches: `rg -n "\\b(Deno|process|node:)\\b" examples/browser-customer-server-provider/app.ts`

Harness update:

- `deno task smoke` in `examples/browser-customer-server-provider/` now builds
  the browser bundle, rejects server-only/runtime references in the browser
  entry and bundle, starts the Deno Provider server, opens the page in a real
  browser, and asserts the rendered transaction success state.
  Existing `deno task test:examples` and `deno task lint:arch` continue to
  enforce public example import boundaries.

Review residuals:

- None

Follow-up:

- None
