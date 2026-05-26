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
| `deno task test:all` | `automated` | Local verification bar from `CLAUDE.md`. |
| `deno task test:all:docker` | `automated` | Docker-backed verification bar from `CLAUDE.md`. |
| `skills/arch-lint-llm/SKILL.md` | `semantic skill` | God modules, hidden service locators, duplicated state machines, inappropriate intimacy, oversized functions, and domain leakage that deterministic architecture lint cannot prove. |
| `skills/check-silent-bypass/SKILL.md` | `semantic skill` | Plausible-looking branches that skip verification, validation, settlement, redemption, auth, signing, or quorum checks. |
| `skills/resolve-issues/SKILL.md` | `semantic skill` | Issue closure discipline: dependency checks, resolver-led splitting, focused implementation, verification, resolution notes, and moving issues only after checks pass. |
| `skills/make-issues/SKILL.md` | `semantic skill` | Converting review findings and TODOs into repository-tracked pending issues without overfitting the implementation split. |
| `skills/make-sub-issues/SKILL.md` | `semantic skill` | Creating resolver-led child issues and parent/child dependency links when one issue is too broad for a coherent verified change. |
| `skills/test-regtest/SKILL.md` | `semantic skill` | Manual and automated regtest runbook selection. |
| `skills/test-tlsn/SKILL.md` | `semantic skill` | Manual and automated TLSNotary verification runbook selection. |
| `deno task smoke` from a Testnet example directory | `automated` | The example's local compile/API-drift smoke check before maintainers advertise or keep a README status of `Testnet`. |
| `docs/threat-model.md` plus `docs/threat-model.lock.json` | `human universal decision` and `automated` | Security invariants and drift-locked changes to their claims, attacks, and expected outcomes. |
| `docs/universality-boundaries.md` | `human universal decision` | Placement of universal protocol, security, architecture, package, adapter, example, and agent-harness decisions. |
| `docs/example-delivery-lifecycle.md` | `automated` process input | Requirements, promotion checklist, verification routing, and closure notes for README-listed examples. |
| `docs/issues/README.md` | `automated` process input | Issue structure, dependency recording, closure format, review residual recording, and security-sensitive issue limits. |

## Example Testnet Smoke Convention

Every README-listed `Testnet` example must provide a consistent local
completion bar:

- A README status line and runbook that name the local services the example
  assumes, such as relay, mint, Oracle, notary, verifier, sandbox API, or media
  fixture.
- A non-secret environment section or template. Placeholders are fine; private
  keys, source ecash proofs, bearer tokens, or production credentials are not.
- A command sequence for both sides of the demonstrated flow, using the
  example's actual Customer/Provider or customer/provider vocabulary.
- `deno task smoke` from the example directory. The smoke task must be
  deterministic and safe for local review: it can type-check scripts, run
  fixture-backed tests, and parse config, but it must not require funded tokens,
  production credentials, or live external accounts.
- A runbook section for live or Docker-backed validation when the smoke task
  cannot cover relays, mints, notaries, or third-party sandboxes.

Task naming is intentionally narrow:

- `check` means compile/type/API-drift coverage.
- `test` means local fixture-backed behavior coverage.
- `smoke` is the maintained pre-advertising command and should call `check`,
  `test`, or both.

Before marking or keeping an example as `Testnet`, maintainers should run its
`deno task smoke`, then follow the runbook's live-service path when the README
claims a reproducible end-to-end flow. If the smoke task only compiles scripts,
the runbook must state which live dependencies remain outside the smoke check.

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
| Infrastructure-specific regression | `automated` | Relay, regtest, FROST, or TLSN e2e bucket | Add coverage to the bucket matching the infrastructure profile. |
| Concrete technology leaking into a universal contract | `human universal decision` | `docs/universality-boundaries.md`, `docs/architecture.md`, `specs/` | Decide whether the rule is universal or adapter-specific before coding. |
| Example or product policy leaking into packages | `automated` and `human universal decision` | `deno task lint:arch`, `docs/universality-boundaries.md` | Add vocabulary or dependency lint only when the leak can be detected mechanically. |
| Public vocabulary change | `human universal decision` | `docs/architecture.md`, `specs/`, owning package docs | Record the vocabulary decision before broad renames. |
| Pre-1.0 replaced path kept as a compatibility shim | `automated` | `deno task lint:deprecation` plus tests for new behavior | Delete the path and lock the replacement behavior. |
| Developer-local path, secret-shaped data, or private operational detail in docs or issue text | `automated` for local paths; `human universal decision` for sensitive disclosure | `deno task lint:paths`, `docs/issues/README.md` | Add a redaction rule or a pending issue when the leak pattern is not local-path-shaped. |
| Human disagreement about risk acceptance | `human universal decision` | `docs/threat-model.md`, `docs/universality-boundaries.md`, pending issue resolution notes | Record the accepted risk and the harness follow-up, or leave the issue pending. |
| Review residuals after all required checks pass | `human universal decision` | This document, `docs/issues/README.md`, and pending issue resolution notes | Record only the residual decision, its owning document, or the pending issue that will resolve it. |
| Broad issue requires implementation-aware decomposition | `semantic skill` | `skills/resolve-issues/SKILL.md`, `skills/make-sub-issues/SKILL.md`, `docs/issues/README.md` | Split the parent before implementation and resolve children as independently verified units. |

## Not Yet Covered

