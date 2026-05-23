# Architecture

Anchr does one thing:

```text
Anchr is an SDK for verifiable paid requests.

Customer posts a paid request.
Provider returns work with proof.
Oracle verifies and releases payment.
```

The repository should teach that concept before it teaches any implementation
taxonomy. Customer, Provider, and Oracle coordinate through interoperable wire
events, payment locks, proof material, and release authorization. A deployment
may bundle roles into one process for development, but that process is not a
protocol actor and must not be required for interoperability.

## Public Contract

The stable public Anchr package surface is intentionally small:

- `@anchr/sdk`: the developer-facing SDK for building verifiable paid request
  flows.
- `@anchr/protocol`: the role-neutral wire contract for compatible
  implementations.

Everything else in this repository is implementation detail, native helper code,
specification material, test harness, documentation, or optional learning
material. Pre-1.0 replacements should be direct: move callers to the new owner
and delete the replaced path instead of preserving compatibility shims.

## Public Subpaths

Public subpaths are allowed only when they help a user build or interoperate
with verifiable paid requests without learning the repository's internal
taxonomy.

`@anchr/sdk` may expose:

- root exports for the common Customer, Provider, and Oracle setup path.
- `/customer`, `/provider`, and `/oracle` for role-specific orchestration.
- `/payments` for payment-lock and redemption ports plus standard Cashu helpers.
- `/proofs` for proof producer, verifier, schema dispatch, and policy ports.
- `/attachments` for encrypted attachment references and transport helpers.
- `/adapters` for standard Nostr, Cashu, Blossom, Oracle HTTP, local state, and
  signer adapters.
- `/testing` for deterministic in-memory helpers used by examples and tests.

`@anchr/protocol` may expose:

- root exports for the common interoperable contract.
- `/events` for wire event builders and parsers.
- `/schemas` for proof schema identifiers and schema metadata.
- `/validators` for role-neutral validation helpers.
- `/types` for role-neutral protocol types.
- `/nostr` only for Nostr event encoding details that are part of wire
  compatibility.

Adapter manifests, adapter capability checks, concrete payment clients, proof
engines, attachment stores, runtime helpers, and application policies belong to
`@anchr/sdk` or SDK internals. They do not belong in `@anchr/protocol` unless a
concrete cross-implementation wire compatibility reason is recorded in `specs/`.
The former protocol capability surface has been absorbed into SDK-owned adapter
contracts.

## Surface Policy

The current repository is transitional. These decisions define the target map
for issues `0047`, `0049`, and `0048`; this document does not move code by
itself.

| Current surface | Target classification | Policy |
| --- | --- | --- |
| `@anchr/sdk` | Keep public | Make this the one developer entry point for building verifiable paid request flows. Absorb role SDKs, standard adapters, payment helpers, proof dispatch, attachment helpers, and testing helpers here. |
| `@anchr/protocol` | Keep public | Keep only wire events, schemas, validators, Nostr wire encoding, and role-neutral protocol types here. It must not depend on any other Anchr package. |
| `@anchr/customer-sdk` | Absorb into SDK | Move Customer orchestration and ports under `@anchr/sdk`; delete the standalone public package. |
| `@anchr/provider-sdk` | Absorb into SDK | Move Provider orchestration and ports under `@anchr/sdk`; delete the standalone public package. |
| `@anchr/oracle-sdk` | Absorb into SDK | Move Oracle verification client/server ports under `@anchr/sdk`; keep interoperable attestation shapes in protocol only when they are wire contracts. |
| `@anchr/core-runtime` | Absorb into SDK internals or scripts | Runtime helpers may remain as internal code used by SDK, tests, or scripts, but not as a public Anchr package. |
| `@anchr/core-cashu` | Absorb into SDK payments | Keep Cashu HTLC/P2PK behavior as the standard SDK payment adapter; delete the standalone public package. |
| `@anchr/frost-oracle` | Absorb or move out | Keep threshold release authority only if it directly supports paid-request settlement through SDK ports; otherwise move it outside this repository. |
| `@anchr/tlsn-toolkit` | Absorb into SDK proofs | Keep TLSNotary validation and replay safeguards as SDK proof internals or standard proof helpers. |
| `@anchr/photo-verification` | Absorb into SDK proofs | Keep C2PA, EXIF, ProofMode, AI-content, and GPS checks as SDK proof internals or standard proof helpers. |
| `@anchr/cashu-conditional-swap` | Delete or move out | Binary-outcome conditional swaps are not the core paid-request flow. Preserve only pieces needed by SDK payment locks. |
| `@anchr/blossom` | Absorb into SDK attachments | Keep encrypted Blossom transport as a standard SDK attachment adapter, not as a public package. |
| `@anchr/adapters` | Absorb into SDK adapters | Standard Nostr, Cashu, Blossom, local state, signer, and Oracle HTTP bindings belong under `@anchr/sdk/adapters`. |
| `@anchr/bounty` | Delete as a concept | Absorb any reusable paid-request lifecycle pieces into SDK role modules. Do not preserve `bounty`, query lifecycle, claim-gate, or bounty subpaths as public nouns. |
| Product and adapter applications | Deleted | MCP, marketplace, bot-shield, binary-bet, bounty-board, and mobile-shell surfaces are outside the core repository surface. |
| `examples/c2pa-media-verification` | Deleted | It was not reduced to a tiny SDK/protocol lesson in this repository. |
| `examples/tlsn-fiat-swap-square` | Deleted | It was not reduced to a tiny SDK/protocol lesson in this repository. |
| `examples/auto-claim` | Deleted | Browser automation product code is outside the core paid-request SDK/protocol shape. |
| `examples/royalty-distribution` | Deleted | Royalty distribution was non-core domain exploration. |
| `examples/supply-chain-proof` | Deleted | Supply-chain proof was non-core domain exploration. |
| `examples/tlsn-worker` | Deleted | The worker was not a minimal SDK/protocol proof lesson or test fixture. |

