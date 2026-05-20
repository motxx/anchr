# Clarify repository purpose

Created: 2026-05-16
Model: GPT-5
Completed: 2026-05-20

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0036

## Summary

Clarify the repository's purpose and rewrite the top-level README around that
purpose so a first-time reader can quickly tell what Anchr is, what this
repository is trying to make usable, what is experimental, and which paths are
the primary integration surfaces.

The current README describes Anchr as an experimental SDK for P2P verified work
and lists example uses, but it does not make the repository's product boundary
obvious enough. A reader still has to infer whether the main deliverable is a
protocol, SDK set, example suite, verification toolkit collection, or broader
Cashu/Nostr component library.

## Rationale

Relevant references:

- `README.md`
- `CLAUDE.md`
- `docs/architecture.md`
- `docs/universality-boundaries.md`
- `packages/sdk/README.md`
- `packages/customer-sdk/README.md`
- `packages/provider-sdk/README.md`
- `packages/oracle-sdk/README.md`

The README should answer, near the top:

- who Anchr is for;
- what problem this repository solves;
- which package or example a new integrator should start with;
- which pieces are core Anchr surfaces versus reusable supporting primitives;
- which parts are testnet, concept, or experimental.

Without that purpose statement, package-boundary decisions become arbitrary:
the same `packages/` tree currently contains actor SDKs, protocol helpers,
Cashu primitives, verification toolkits, storage adapters, threshold-signing
tooling, and a `bounty` migration package. Those boundaries should be judged
against a declared repository goal rather than local history.

## Plan

- Define the repository's primary purpose in one or two explicit paragraphs:
  protocol/spec, SDK, reference examples, and reusable primitives should each
  have a clear role.
- Rewrite the README introduction and "What It Solves" path so a reader can
  identify the primary integration route without scanning the whole repository.
- Add or tighten a top-level map that distinguishes core SDK packages,
  protocol/spec files, reference examples, and experimental or reusable
  primitives.
- Cross-check README claims against `docs/architecture.md`,
  `docs/universality-boundaries.md`, and package READMEs so status language is
  consistent.
- Leave package moves or renames to follow-up work; this issue should settle
  the purpose and documentation contract that those changes depend on.

## Resolution

Implemented by updating:

- `README.md`

Verified with:

- `deno task lint:fmt`

Harness update:

- None — this is a one-time repository-purpose documentation decision now
  locked in `README.md`; package-boundary enforcement is tracked by #0036 and
  follow-up issues #0037 through #0043.

Review residuals:

- None

Follow-up:

- #0036