These review concerns are not fully owned by the current harness:

| Concern | Current handling | Convert to |
| --- | --- | --- |
| Repeated natural-language ambiguity in issue plans or resolution notes | Human review during `resolve-issues` | Issue-template guidance in `docs/issues/README.md` or a repository skill rubric update. |
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
   `not yet covered` until the harness owner is chosen.

## Residual Review

After the required verification commands and semantic skills pass, human review
should be limited to residual decisions that cannot be reduced to the current
harness. The reviewer should check only whether the change leaves one of these
decisions:

- a protocol, security, architecture, or public-vocabulary decision whose
  owning home is unclear;
- an explicit risk acceptance, including a security, funds-flow, privacy,
  replay, or availability tradeoff;
- a specification or threat-model change that needs maintainer agreement before
  it becomes normative;
- an infrastructure, runbook, or external dependency gap that prevented the full
  verification bar from running;
- a repeated review concern that should become a test, lint, semantic skill,
  docs lock, spec entry, or pending issue.

Routine style, naming consistency, local readability, formatting, type safety,
package boundaries, and behavior regressions are not residual review topics
once the relevant harness owner exists. If a human reviewer still has to catch
one of those, route it through the maintenance loop below.

### Recording residuals

Use the `Review residuals:` field in issue resolution notes:

- `None` when no human decision remains after verification.
- A concise bullet naming the residual decision and its owning document when the
  maintainer accepted it in the same change.
- A pending issue number when the residual cannot be closed in the current
  change.

Do not close an issue with an unresolved residual unless the maintainer
explicitly accepts the risk. If the same residual appears again, treat it as a
new review finding and route it through the maintenance loop.

## Maintenance Loop

Every human review finding on AI output should either go away the next time the
same shape appears, or be recorded as a deliberate residual. This loop defines
how to route a finding so the harness, not a human reviewer, catches the next
occurrence.

### Drift classes

Classify the finding into exactly one of these before deciding where it lives.
Pick the most specific class that fits; if more than one applies, prefer the
class higher in the table.

| Class | Definition | Default home |
| --- | --- | --- |
| `bug regression` | A previously-working behavior or contract no longer holds. The fix is a concrete code change with an observable failure mode. | Add the narrowest failing test next to the code (unit, integration, or e2e bucket matching the infrastructure profile), then fix the code. |
| `boundary drift` | A layer, package, vocabulary, dependency-direction, or runtime-placement rule is violated. The shape of the violation is structural, not semantic. | Extend `scripts/arch-lint.ts` (or another `scripts/lint-*.ts`) plus its test fixture. Use `skills/arch-lint-llm/SKILL.md` only when the rule cannot be expressed deterministically. |
| `semantic bypass` | A plausible-looking branch skips a verification, validation, settlement, redemption, auth, signing, or quorum check. The pattern requires reading intent across files. | Add the concrete shape to `skills/check-silent-bypass/SKILL.md`. Add a deterministic lint or test if the pattern can be reduced to a syntactic check. |
| `missing invariant` | A security, fund-flow, oracle-release, privacy, or replay property is implicit and not locked. Weakening it would invalidate a `README.md` or threat-model claim. | Add or update an invariant in `docs/threat-model.md`, record it in `docs/threat-model.lock.json` via `deno task lint:invariants`, and reference the pinning test or attack class. |
| `unclear universal decision` | A rule is presented as protocol-universal but might really be reference-implementation or adapter policy, or vice versa. The disagreement is about which class in `docs/universality-boundaries.md` owns the rule. | Decide the class in `docs/universality-boundaries.md`, move the normative statement to the owning home (`specs/`, `docs/threat-model.md`, `docs/architecture.md`, package `SPEC.md`, or `examples/<name>/`), and link from any lower-level document. |

### Routing rules

- A drift class always maps to one of: a new or extended test, a new or
  extended deterministic lint, a new or extended semantic skill, a normative
  edit to `docs/threat-model.md` plus its lock, an edit to
  `docs/universality-boundaries.md` or another universal doc, or a pending
  issue that names which of these will be added.
- Prefer deterministic automation over semantic skills when the pattern is
  syntactic or can be reduced to one. Prefer skills over docs when the pattern
  needs cross-file reading but follows a stable rubric. Prefer docs and specs
  only when the rule is really a universal decision.
- A pending issue is the correct home only when the right harness update is
  known but cannot be made in the current change, or when the right harness
  update is itself a design question. Naming the harness update is part of the
  issue.
- A skill or lint update belongs in the same change as the fix when the change
  is small enough to verify locally. When that is not practical, create a
  pending issue that points at the specific file to extend.

### Closing an issue

When resolving any issue under `docs/issues/pending/`, the resolution note
must record one of:

- the harness update that was made (test, lint, skill, threat-model entry,
  universality-boundary entry, or spec edit), with file paths; or
- a one-line rationale stating why no harness update was needed for this
  finding.

Acceptable rationales include: the finding is a one-time design decision now
locked in docs; the harness already catches the underlying class and only the
output had to be reworded; the residual is a `human universal decision` that
belongs to a maintainer call. "Out of scope" alone is not a rationale and must
be paired with a pointer to the pending issue that will close the gap.

This rule is enforced socially by `skills/resolve-issues/SKILL.md` and the
issue-close format in `docs/issues/README.md`. It is not enforced by a
deterministic lint because the rationale is free text.
