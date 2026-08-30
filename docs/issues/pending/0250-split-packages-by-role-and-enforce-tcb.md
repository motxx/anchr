# Split packages by role and enforce TCB boundaries

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
- 0254
- 0255

## Summary

Split `@anchr/sdk` along trust boundaries so that "a role's application does
not load code whose compromise would spend its funds" becomes machine-checked
instead of asserted. Target layout (2026-07-26 design session):

```text
@anchr/protocol                 shared trust base: message types, build/parse,
                                transition vocabulary (pure, no I/O)
@anchr/customer                 lock assembly, offer collection, selection,
                                refund path
@anchr/provider                 received-token binding checks, work+proof
                                submission, redemption
@anchr/oracle                   persistent state machine (from 0249) + daemon
Payment Lock / Proof Schema     implementations reached through each role's capabilities
```

Dependency rules: roles depend on protocol and only on their own public
Payment Lock or Proof Schema capabilities; roles never depend on each other;
protocol depends on no `@anchr/*` package (E025 today); `customer`/`provider`
must not reach proof verification implementations. Enforce the last rule as a
module-graph reachability lint, not only a package-dependency rule.

## Rationale

- Measured TCB per role entry (2026-07-26, commit 00982f9): customer 2,434
  lines, provider 2,376, oracle 10,590, three-role shared 1,394 (protocol
  980). Customer reaches only two proofs type files (90 lines) — the split
  matches the existing module graph; the lint locks it.
- `ALLOWED_PACKAGE_DEPS` in `scripts/arch-lint.ts` currently has two entries
  (`protocol`, `sdk`) and is effectively inert; the split makes it the real
  boundary control.
- Payment Lock behavior spans all three roles, but each role must receive only
  its own capabilities: Customer prepares and refunds a lock, Provider verifies
  binding and redeems it, and Oracle produces Release Material. Define those
  interfaces defined from each role's needs and the TCB graph before choosing physical package
  boundaries. v0 remains Cashu-fixed; the interfaces constrain role authority
  rather than promise arbitrary payment-backend substitution. Proof Schema
  verification remains pure and deterministic.
- Coordinate with 0224 (port ownership) and 0238 (exports map); 0225 (root
  barrel) and 0226 (composition root) must land first so the split moves
  settled surfaces.
- This issue is intentionally a tracking issue: the resolver must split it
  with `make-issues` (per-package children plus a final enforcement child)
  after re-reading the repository.

## Acceptance

- A checked-in capability and TCB matrix defines the payment/verification
  authority reachable from each public role entry before physical package
  boundaries are chosen:

  | Entry | Required reachability | Forbidden reachability |
  | --- | --- | --- |
  | Customer | prepare and refund its Payment Lock | Provider redeem, Release Material production, Proof verification |
  | Provider | verify Provider binding and redeem its Payment Lock | Customer refund, Release Material production, Proof verification |
  | Oracle | Proof verification and Release Material production | Customer refund, Provider authorization or redeem |
  | Protocol | pure message types, build/parse, and transition vocabulary | Role implementations, payment/proof I/O, time, network, and randomness |

- The workspace contains the role packages above. The physical home of each
  Payment Lock or Proof Schema implementation follows the capability and TCB
  graph rather than a predetermined package template. `@anchr/sdk` either
  becomes the thin setup-path facade or is retired, with examples, e2e, and
  docs importing from the new owners.
- `ALLOWED_PACKAGE_DEPS` encodes the dependency table; violations fail
  `deno task lint:arch`.
- A reachability rule fails CI when a `customer`/`provider` entry point can
  statically reach a proof verification implementation or Oracle-only
  release-material production code — including reachability through barrel
  re-exports and shared implementation entrypoints; dynamic-import escape
  hatches remain banned by `lint:no-dynamic-import`, and both negative cases
  are covered by tests.
- Each Payment Lock or Proof Schema implementation ships conformance tests for
  the role capabilities it implements (including Proof Schema verify-purity:
  same inputs, same result, no ambient time/network/randomness).

## Requirement traceability

| Requirement | Verification |
| --- | --- |
| Capability and TCB decisions exist before package extraction | The checked-in matrix above is represented in the lint fixture data used to generate every allowed and forbidden edge test. |
| Roles never depend on each other | Package-dependency negative fixtures cover Customer → Provider/Oracle, Provider → Customer/Oracle, and Oracle → Customer/Provider. |
| Customer reaches prepare/refund but not spend or verification authority | A positive fixture imports Customer Payment Lock capabilities; negative fixtures attempt Provider redeem, Release Material production, and Proof verification. |
| Provider reaches binding verification/redeem but not Customer or Oracle authority | A positive fixture imports Provider Payment Lock capabilities; negative fixtures attempt Customer refund, Release Material production, and Proof verification. |
| Oracle reaches Proof verification/Release Material production but not actor spend authority | Positive fixtures import both Oracle capabilities; negative fixtures attempt Customer refund, Provider authorization, and Provider redeem. |
| Protocol remains a pure dependency leaf | Negative fixtures attempt an `@anchr/*` role import plus time, network, randomness, and payment/proof I/O imports from a protocol entry. |
| Re-exports cannot hide forbidden reachability | Every forbidden class has a direct-import fixture and a barrel-re-export fixture; both must fail with the same rule ID. |
| Runtime loading cannot bypass static reachability | `lint:no-dynamic-import` stays in `lint:strict`, with its existing negative fixture. |
| Physical packages follow rather than invent the graph | The resolver records each new package or subpath against the matrix row it implements; tests of published exports assert that no role entry exports another role's capability. |
| v0 remains Cashu-fixed without widening public substitutability | Public API and documentation tests expose Cashu as the v0 Payment Lock implementation and no generic backend-registration API. |
| Payment Lock and Proof Schema implementations satisfy their obligations | Per-capability conformance suites run through each implementation; Proof Schema suites additionally run the same input twice under blocked ambient time/network/randomness and compare results. |

## Verification

- `deno task lint:arch` fails on every direct and re-exported forbidden-edge
  fixture listed above and passes on every required-reachability fixture.
- `deno task test:all` and `deno task publish:dry-run` pass.

## Plan

- Resolver: re-read the repository, then split with `make-issues` into
  per-package extraction children and a final lint/enforcement child.
