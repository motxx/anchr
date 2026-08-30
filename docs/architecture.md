# Architecture

Anchr does one thing:

```text
Anchr is an SDK for verifiable paid requests.

Customer posts a paid request.
Provider returns work with proof.
Oracle verifies and releases payment.
```

The repository should teach that concept before it teaches any implementation
taxonomy. Customer, Provider, and Oracle coordinate through interoperable Nostr
events, Payment Locks, Proof, and Release Material. A deployment
may bundle roles into one process for development, but that process is not a
protocol actor and must not be required for interoperability.

Application coordination such as provider catalogs, listings, ranking,
reputation, pricing policy, dispute handling, and domain-specific workflows
belongs to applications built on top of Anchr, not to the core SDK or protocol.

## Public Packages

Anchr intentionally publishes few packages:

- `@anchr/sdk`: the SDK for building verifiable paid request
  flows.
- `@anchr/protocol`: builders, parsers, and types for compatible Nostr/NIP-90
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
- `/customer`, `/provider`, and `/oracle` for orchestration by each role.
- `/payments` for payment-lock and redemption ports plus Cashu
  helpers.
- `/proofs` for proof producer, verifier, schema dispatch, and policy ports.
- `/attachments` for encrypted attachment references and the bundled Blossom
  upload/download helpers that keep large proof material content-addressed,
  encrypted, and portable across Blossom servers. Callers own private metadata
  removal before upload; the SDK preserves the bytes it is given.
- `/adapters` for standard Nostr, Cashu, relay-based Oracle discovery, local
  state, and signer adapters. The concrete Cashu HTLC mint client is the Cashu
  payment adapter API and is exported from `@anchr/sdk/adapters/cashu`,
  with root SDK exports available for the common setup path.
- `/testing` for deterministic in-memory helpers used by examples and tests.

`@anchr/protocol` may expose:

- root exports for the common interoperable message formats.
- `/events` for Nostr event builders and parsers.
- `/schema` for Proof Schema identifiers and metadata.
- `/types` for protocol types used by the Nostr/Cashu v0 specifications.
- `/nostr` for Nostr event signing, encryption, identity, tag, and kind helpers
  required for Nostr message compatibility.

Concrete payment clients, proof engines, attachment stores, runtime helpers,
relay clients, and application policies belong to `@anchr/sdk` or SDK
internals. SDK adapters are fixed-substrate runtime bindings for the Nostr and
Cashu v0 decision (ADR 0001), not a plug-in layer for alternative transport or
settlement substrates. They do not belong in `@anchr/protocol` unless they
implement a Nostr/Cashu v0 message format recorded in `specs/`.

## Browser-Portable Surface

Browser hosts compose Anchr through the role and protocol modules that do not
own process, filesystem, environment, or sidecar execution. The portable roots
are all `@anchr/protocol` exports plus these SDK public subpaths:

- `@anchr/sdk/customer`
- `@anchr/sdk/provider`
- `@anchr/sdk/oracle`
- `@anchr/sdk/schema`
- `@anchr/sdk/adapters/oracle-client`

Those roots may use SDK port types from `@anchr/sdk` internals, but server
runtime behavior is supplied by injected adapters rather than imported by the
portable code. `deno task lint:arch` enforces browser compatibility with E031:
the reachable portable graph must not reference `Deno.*`, import `node:*`, or
import server-only SDK adapters.

Server-only adapters are the `packages/sdk/src/internal/runtime/` implementations that use Deno
runtime adapters, the FROST peer server under
`packages/sdk/src/adapters/oracle-service/` including
`server-entry.ts`, the relay Oracle daemon/hash responder process modules under
`packages/sdk/src/adapters/nostr/`, FROST CLI/payment execution under
`packages/sdk/src/payments/frost/`, and the built-in TLSN/C2PA proof execution
adapters under `packages/sdk/src/proofs/`. Browser applications provide
equivalent behavior through ports or Proof Schema bundles instead of importing those
modules.

## Surface Policy

The current repository map is the target map. New public Anchr packages,
top-level product shells, or catch-all command categories should not be added
without first updating this document and the architecture lint. Reusable runtime
helpers, proof engines, payment helpers, attachment transport, and standard
adapters live inside `@anchr/sdk` unless they implement compatible Anchr v0
message formats that belong in `@anchr/protocol`.

