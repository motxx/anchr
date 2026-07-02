# Route proofmode-validation temp I/O through the persistence port with safe names

Created: 2026-07-02
Model: Claude Fable 5

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`proofmode-validation.ts` bypasses the persistence port (issue 0163) by
importing `node:fs` directly and writing to hardcoded `/tmp` paths. The PGP
path uses `/tmp/pgp-verify-${Date.now()}` with no random suffix — a predictable
name that is collision- and symlink-race-prone in a shared `/tmp`. It is also a
browser blocker, and it is exported publicly via `proofs/mod.ts`. The 0163 rg
check only matched `Deno.*` file APIs, so the `node:fs` straggler slipped
through.

## Rationale

- `packages/sdk/src/proofs/proofmode-validation.ts` (~lines 14-24, 244-247,
  287-288): `mkdirSync/readFileSync/writeFileSync/rmSync/readdirSync` and
  `/tmp/proofmode-*` / `/tmp/pgp-verify-*` paths.
- Related lint gap tracked in 0194.

## Acceptance

- File/temp I/O in `proofmode-validation.ts` goes through the injected
  persistence port and a temp-dir provider that produces unpredictable names.

## Verification

- `rg "node:fs" packages/sdk/src/proofs/proofmode-validation.ts` returns no
  matches.
- Temp paths include an unpredictable component.

## Plan

- Inject the persistence port + a temp-dir/random provider; remove `node:fs`.
