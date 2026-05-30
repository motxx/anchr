# Reconcile conditional swap spec ownership

Created: 2026-05-30
Model: GPT-5 Codex

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0080

## Summary

Decide whether `specs/conditional-swap.md` is an active public protocol spec for
the collapsed repository or retained design material, then align code, docs,
and release presentation with that decision.

## Rationale

The protocol conformance audit in `docs/protocol-conformance-audit.md` found
that FROST/P2PK settlement pieces and regtest coverage exist under
`packages/sdk/`, but the conditional swap spec still describes broader N:M
swap concepts and references package surfaces that no longer exist in the
current public layout. Leaving that ambiguity in `specs/` makes it unclear
which parts are interoperable public protocol and which parts are design notes
or example-level material.

## Acceptance

- The repository has a documented decision for whether conditional swap remains
  an active wire spec, moves to design/roadmap material, or is split into
  active and future sections.
- Any stale package references in `specs/conditional-swap.md` and
  `specs/README.md` are removed or redirected to current SDK owners.
- If the spec remains active, each normative field, state, settlement mode, and
  release-authority behavior has an implementation/test owner or a focused
  follow-up issue.
- Public-release docs do not imply that removed packages or unimplemented N:M
  APIs are current public SDK surface.

## Verification

- `deno task check`
- `deno task test:unit`
- `deno task test:e2e:frost`
- `deno task test:e2e:regtest`
- Manual check: `docs/protocol-conformance-audit.md` and `specs/README.md`
  agree on the status of `specs/conditional-swap.md`.

## Plan

- Read `specs/conditional-swap.md`, current SDK payment/FROST code, and
  FROST/regtest coverage.
- Make the smallest status decision that removes public-release ambiguity.
- Update docs/specs and tests or file narrower implementation issues as needed.