Developer-only commands belong under `scripts/` only when required to build,
test, lint, publish, or verify the SDK/protocol.

Blossom remains under the SDK attachment API because the bundled Blossom
code implements encrypted blob upload and download,
per-attachment key material, Blossom server selection, and BUD-02 upload
authorization for attachment blobs. It is not exposed as a generic SDK adapter
owner alongside actor transport, payment, Oracle discovery, or local state
adapters.

## Component Boundaries

Each target unit has one owner responsibility:

| Unit | Responsibility |
| --- | --- |
| Protocol (`packages/protocol/`) | Define interoperable message formats for verifiable Paid Requests. |
| SDK (`packages/sdk/`) | Orchestrate Customer, Provider, and Oracle roles through explicit ports and standard adapters. |
| Specs (`specs/`) | Record requirements and Proof Schema identities that compatible implementations must follow. |
| Native helpers (`crates/`) | Provide low-level prover, verifier, signer, or cryptographic binaries required by SDK adapters (`frost-signer`, `tlsn-prover`, `tlsn-verifier`, `tlsn-server`; Rust, built with cargo against the pinned `rust-toolchain.toml`). |
| Scripts (`scripts/`) | Build, test, lint, publish, and verification automation for this repository. |
| Examples (`examples/`) | Optional, tiny lessons that demonstrate one SDK/protocol behavior. |
| E2E tests (`e2e/`) | Verify real protocol, payment, proof, relay, native-helper, and SDK integration behavior. |
| Docs (`docs/`) | Record repository-internal architecture, threat model, runbooks, audits, and the file-based issue tracker. |
| Skills (`skills/`) | Define repository-local agent skills shared by Claude and Codex (symlinked from `.claude/skills` and `.codex/skills`). |
| Proof Schema site | Publish the static HTTPS pages for built-in Proof Schema URLs from `spec-site/`. |
| Tooling type stubs | Provide local TypeScript ambient types under `tools/types/` only when repository automation needs them. |

The SDK may own concrete standard adapters because developers compose them through
the SDK API. Protocol must stay narrower: it defines compatibility, not
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
and purge. It is the single owner of the lifecycle state machine: role facades
(`customer.ts`, `provider.ts`) reach the lifecycle through
`requests/application` services and hold no independent status model
(ADR 0003).

The request internals define state and lifecycle ports for each request:

| Concept | Owner |
| --- | --- |
| Request lifecycle state | `requests/domain/` owns the `Query` aggregate, statuses, transitions, query store, offer/selection/result state, expiry, and request-scoped quorum and attestation records. |
| Attachment references in submitted work | `values.ts` defines the shared `AttachmentRef` and Blossom key value objects; `requests/domain/` persists them on `QueryResult`; `attachments/` implements upload, download, encryption, URL validation, Blossom transport, and helpers that produce or consume those references. The producer removes metadata before upload because schemas and applications decide which evidence metadata is private versus intentionally retained. |
| Payment escrow hooks used by the lifecycle | `requests/application/` owns the `EscrowProvider` port because the query lifecycle calls it at hold, provider binding, lock verification, settlement, and cancellation points; `payments/` and `adapters/cashu` own payment implementations and reusable payment-lock or redemption helpers. |
| Verification inputs and decisions used by release logic | `proofs/verification/contract.ts` owns the `VerificationRequirement`, `VerificationInput`, and `VerificationDetail` types shared by all Proof Schemas (exported from `@anchr/sdk/proofs`); each Proof Schema owns its requirement payload, evidence payload, checks, and verdict-detail payload; `requests/domain/` embeds the shared verification detail on the `Query`; `requests/application/query-verifier.ts` owns the `Query`-to-verification adapters (`verify`, `requestToRequirement`, `resultToVerificationInput`); `proofs/` owns `verifyProof`, Proof Schema dispatch, redaction, and verifier adapters. |
| Oracle lifecycle records, release, and registry lookup | `requests/domain/` owns `OracleAttestation` records that are stored against a query, and `requests/application/` owns the `OracleRegistry` lookup port consumed by the lifecycle; Nostr adapter modules own the relay Oracle exchange and kind 30088 registry event bindings; a reduced FROST peer endpoint module owns Oracle-to-Oracle signing coordination endpoints; applications may supply static Oracle lists as their own policy. |
| Deterministic lifecycle test helpers | `@anchr/sdk/testing` is the only public testing entry point. It may re-export request service helpers for tests and examples while the underlying lifecycle semantics remain owned by `requests/`. |

