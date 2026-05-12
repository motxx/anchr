# Review Harness Map

This document maps recurring human review concerns to the repository harness
that should catch them. It is a routing table: when a concern repeats, move it
from ad hoc review into one of these homes.

## Classes

| Class | Meaning | Expected action |
| --- | --- | --- |
| `automated` | A deterministic command can reject the problem without judgment. | Add or extend a lint, unit test, integration test, e2e test, lock file, or script test. |
| `semantic skill` | The concern needs code reading and judgment, but follows a stable rubric. | Add or extend a repository skill and its pre-ship verifier when the diff can be scoped. |
| `human universal decision` | The concern changes protocol, security, architecture, risk acceptance, or public vocabulary. | Record the decision in `specs/`, `docs/threat-model.md`, `docs/architecture.md`, or `docs/universality-boundaries.md`. |
| `not yet covered` | The concern is known, but no harness owns it yet. | Create a pending issue that chooses one of: test, lint, semantic skill, docs lock, or spec update. |

## Current Harness

| Harness | Class | Owns |
| --- | --- | --- |
| `deno task lint:strict` | `automated` | Baseline lint, formatting, architecture, invariant locks, path leaks, type bar, pre-1.0 replacement policy, history comments, dynamic imports, test sanitizer bypasses, and unit-test network listeners. |
| `deno task lint:arch` | `automated` | Layer direction inside `packages/bounty`, inter-package dependency rules, banned runtime packages, package vocabulary leakage, `Deno.*` placement, `console.*` placement, and example-to-package public-surface use. |
| `deno task lint:invariants` | `automated` | Bidirectional drift detection between `docs/threat-model.md`, tests, and `docs/threat-model.lock.json`. |
| `deno task lint:types` | `automated` | `any`, broad casts, double casts, and unexplained `unknown` at non-boundary sites. |
| `deno task lint:paths` | `automated` | Developer-local absolute paths in tracked text. |
| `deno task lint:deprecation` | `automated` | Pre-1.0 policy that replaced code paths are deleted instead of kept as aliases or deprecated shims. |
| `deno task lint:no-history-comments` | `automated` | Comments that narrate change history instead of explaining current code. |
| `deno task lint:no-dynamic-import` | `automated` | Dynamic import drift. |
| `deno task lint:no-test-sanitizer-bypass` | `automated` | Test code that disables Deno sanitizer protections. |
| `deno task lint:no-unit-network-listener` | `automated` | Unit tests that open network listeners. |
| `deno task test:unit` | `automated` | Pure package behavior without external I/O. |
| `deno task test:integration` | `automated` | In-process package integration over local HTTP, WebSocket, or Blossom-style boundaries. |
| `deno task test:scripts` | `automated` | Repository script parsers and harness helpers. |
| `deno task test:examples` | `automated` | Example-level compile and behavior checks. |
| `deno task test:e2e:protocol` | `automated` | Protocol attack, trust, and quorum flows that do not require external infrastructure. |
| `deno task test:e2e:relay` | `automated` | Nostr relay-backed flows. |
| `deno task test:e2e:regtest` | `automated` | Cashu, Lightning regtest, Blossom, and full bounty lifecycle flows. |
| `deno task test:e2e:frost` | `automated` | FROST threshold behavior. |
| `deno task test:e2e:tlsn` | `automated` | TLSNotary proof generation and verification. |
| `deno task test:e2e:pentest` | `automated` | API attack classes such as auth bypass, injection, SSRF, rate limits, DoS, and Oracle attacks. |
| `deno task test:all` | `automated` | Local verification bar from `CLAUDE.md`. |
| `deno task test:all:docker` | `automated` | Docker-backed verification bar from `CLAUDE.md`. |
| `skills/arch-lint-llm/SKILL.md` | `semantic skill` | God modules, hidden service locators, duplicated state machines, inappropriate intimacy, oversized functions, and domain leakage that deterministic architecture lint cannot prove. |
| `skills/check-silent-bypass/SKILL.md` | `semantic skill` | Plausible-looking branches that skip verification, validation, settlement, redemption, auth, signing, or quorum checks. |
| `skills/resolve-issues/SKILL.md` | `semantic skill` | Issue closure discipline: dependency checks, focused implementation, verification, resolution notes, and moving issues only after checks pass. |
| `skills/make-issues/SKILL.md` | `semantic skill` | Converting review findings and TODOs into repository-tracked pending issues. |
| `skills/test-regtest/SKILL.md` | `semantic skill` | Manual and automated regtest runbook selection. |
| `skills/test-tlsn/SKILL.md` | `semantic skill` | Manual and automated TLSNotary verification runbook selection. |
| `docs/threat-model.md` plus `docs/threat-model.lock.json` | `human universal decision` and `automated` | Security invariants and drift-locked changes to their claims, attacks, and expected outcomes. |
| `docs/universality-boundaries.md` | `human universal decision` | Placement of universal protocol, security, architecture, package, adapter, example, and agent-harness decisions. |
| `docs/issues/README.md` | `automated` process input | Issue structure, dependency recording, closure format, and security-sensitive issue limits. |

