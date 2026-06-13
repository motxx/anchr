# Custom proof schema verified end to end via the public registration API

Created: 2026-06-13
Model: Claude Fable 5
Completed: 2026-06-13

## Priority

feature

## Dependencies

Depends on:
- 0159

Blocks:
- 0148

## Summary

Child of 0148. Prove the schema-extensibility premise end to end: an e2e test or
example registers a CUSTOM schema URI with an out-of-tree producer/verifier pair
through the public registration API from 0159, and a paid request using that
schema is produced, submitted, verified, and released — without editing
`packages/`.

## Rationale

- The registration API from 0159 is only proven if a schema that is not TLSN or
  C2PA can be implemented entirely through the public surface and verified end
  to end.
- This is the acceptance evidence 0148 requires that a third-party schema can
  ship without forking the SDK.

## Acceptance

- An e2e (`e2e/protocol/`) or example (`examples/<name>/`) registers a custom
  schema URI with a producer/verifier pair defined outside `packages/`, reaching
  Anchr only through `@anchr/*` (no relative import into `packages/<pkg>/src`,
  per E023).
- The custom-schema proof is produced and verified end to end through the
  shared verification path using the schema-scoped payloads.

## Verification

- The new e2e passes: `deno task test:e2e:protocol` (or the example smoke task
  if delivered as an example).
- `deno task lint:strict` passes (E023 import-boundary check included).

## Plan

- Define a minimal custom schema (producer + verifier + checks) outside
  `packages/`.
- Register it through the 0159 API and drive a paid request through verification
  to release in an e2e or example.

## Resolution

Implemented by updating:

- `e2e/protocol/custom-schema.test.ts`

Verified with:

- `deno task test:e2e:protocol`
- `deno task lint:strict`
- `deno task check`

Harness update:

- The custom-schema protocol e2e locks the public extension surface by
  registering `https://example.test/spec/proof/custom/v1` through
  `registerSchemaBundle`, producing schema evidence through
  `resolveProofGenerator`, verifying it through the registered check/verifier
  in the paid escrow lifecycle, and asserting missing/tampered evidence rejects
  fail closed.

Review residuals:

- None

Follow-up:

- None