Shared submission and evidence value objects — `AttachmentRef`,
`AttachmentStorageKind`, `BlossomKeyMaterial`, `BlossomKeyMap` — live in the leaf module
`packages/sdk/src/values.ts`. It imports nothing from feature directories, so
the request lifecycle, proof verification, and attachment transport all depend
on it in one direction without a type cycle. These value objects are re-exported
from the root `@anchr/sdk` exports.

Verification vocabulary for a Proof Schema belongs to the module that defines
it. Location evidence, timestamp freshness, nonce replay prevention,
and verdict details defined by a Proof Schema are carried through the shared
lifecycle as opaque payloads, not as shared SDK value objects.

Feature directories should not import from `requests/` to get a generic
attachment, payment, proof, Oracle, or adapter abstraction. Cross-directory
imports from `requests/` are acceptable only when the imported type is
request-scoped lifecycle state or a port consumed by the request lifecycle. If a
type becomes useful without a `Query` or lifecycle transition, move it directly
to the owning feature directory and update callers instead of adding a second
barrel or compatibility facade.

A non-`/testing` module must not re-export a `requests/`-owned type to a public
API: only the dependency-injection ports (`requests/domain/ports.ts`,
`requests/application/ports.ts`) and the Oracle-client API
(`requests/domain/oracle-types.ts`) are documented public re-exports. Re-publishing
the `Query` aggregate, the verification records, or other lifecycle state is a
violation. `deno task lint:arch` enforces the request-internal import exceptions
(E026) and this re-export boundary (E029).

## Agnostic Component Boundaries

Component names describe protocol responsibilities within Anchr v0's fixed
Nostr and Cashu substrates. Normative paid-request exchange requirements live
in [`specs/paid-request-exchange.md`](../specs/paid-request-exchange.md).
Placement of any rule derived from this table follows
[`docs/universality-boundaries.md`](universality-boundaries.md).

| Component | Stable responsibility | Target owner |
| --- | --- | --- |
| Actor coordination | Move request, offer, selection, proof, release, and completion messages between Customer, Provider, and Oracle while preserving role identity and causal links. | Protocol for Nostr message formats; SDK for orchestration and relay adapters. |
| Evidence requirements | Identify what evidence a request requires and how verifiers dispatch it without embedding verifier implementation in the protocol. | Protocol for Proof Schema identifiers and message payload fields; SDK for Proof Schema dispatch, registration, and verifier ports; Proof Schemas for requirement payloads, evidence payloads, checks, and verdict details. |
| Verification decision | Decide whether submitted evidence satisfies Customer constraints and whether release material may be produced. | SDK Oracle/proof modules and native helpers. |
| Settlement lock | Hold Customer value in a Cashu Payment Lock so the selected Provider can redeem after valid Oracle release and the Customer can refund after timeout. | SDK payment ports and Cashu payment helpers. |
| Release authority | Produce material that unlocks settlement only after verification succeeds and bind it to the selected work. | SDK relay Oracle and payment modules; FROST peer endpoints for Oracle-to-Oracle threshold signing; protocol only for interoperable release messages. |
| Attachment transport | Store and retrieve large or sensitive proof material without making storage a protocol actor. | SDK attachment helpers and bundled Blossom transport; protocol only for attachment references. |
| Local actor state | Track one actor's private progress without requiring other implementations to share that state. | SDK state ports and standard test/runtime stores. |
| Runtime adapter | Bind an SDK role or standard adapter to a concrete process, UI, or operator policy. | Outside the public protocol; optional examples only when tiny. |

## Proof Schema Verification

The Proof Schema URL is the only verification dispatch key. A verifier selects
proof-generation and verification behavior by exact Proof Schema URL, then
passes the requirement payload, evidence payload, and verifier details to the
module that implements that Proof Schema.