## Review Concern Map

| Review concern | Class | Harness owner | If it is missed |
| --- | --- | --- | --- |
| Type-system bypass via `any`, double casts, or broad assertions | `automated` | `deno task lint:types` | Extend `scripts/lint-types.ts` with a focused fixture. |
| Package or layer dependency drift | `automated` | `deno task lint:arch` | Extend `scripts/arch-lint.ts` and its tests if the rule is structural. |
| Semantic architecture drift that static imports cannot show | `semantic skill` | `skills/arch-lint-llm/SKILL.md` | Add the pattern to the skill rubric or create a deterministic lint if it becomes syntactic. |
| Security invariant weakening | `human universal decision` and `automated` | `docs/threat-model.md`, `docs/threat-model.lock.json`, `deno task lint:invariants` | Add or update an invariant and lock it with a test reference. |
| Silent bypass of verification, validation, settlement, redemption, auth, signing, or quorum logic | `semantic skill` | `skills/check-silent-bypass/SKILL.md` | Add a concrete pattern to the skill rubric, then add a deterministic test if the shape repeats. |
| Missing behavior coverage in package code | `automated` | `deno task test:unit` or `deno task test:integration` | Add the narrowest test at the owning package boundary. |
| Cross-actor protocol regression | `automated` | `deno task test:e2e:protocol` | Add an e2e test with a protocol-level name. |
| Infrastructure-specific regression | `automated` | Relay, regtest, FROST, TLSN, pentest, or web e2e bucket | Add coverage to the bucket matching the infrastructure profile. |
| Concrete technology leaking into a universal contract | `human universal decision` | `docs/universality-boundaries.md`, `docs/architecture.md`, `specs/` | Decide whether the rule is universal or adapter-specific before coding. |
| Example or product policy leaking into packages | `automated` and `human universal decision` | `deno task lint:arch`, `docs/universality-boundaries.md` | Add vocabulary or dependency lint only when the leak can be detected mechanically. |
| Public vocabulary change | `human universal decision` | `docs/architecture.md`, `specs/`, owning package docs | Record the vocabulary decision before broad renames. |
| Pre-1.0 replaced path kept as a compatibility shim | `automated` | `deno task lint:deprecation` plus tests for new behavior | Delete the path and lock the replacement behavior. |
| Developer-local path, secret-shaped data, or private operational detail in docs or issue text | `automated` for local paths; `human universal decision` for sensitive disclosure | `deno task lint:paths`, `docs/issues/README.md` | Add a redaction rule or a pending issue when the leak pattern is not local-path-shaped. |
| Human disagreement about risk acceptance | `human universal decision` | `docs/threat-model.md`, `docs/universality-boundaries.md`, pending issue resolution notes | Record the accepted risk and the harness follow-up, or leave the issue pending. |

## Not Yet Covered

These review concerns are not fully owned by the current harness:

| Concern | Current handling | Convert to |
| --- | --- | --- |
| Repeated natural-language ambiguity in issue plans or resolution notes | Human review during `resolve-issues` | Issue-template guidance in `docs/issues/README.md` or a repository skill rubric update. |
| Review residuals after all required checks pass | Human reviewer judgment | #0018 should define the residual checklist and where it is recorded. |
| Deciding whether a newly found drift deserves lint, a semantic skill, a spec update, or only an issue | Human reviewer judgment | #0017 should define the maintenance loop and require a short rationale when no harness update is made. |
| Coverage quality inside manual runbooks | Human review plus runbook skills | Add focused script tests when a runbook command can be parsed or simulated. |

## Updating This Map

When a review finding repeats:

1. Classify it with the table above.
2. Prefer deterministic automation if the bad shape is syntactic or can be
   tested directly.
3. Prefer a semantic skill when the pattern requires reading intent across a
   small set of files.
4. Prefer docs or specs when the finding is really a universal decision.
5. If the right home is unclear, create a pending issue and mark the concern as
   `not yet covered` until #0017 or #0018 resolves the process gap.
