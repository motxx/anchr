# Universality Boundaries

This document defines where a design decision belongs before an agent turns it
into code. Its purpose is to keep human review focused on the few choices that
set Anchr's universal contract, while routine implementation choices stay close
to their owning package, adapter, or example.

## Decision classes

Use the narrowest class that can hold the decision.

| Class | Meaning | Home |
| --- | --- | --- |
| Universal protocol contract | A rule that independent Customer, Provider, or Oracle implementations must share to interoperate. Includes wire payloads, event tags, schema identifiers, role-neutral state transitions, and cross-implementation validation rules. | `specs/` |
| Security invariant | A funds, proof, oracle-release, or privacy property that Anchr claims as a safety guarantee. | `docs/threat-model.md` plus tests or attack-class cross references |
| Architecture boundary | A role, layer, package, dependency-direction, naming, or adapter boundary that keeps the implementation aligned with the three-actor model. | `docs/architecture.md` |
| Package implementation contract | A package-owned API, algorithm, port shape, error model, or conformance expectation that other packages call but that is not itself a network wire contract. | The package `SPEC.md`, README, and colocated tests |
| Adapter or runtime integration | A binding to a concrete runtime, protocol bridge, CLI, HTTP gateway, MCP server, mobile bridge, browser API, hosted service, or operator workflow. | Adapter package docs or `example/<app>/` |
| Example policy | A product, demo, UX, deployment, mint/relay/oracle choice, moderation rule, pricing rule, or other concrete-app decision. | The owning `example/<app>/` |
| Agent harness rule | A rule about how coding agents, review skills, lints, issue templates, or verification commands keep the repository healthy. | `CLAUDE.md`, `AGENTS.md`, `skills/`, `scripts/`, or `docs/issues/README.md` |

If a decision fits more than one row, put the normative statement in the
highest row that truly needs it, then link to it from the lower-level document.
Do not duplicate the same normative rule in several places.

## Placement rules

- Put a decision in `specs/` only when another implementation would need the
  same rule to communicate with Anchr actors or validate Anchr wire data.
- Put a decision in `docs/threat-model.md` when weakening it could move funds,
  release Oracle material incorrectly, accept forged evidence, leak protected
  data, or invalidate a security claim in `README.md`.
- Put a decision in `docs/architecture.md` when it constrains role boundaries,
  layer direction, package ownership, or public vocabulary across packages.
- Put a decision in a package `SPEC.md` when it defines how that package
  implements or exposes a capability, but other implementations can choose a
  different internal model and remain protocol-compatible.
- Put adapter-specific choices outside `specs/` unless the adapter is defining a
  public interoperability profile. A profile may live in `specs/` only when it
  is intended for independent implementations, not just the reference code.
- Put example-specific decisions under `example/<app>/`. Examples may choose
  relays, mints, oracles, schemas, UI flows, and operational policy, but those
  choices must not become package defaults by accident.
- Put agent runtime integrations such as MCP in adapter or example docs. They
  are not protocol actors and must not be required by Customer, Provider, or
  Oracle SDKs.

## Example status vocabulary

The top-level `README.md` Reference Implementations table uses these labels for
example maturity. The labels are repository documentation policy, not protocol
status, and belong to the owning example plus this boundary document.

| Status | Meaning | Minimum bar |
| --- | --- | --- |
| `Concept` | A design sketch or UX target that may contain runnable fragments, but is not maintained as an end-to-end example. | README states the intentional non-runnable boundary, names the target architecture, and avoids promising deployable behavior. |
| `Simulation` | A runnable or partially runnable flow with mocked, in-process, fixture, or non-fund-bearing dependencies. | README names the simulated pieces, provides the command or test that exercises the simulation, and states what must change before testnet or mainnet use. |
| `Testnet` | A reproducible reference flow for non-production relays, mints, notaries, or external sandboxes. | README lists required services and non-secret env vars, provides a runbook or command sequence for both sides of the flow, and has a smoke check or documented verification command that catches SDK/API drift. |
| `Implemented` | A maintained implementation whose advertised behavior is covered by repository tests or an equivalent example-specific harness. | README links the relevant commands, tests, or deployment runbook and states any remaining non-production limitation. |

Do not promote a status label to `specs/`: it does not change the universal
Customer, Provider, Oracle, proof, or settlement contracts. If an example needs
stricter requirements, record them in that example's README. If several
examples need the same repeatable smoke harness, route the convention through
`docs/review-harness.md` or a repository script.

## Human review scope

Human review should decide whether a change moves a boundary between these
classes. In particular, a reviewer should look at:

- whether a supposedly universal rule is actually just reference
  implementation policy;
- whether an adapter or example choice has leaked into `packages/` or `specs/`;
- whether a security claim belongs in the threat model with an enforceable test;
- whether a package `SPEC.md` is carrying a wire-format rule that belongs in
  `specs/`;
- whether a new agent or harness rule should be encoded as lint, tests, a skill,
  or issue guidance instead of repeated review comments.

Routine implementation details should be reviewed by the existing harness:
types, lints, tests, architecture checks, semantic skills, and issue resolution
notes.

## Applying this to pending work

The current pending issues should use these boundaries as follows:

- SDK splitting and component-boundary work should update
  `docs/architecture.md` for package and layer ownership, package `SPEC.md`
  files for implementation contracts, and `specs/` only for role-neutral
  interoperability contracts.
- Experimental technology extraction should treat Nostr, Cashu, TLSNotary, and
  Blossom as adapter or primitive-package decisions unless a rule is required
  for independent Anchr actors to interoperate.
- Harness and human-review issues should modify `CLAUDE.md`, `skills/`,
  `scripts/`, or `docs/issues/README.md` when they define repository process,
  and should link back to this document when they classify a review point as a
  human universal decision.
