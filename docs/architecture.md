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
- `@anchr/protocol`: the Nostr/NIP-90 wire contract for compatible
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
- `/payments` for payment-lock and redemption ports plus payment-owned Cashu
  helpers.
- `/proofs` for proof producer, verifier, schema dispatch, and policy ports.
- `/attachments` for encrypted attachment references and the bundled Blossom
  upload/download helpers that keep large proof material content-addressed,
  encrypted, and portable across Blossom servers.
- `/adapters` for standard Nostr, Cashu, Oracle HTTP, local state, and signer
  adapters. The concrete Cashu HTLC mint client is the Cashu payment adapter
  surface and is exported from `@anchr/sdk/adapters/cashu`, with root SDK
  exports available for the common setup path.
- `/testing` for deterministic in-memory helpers used by examples and tests.

`@anchr/protocol` may expose:

- root exports for the common interoperable contract.
- `/events` for wire event builders and parsers.
- `/schemas` for proof schema identifiers and schema metadata.
- `/validators` for validation helpers that protect the Nostr wire contract.
- `/types` for protocol types used by the Nostr/Cashu v0 contract.
- `/nostr` for Nostr event signing, encryption, identity, tag, and kind helpers
  that are part of wire compatibility.

Adapter manifests, adapter capability checks, concrete payment clients, proof
engines, attachment stores, runtime helpers, relay clients, and application
policies belong to `@anchr/sdk` or SDK internals. They do not belong in
`@anchr/protocol` unless they define the Nostr/Cashu v0 contract recorded in
`specs/`.

## Surface Policy

The current repository map is the target map. New public Anchr packages,
top-level product shells, or catch-all command categories should not be added
without first updating this document and the architecture lint. Reusable runtime
helpers, proof engines, payment helpers, attachment transport, and standard
adapters live inside `@anchr/sdk` unless they define compatible Anchr v0 wire
contracts that belong in `@anchr/protocol`.

Developer-only commands belong under `scripts/` only when required to build,
test, lint, publish, or verify the SDK/protocol.

Blossom remains under the SDK attachment surface because the bundled Blossom
code owns attachment-specific behavior: encrypted blob upload and download,
per-attachment key material, Blossom server selection, and BUD-02 upload
authorization for attachment blobs. It is not exposed as a generic SDK adapter
owner alongside actor transport, payment, Oracle HTTP, or local state adapters.

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

Nostr adapter role helpers exposed from `@anchr/sdk/adapters/nostr` are
adapter responsibilities only when their behavior is inseparable from relay
subscription, event publication, NIP-44 encryption, or Nostr event parsing.
Role-neutral Customer, Provider, Oracle, payment, proof, and request lifecycle
semantics remain owned by the SDK role modules and request internals.

## SDK Request Internals

`packages/sdk/src/requests/` remains an SDK-internal paid-request lifecycle
core. It is not a public `@anchr/sdk/requests` subpath. Its responsibility is
to model and orchestrate one local request from creation through offers,
provider selection, proof submission, verification, release, completion, expiry,
and purge.

The request internals own request-bound state and lifecycle ports:

| Concept | Owner |
| --- | --- |
| Request lifecycle state | `requests/domain/` owns the `Query` aggregate, statuses, transitions, query store, offer/selection/result state, expiry, and request-scoped quorum and attestation records. |
| Attachment references in submitted work | `requests/domain/` owns the request-scoped `AttachmentRef` and attachment key records persisted on `QueryResult`; `attachments/` owns upload, download, encryption, URL validation, Blossom transport, and helpers that produce or consume those references. |
| Payment escrow hooks used by the lifecycle | `requests/application/` owns the `EscrowProvider` port because the query lifecycle calls it at hold, provider binding, lock verification, settlement, and cancellation points; `payments/` and `adapters/cashu` own payment implementations and reusable payment-lock or redemption helpers. |
| Verification inputs and decisions used by release logic | `requests/domain/` owns the request-bound `VerificationRequirement`, `VerificationInput`, and `VerificationDetail` records used to decide whether a query can release payment; `proofs/` owns proof engines, schema dispatch, redaction, and proof-specific verifier adapters. |
| Oracle lifecycle records and registry lookup | `requests/domain/` owns `OracleAttestation` records that are stored against a query, and `requests/application/` owns the `OracleRegistry` lookup port consumed by the lifecycle; `adapters/oracle-client`, `adapters/oracle-service`, and Nostr adapter modules own concrete Oracle discovery, HTTP, service, and event bindings. |
| Deterministic lifecycle test helpers | `@anchr/sdk/testing` is the only public testing entry point. It may re-export request service helpers for tests and examples while the underlying lifecycle semantics remain owned by `requests/`. |

