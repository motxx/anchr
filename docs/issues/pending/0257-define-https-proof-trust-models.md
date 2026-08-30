# Define HTTPS proof trust and interaction models

Created: 2026-08-30
Model: OpenAI GPT-5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Define how Anchr represents the trust assumptions and interaction patterns of
proofs derived from HTTPS responses. The current TLSNotary path uses a portable
presentation signed by a Notary and later verified by an Oracle. Pinning that
Notary key makes the trust root explicit, but also exposes an architectural
choice that is not yet documented: a Customer ultimately relies on both the
Oracle and on the Notary not colluding with the Provider.

The design must compare that path with at least two alternatives: an Oracle
participating directly as the online MPC-TLS verifier, and a target service
signing its own HTTP response so that verification does not require TLSNotary.
Decide how these mechanisms fit the existing Proof Schema URL dispatch without
adding a shared `trustMode` switch or silently weakening a Customer's requested
proof policy.

## Rationale

- Issue 0171 secures the existing portable TLSNotary path by persisting and
  pinning a Notary key. It does not decide whether that third-party trust root
  is the long-term default or how a Customer constrains it.
- A TLS certificate authenticates the handshake, not an HTTP response to an
  offline third party. Portable TLSNotary evidence therefore depends on the
  selected Notary not colluding with the Provider.
- If the Oracle participates directly in MPC-TLS, the extra Notary trust root
  can be removed, but proof production becomes an online, stateful interaction
  that must be bound to the query, Provider, deadline, and Oracle session.
- If the target service signs the response body and request context with an
  application signing key, the proof can be publicly verified without
  TLSNotary, but key identity, canonicalization, nonce, freshness, and body
  binding must be owned by that Proof Schema.
- `docs/architecture.md` currently makes the exact Proof Schema URL the only
  verification dispatch key and requires Proof Schema verification to remain
  isolated from actor orchestration. The decision must preserve that ownership
  boundary or explicitly revise it.
- Issues 0250 and 0251 describe pure, deterministic Proof Schema verification.
  An interactive MPC session must be placed before that pure verification step
  or justified as a deliberate change to the target architecture.

## Acceptance

- A durable ADR, architecture section, or specification records a threat-model
  matrix for portable TLSNotary, Oracle-direct MPC-TLS, and service-signed HTTP
  responses, including trusted actors, non-collusion assumptions, online
  requirements, portability, and privacy properties.
- The decision separates the proof mechanism from its trust policy and assigns
  each interoperable requirement, evidence format, runtime trust root, and
  actor-orchestration responsibility to one owner.
- The decision states whether proof algorithms continue to dispatch by exact
  Proof Schema URL and whether portable TLSNotary, Oracle-direct MPC-TLS, and
  service-signed responses use distinct Proof Schemas.
- The Customer's authority to require a mechanism and constrain accepted
  Notary or service signing keys is defined, together with how those constraints
  intersect with an Oracle's local allowlist.
- Oracle discovery requirements are decided for supported Proof Schemas,
  interactive verification capability, accepted trust roots, and any session
  endpoint needed before a Provider starts proof production.
- Failure and downgrade behavior is explicit: an unavailable requested
  mechanism cannot silently fall back to a weaker trust model.
- The state and binding requirements of Oracle-direct MPC-TLS are defined at
  the boundary level, including query, Provider, Oracle, nonce, deadline,
  replay, and quorum considerations, without embedding network I/O in the pure
  final-verification function.
- Concrete implementation work is captured as separately reviewable follow-up
  issues after the decision; issue 0171 remains scoped to securing the existing
  portable TLSNotary path.

## Verification

- A reviewer can trace every row of the threat-model matrix to the selected
  Proof Schema, protocol field or opaque schema payload, SDK owner, and runtime
  configuration owner.
- Focused documentation or conformance tests lock the chosen dispatch and
  downgrade rules where they can be checked mechanically.
- `deno task lint:strict` passes.
- `deno task test:unit` passes if protocol or SDK contract fixtures change as
  part of recording the decision.

## Plan

- Inventory the current portable TLSNotary flow, Proof Schema dispatch,
  Oracle discovery, and pure-verification boundary.
- Compare the three HTTPS proof mechanisms and record the selected ownership,
  trust-policy, negotiation, and failure semantics in a durable decision.
- Split implementation work by independently closeable mechanism or protocol
  boundary before changing production code.