No top-level tool category should be introduced to preserve deleted app or
package surfaces. Developer-only commands belong under `scripts/` when required
to build, test, lint, publish, or verify the SDK/protocol.

## Component Boundaries

Each target unit has one owner responsibility:

| Unit | Responsibility |
| --- | --- |
| Protocol | Define the interoperable wire contract for verifiable paid requests. |
| SDK | Orchestrate Customer, Provider, and Oracle roles through explicit ports and standard adapters. |
| Specs | Record universal wire contracts and proof schema identities that other implementations may use. |
| Native helpers | Provide low-level prover, verifier, signer, or cryptographic binaries required by SDK adapters. |
| Scripts | Build, test, lint, publish, and verification automation for this repository. |
| Examples | Optional, tiny lessons that demonstrate one SDK/protocol behavior. |
| E2E tests | Verify real protocol, payment, proof, relay, native-helper, and SDK integration behavior. |

The SDK may own concrete standard adapters because the SDK is the developer
composition surface. Protocol must stay narrower: it owns compatibility, not
runtime convenience.

## Agnostic Component Boundaries

Component names describe protocol responsibilities, not today's bindings. A
boundary is stable when replacing its current binding changes only SDK adapter
code, native helper code, or `specs/` guidance. Normative
cross-implementation requirements live in
[`specs/protocol-contract.md`](../specs/protocol-contract.md). Placement of any
rule derived from this table follows
[`docs/universality-boundaries.md`](universality-boundaries.md).

| Component | Stable responsibility | Target owner |
| --- | --- | --- |
| Actor coordination | Move request, offer, selection, proof, release, and completion messages between Customer, Provider, and Oracle while preserving role identity and causal links. | Protocol for wire shapes; SDK for orchestration and relay adapters. |
| Evidence contract | Identify what evidence a request requires and how verifiers dispatch it without embedding verifier implementation in the protocol. | Protocol for schema identifiers; SDK for dispatch and verifier ports. |
| Verification decision | Decide whether submitted evidence satisfies Customer constraints and whether release material may be produced. | SDK Oracle/proof modules and native helpers. |
| Settlement lock | Hold Customer value so the selected Provider can redeem after valid Oracle release and the Customer can refund after timeout. | SDK payment ports and standard payment adapters. |
| Release authority | Produce material that unlocks settlement only after verification succeeds and bind it to the selected work. | SDK Oracle/payment modules; protocol only for interoperable release messages. |
| Attachment transport | Store and retrieve large or sensitive proof material without making storage a protocol actor. | SDK attachment ports and standard adapters; protocol only for attachment references. |
| Local actor state | Track one actor's private progress without making local implementation state part of the network contract. | SDK state ports and standard test/runtime stores. |
| Runtime adapter | Bind an SDK role or standard adapter to a concrete process, UI, or operator policy. | Outside the public protocol; optional examples only when tiny. |

## Naming

Public protocol, docs, SDKs, and examples should use **Customer**,
**Provider**, and **Oracle**.

Older requester/worker terms may remain only where a current wire field already
uses that spelling. Versioned protocol replacements should remove those names
instead of retaining aliases. New SDK APIs, docs, and examples should not copy
the old vocabulary.

Application vocabulary such as market, marketplace, bounty, bot shield, binary
bet, royalty, and supply chain is not core Anchr vocabulary. It may appear in
historical issue text or in explicitly non-core migration notes, but not as the
default repository theme or public package surface.

## Dependency Rules

The target package graph is one-directional:

- `@anchr/protocol` depends on no other Anchr package.
- `@anchr/sdk` may depend on `@anchr/protocol`.
- Examples, tests, and native-helper harnesses use only `@anchr/sdk` or
  `@anchr/protocol` for Anchr TypeScript imports.
- No package depends on optional examples or app/product code.
- Product shells are not a maintained top-level category in the target
  repository.
- Architecture lint should enforce these rules after the package collapse and
  repository pruning work lands.

## Specs and Threat Model

- Universal protocol and wire-format specs live under [`specs/`](../specs/),
  CC0. Anyone may implement them.
- Threat-model invariants and attack tests are in
  [`docs/threat-model.md`](threat-model.md).
- Cross-document placement rules for universal protocol contracts, security
  invariants, package contracts, adapters, examples, and agent harness rules are
  in [`docs/universality-boundaries.md`](universality-boundaries.md).

## Relation to NIP-90

Anchr can be summarized as:

```text
Nostr DVM-style transport + payment lock + Oracle-verified proof.
```

NIP-90 is a transport inspiration and possible compatibility layer, not the
thing Anchr sells as a repository concept. The protocol contract must preserve
Customer, Provider, Oracle, proof, payment, refund, and release semantics even
if an implementation uses a different transport.

## Follow-On Work

This design issue only decides the map.

- `0047` owns collapsing public packages into `@anchr/sdk` and
  `@anchr/protocol`.
- `0049` deleted non-core app, tool, and example surfaces.
- `0048` owns final workspace, lint, publish, README, and package README
  enforcement.
- `0043` closes only after the child issues make the repository read as one
  SDK/protocol for verifiable paid requests.