Feature directories should not import from `requests/` to get a generic
attachment, payment, proof, Oracle, or adapter abstraction. Cross-directory
imports from `requests/` are acceptable only when the imported shape is
request-scoped lifecycle state or a port consumed by the request lifecycle. If a
type becomes useful without a `Query` or lifecycle transition, move it directly
to the owning feature directory and update callers instead of adding a second
barrel or compatibility facade.
`deno task lint:arch` enforces the current request-internal import exceptions.

## Agnostic Component Boundaries

Component names describe protocol responsibilities within Anchr v0's fixed
Nostr and Cashu substrates. Normative paid-request exchange requirements live
in [`specs/paid-request-exchange.md`](../specs/paid-request-exchange.md).
Placement of any rule derived from this table follows
[`docs/universality-boundaries.md`](universality-boundaries.md).

| Component | Stable responsibility | Target owner |
| --- | --- | --- |
| Actor coordination | Move request, offer, selection, proof, release, and completion messages between Customer, Provider, and Oracle while preserving role identity and causal links. | Protocol for Nostr wire shapes; SDK for orchestration and relay adapters. |
| Evidence contract | Identify what evidence a request requires and how verifiers dispatch it without embedding verifier implementation in the protocol. | Protocol for schema identifiers; SDK for dispatch and verifier ports. |
| Verification decision | Decide whether submitted evidence satisfies Customer constraints and whether release material may be produced. | SDK Oracle/proof modules and native helpers. |
| Settlement lock | Hold Customer value in a Cashu Payment Lock so the selected Provider can redeem after valid Oracle release and the Customer can refund after timeout. | SDK payment ports and Cashu payment helpers. |
| Release authority | Produce material that unlocks settlement only after verification succeeds and bind it to the selected work. | SDK Oracle/payment modules; protocol only for interoperable release messages. |
| Attachment transport | Store and retrieve large or sensitive proof material without making storage a protocol actor. | SDK attachment helpers and bundled Blossom transport; protocol only for attachment references. |
| Local actor state | Track one actor's private progress without making local implementation state part of the network contract. | SDK state ports and standard test/runtime stores. |
| Runtime adapter | Bind an SDK role or standard adapter to a concrete process, UI, or operator policy. | Outside the public protocol; optional examples only when tiny. |

## Naming

Public protocol, docs, SDKs, and examples should use **Customer**,
**Provider**, and **Oracle**.

Older customer/provider terms may remain only where a current wire field already
uses that spelling. Versioned protocol replacements should remove those names
instead of retaining aliases. New SDK APIs, docs, and examples should not copy
the old vocabulary.

Application vocabulary such as market, marketplace, bounty, bot shield, binary
bet, royalty, and supply chain is not core Anchr vocabulary and must not be the
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

## Nostr Wire Contract

Anchr can be summarized as:

```text
Nostr DVM-style transport + payment lock + Oracle-verified proof.
```

NIP-90 is the Anchr wire contract. The SDK Nostr adapter owns relay
connections, subscriptions, runtime wiring, and service orchestration;
`@anchr/protocol` owns the event kinds, tags, payloads, NIP-44 encryption
boundaries, signing helpers, and Cashu settlement fields that compatible Anchr
actors must share to interoperate in v0.

## Follow-On Work

This map is enforced by `deno task lint:arch`, the root workspace in
`deno.json`, and the package publish dry run.