The shared verification types carry only fields common to all Proof Schemas plus
opaque payloads defined by the selected Proof Schema. The target architecture
has no shared
`VerificationFactor` union, no `DEFAULT_VERIFICATION_FACTORS`, and no SDK-wide
static factor-check registry. Issues 0146, 0147, and 0148 own relocating any
remaining implementation to Proof Schema payload fields, modules, and runtime
registration keyed by Proof Schema URL.

Built-in Proof Schemas follow the same boundary as third-party Proof Schemas:

- The TLSNotary Proof Schema owns its HTTPS response predicate, nonce or replay
  prevention rules, timestamp freshness rules, proof evidence format, and
  redacted verifier-detail payload.
- The C2PA image Proof Schema defines its manifest predicate, signed GPS evidence format,
  maximum-distance policy, C2PA integrity checks, and verifier-detail payload.

Terms such as nonce, timestamp, GPS distance, or any local "factor" label are
vocabulary used inside a Proof Schema. They do not define dispatch throughout
the protocol or SDK values.

The SDK extension point is a Proof Schema bundle registered by exact Proof Schema URL via
`registerSchemaBundle` from the public SDK API:

```ts
registerSchemaBundle({
  uri,
  producer,
  verifier,
  checks,
  configSchema,
  resolveEvidence,
});
```

`producer` and `verifier` are optional Provider/Customer local adapters.
`checks` are the Oracle-side Proof checks for that Proof Schema. `configSchema`
narrows the opaque options payload for that Proof Schema, and `resolveEvidence`
maps transport response payloads into its opaque evidence payload. The shared
verifier looks up the request's Proof Schema URL, resolves that bundle, and runs
only that bundle's checks; it does not import validators for a particular Proof
Schema or maintain a shared default factor list.

Runtime configuration for each Proof Schema is passed as a map keyed by Proof Schema URL
(`schemaOptions[uri]`). Built-in reference adapters use that map for values
such as a notary URL, verifier binary path, content-credential tool path, or
integrity-store instance. The TLSNotary and C2PA image implementations are
registered as reference bundles under `packages/sdk/src/proofs/`; core SDK
modules route through the registry rather than importing their internals.

## Naming

Public protocol, docs, SDKs, and examples should use **Customer**,
**Provider**, and **Oracle**.

Older customer/provider terms may remain only where a current protocol field already
uses that spelling. Versioned protocol replacements should remove those names
instead of retaining aliases. New SDK APIs, docs, and examples should not copy
the old vocabulary.

Application vocabulary such as market, marketplace, bounty, bot shield, binary
bet, royalty, and supply chain is not core Anchr vocabulary and must not be the
default repository theme or public package API.

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

- Protocol message specifications live under [`specs/`](../specs/),
  CC0. Anyone may implement them.
- Threat-model invariants and attack tests are in
  [`docs/threat-model.md`](threat-model.md).
- Cross-document placement rules for shared protocol requirements, security
  invariants, package APIs, adapters, examples, and agent harness rules are
  in [`docs/universality-boundaries.md`](universality-boundaries.md).

## Interoperable Nostr Requirements

Anchr can be summarized as:

```text
Nostr DVM-style transport + payment lock + Oracle-verified proof.
```

NIP-90 and the Anchr specifications define the Nostr requirements that compatible
implementations share. The SDK Nostr adapter owns relay connections,
subscriptions, runtime wiring, and service orchestration;
`@anchr/protocol` owns the event kinds, tags, payloads, NIP-44 encryption
boundaries, signing helpers, and Cashu settlement fields that compatible Anchr
actors must share to interoperate in v0.

The canonical v0 Customer/Provider/Oracle exchange uses relay-delivered Nostr
events and NIP-44 direct messages. The relay Oracle service is the SDK owner for
verification-triggered preimage or release-material issuance in that exchange.

Oracle discovery is relay-based. Oracles announce kind 30088 registry events
with a stable `t` tag of `anchr-oracle`; Proof Schema capability keys are exact
Proof Schema URLs carried in `s` tags and the announcement's `supported_schemas`
field. Static Oracle lists are application policy and are supplied by the
application when needed.

## Follow-On Work

This map is enforced by `deno task lint:arch`, the root workspace in
`deno.json`, and the package publish dry run.
