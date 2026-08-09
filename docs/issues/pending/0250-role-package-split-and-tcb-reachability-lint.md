# Split role packages and enforce TCB boundaries with a reachability lint

Created: 2026-07-26
Model: Claude Opus 5

## Priority

design

## Dependencies

Depends on:
- 0225
- 0226
- 0247
- 0249

Blocks:
- None

## Summary

Split `@anchr/sdk` along trust boundaries so that "a role's application does
not load code whose compromise would spend its funds" becomes machine-checked
instead of asserted. Target layout (2026-07-26 design session):

```text
@anchr/protocol                 shared trust base: wire types, build/parse,
                                transition vocabulary (pure, no I/O)
@anchr/customer                 lock assembly, offer collection, selection,
                                refund path
@anchr/provider                 received-token binding checks, work+proof
                                submission, redemption
@anchr/oracle                   persistent state machine (from 0249) + daemon
settlement-* / proof-*          swappable scheme/schema packages
```

Dependency rules: roles depend on protocol and on the plugin packages they
use; roles never depend on each other; protocol depends on no `@anchr/*`
package (E025 today); `customer`/`provider` must not reach proof
verification implementations. Enforce the last rule as a module-graph
reachability lint, not only a package-dependency rule.

## Rationale

- Measured TCB per role entry (2026-07-26, commit 00982f9): customer 2,434
  lines, provider 2,376, oracle 10,590, three-role shared 1,394 (protocol
  980). Customer reaches only two proofs type files (90 lines) — the split
  matches the existing module graph; the lint locks it.
- `ALLOWED_PACKAGE_DEPS` in `scripts/arch-lint.ts` currently has two entries
  (`protocol`, `sdk`) and is effectively inert; the split makes it the real
  boundary control.
- Settlement plugins are used by all three roles (Customer assembles the
  unlock condition, Provider verifies binding, Oracle produces release
  material), so they cannot live inside one role package — they are
  packages, with obligations defined per the design session: an async
  `prepareLock(request, mint)` (mint round-trips are required by schemes
  like NUT-CTF condition registration), `produceReleaseMaterial` callable
  only Oracle-side, `verifyProviderBinding` for Provider, and pure
  `verify` for proof schemas.
- Coordinate with 0224 (port ownership) and 0238 (exports map); 0225 (root
  barrel) and 0226 (composition root) must land first so the split moves
  settled surfaces.
- This issue is intentionally a tracking issue: the resolver must split it
  with `make-issues` (per-package children plus a final enforcement child)
  after re-reading the repository.

## Acceptance

- The workspace contains the role and plugin packages above; `@anchr/sdk`
  either becomes the thin setup-path facade or is retired, with examples,
  e2e, and docs importing from the new owners.
- `ALLOWED_PACKAGE_DEPS` encodes the dependency table; violations fail
  `deno task lint:arch`.
- A reachability rule fails CI when a `customer`/`provider` entry point can
  statically reach a proof verification implementation or Oracle-only
  release-material production code.
- Each settlement/proof plugin package ships a conformance test for its
  obligations (including verify-purity: same inputs, same result, no
  ambient time/network/randomness).

## Verification

- `deno task lint:arch` fails on an intentionally added forbidden edge
  (customer → proof verification) and passes without it.
- `deno task test:all` and `deno task publish:dry-run` pass.

## Plan

- Resolver: re-read the repository, then split with `make-issues` into
  per-package extraction children and a final lint/enforcement child.
