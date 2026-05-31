# Add runnable Quick Start

Created: 2026-06-01
Model: GPT-5 Codex

## Priority

feature

## Dependencies

Depends on:
- 0088
- 0096
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
actual SDK and relay path, require only minimal Nostr knowledge, and avoid
presenting public relay plaintext as the normal way to pass private execution
or payment material.

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
- The flow does not claim production payment when it is using a dry-run,
  simulation, or test-only payment boundary.
- The first README code path avoids non-public data in public relay content.
- A smoke test or documented verification command detects SDK/API drift for
  the Quick Start.

## Verification

- `deno task test:examples`
- `deno task test:all`
- Manual check: run the README Quick Start from a clean checkout using a relay
  URL supplied by the user or environment.
- Manual check: the section title is concise and does not pack explanatory
  qualifiers into the heading.

## Plan

- Use #0088 to select or create the smallest verified public example.
- Wire the root README Quick Start to that example instead of an illustrative
  API-only sketch.
- Keep payment and relay assumptions explicit in the body text, not the
  heading.
