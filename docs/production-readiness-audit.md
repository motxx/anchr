# Production Readiness Audit and Remediation Plan

Maintainer-facing working document. Not part of the public product surface.

- Date: 2026-06-11
- Method: direct review of `docs/architecture.md`, `docs/threat-model.md`,
  `docs/issues/`, repository layout, `deno.json` task wiring, tracked vs.
  untracked file state (`git ls-files`), and `.github/workflows/`, followed by
  six read-only deep-audit work orders (WO-1…WO-6) executed against the code.
- Coverage status: **complete**. Section 2 holds the governance findings
  (F-01…F-08, each now carrying a verified resolution status) and the
  code-level findings appended by the six work orders (SDK / ARCH / ANON /
  PROT / SPEC / OPS prefixes). Section 7 is the coverage appendix
  ("Checked, OK"). Section 8 is the prioritised remediation backlog.

## 1. Executor contract

Any agent acting on this document MUST obey the repository rules. Violating
them produces changes that the lint gates will reject:

1. **Deno only.** `deno task <name>`, `deno test`, `deno run`. Never
   `npm`/`yarn`/`pnpm`/`vitest`/`jest`/`ts-node`. The `crates/*` Rust binaries
   are the single documented exception and build via `cargo`.
2. **Type bar.** No `as`, no `any` anywhere under `packages/`. Narrow with
   type predicates. `unknown` only at boundaries (HTTP body, `JSON.parse`,
   `catch (err)`).
3. **No `console.*` in `packages/`** (rule E021). Use the existing logger.
4. **Pre-1.0 replacement policy.** Delete replaced paths outright. No
   `@deprecated`, no "legacy"/"backward compat" shims. Lock new behaviour with
   a test (`lint:deprecation` enforces this; Markdown excluded).
5. **Test placement.** Unit `*.test.ts` next to source; integration
   `*.integration.test.ts` next to source; e2e under `e2e/<bucket>/` where
   bucket ∈ {protocol, relay, regtest, frost, tlsn}. No `deno.json` edits to
   register tests.
6. **Examples import only `@anchr/*`** (rule E023). Application vocabulary
   (market, marketplace, bet, …) is forbidden in `packages/` (rule E022).
7. **Verification bar.** A change is done only after `deno task test:all` and,
   for relay/regtest/tlsn-affecting changes, `deno task test:all:docker` pass.
   Never skip, weaken, or `--no-check` a failing test — fix the implementation.
8. **Threat-model drift guard.** Any change to an invariant's
   Claim/Attack/Expected body requires a matching hash + `justification`
   update in `docs/threat-model.lock.json`.
9. **Repo skills.** After touching verification, settlement, redemption,
   escrow, or quorum code, run the `check-silent-bypass` skill. After
   structural refactors, run `arch-lint-llm`. New work items go through
   `make-issues` / `make-sub-issues`.
10. **Verify before fixing.** Re-read the cited files before editing; this
    document records state as of 2026-06-11 and the repository may have moved.

## 2. Findings

Severity scale: `blocker` = must be resolved before any production/public
release; `high` = security or correctness risk; `medium` = robustness,
interop, or documentation-accuracy risk; `low` = polish.

### 2.1 Governance findings (F-01…F-08)

These were raised against the governance docs on 2026-06-10. Each now carries a
verified **Status (2026-06-11)** confirmed against the current tree.

#### F-01 — INV-05 (FROST threshold safety) declared but not specified or enforced

- Severity: **blocker**
- Status: **Resolved.** INV-05 is a full invariant entry in
  `docs/threat-model.md` (Claim/Attack/Expected/Tests, `Status: enforced`),
  with a matching `docs/threat-model.lock.json` entry, bound to
  `e2e/frost/frost-threshold.test.ts` (`INV-05: ATTACK: 1-of-3 (below
  threshold) -> aggregation fails`). `deno task lint:invariants` passes.
  WO-4 confirms the Rust `crates/frost-signer` aggregate rejects below-threshold
  via `frost-secp256k1-tr`. Residual share/nonce concerns are tracked as
  PROT-08 (§2.5).

#### F-02 — INV-06 (C2PA manifest signature + GPS binding) declared with no implementation path

- Severity: **high**
- Status: **Resolved by implementation — the 2026-06-10 "remove from v0"
  decision was superseded.** Issue 0115 (closed) implemented
  `verifyC2paGpsBinding()` in `packages/sdk/src/proofs/c2pa-validation.ts`
  (fail-closed when the verifier is unavailable, the manifest is missing, the
  signature is invalid, signed GPS is absent, or signed GPS is out of range),
  routed photo-integrity through it, promoted **INV-06** in
  `docs/threat-model.md` (+ lock entry), and reintroduced
  `ProofSchema.C2paImageV1`, the spec-site page, and the README/spec surface.
  A silent-bypass fix bound the `c2pa` verification factor to evidence
  presence (a `c2pa`-required request with only a non-image attachment now
  fails closed). INV-06 tests cover invalid signature, missing signed GPS, and
  out-of-range signed GPS. Verify: `deno task lint:invariants`,
  `deno task lint:proof-schema-pages`.

#### F-03 — INV-03 / INV-04 (HTLC locktime and bound-escrow safety) cross-referenced only

- Severity: **medium**
- Status: **Resolved.** Both invariants are now `Status: enforced` in
  `docs/threat-model.md`. WO-4 confirms the redeem paths
  (`packages/sdk/src/payments/cashu/cashu-escrow.ts`,
  `packages/sdk/src/adapters/cashu.ts`) run a local NUT-14 spend-auth +
  hashlock check before the mint swap and return `null`/throw on failure — no
  preimage-alone redemption. `deno task lint:invariants` passes.

#### F-04 — Oracle trust assumption must be explicit in user-facing claims

- Severity: **high** (documentation correctness)
- Status: **Resolved.** Root `README.md` and `packages/sdk/README.md` both
  carry a "Trust Assumptions" section covering the two residual trust roots
  (Oracle honesty up to the FROST threshold; single Cashu mint
  solvency/honesty). The claim↔invariant mapping remains CI-enforced by
  `lint:invariants`.

#### F-05 — Stale application vocabulary ("pool-based betting model", "market creation")

- Severity: **medium**
- Status: **Resolved.** `grep -niE 'betting|market' docs/threat-model.md`
  returns nothing. The DLC comparison no longer frames Anchr as a
  betting/market product.

#### F-06 — Remaining release work is issues 0085 → 0080

- Severity: **blocker** (release gate)
- Status: **Resolved.** Both issues are in `docs/issues/closed/` (commit
  `0481f84`, "Close public-release layout and cleanup tracking issues 0085 and
  0080"). The pending issue queue (`docs/issues/pending/`) is empty.

#### F-07 — Untracked local directories must not be mistaken for repo content

- Severity: **low** (executor guardrail)
- Status: **Standing guidance — no repo change.** Scope all cleanup work to
  `git ls-files` output. `dist/`, `mobile/`, `packages/sdk/dist/`,
  `packages/sdk/node_modules/`, `packages/sdk/types/`, `e2e/web/`,
  `e2e/pentest/` carry zero tracked files.

#### F-08 — `spec-site/` and deploy workflows must be classified by the layout pass

- Severity: **medium**
- Status: **Resolved for `spec-site/` and `tools/types/`** (both now have
  owner rows in the `docs/architecture.md` component table; `spec-site/` is
  deployed by `deploy-proof-schema-site.yml`). **Extended by WO-2:** the
  component table still omits `crates/`, `docs/`, and `skills/` — see ARCH-02
  and ARCH-03 (§2.3).

### 2.2 SDK public-interface findings (WO-1)

#### SDK-01 — `requests/` internal domain types leak into the public type surface

- Severity: **high**
- Files: `packages/sdk/src/index.ts:145`;
  `packages/sdk/src/adapters/oracle-client/index.ts:22-29`;
  `packages/sdk/src/adapters/nostr/oracle-service.ts:37-40,95-107`;
  `packages/sdk/src/proofs/verification/verifier.ts:12-18,62,76,91`;
  `packages/sdk/src/proofs/verification/checks/types.ts:9-14`
- Evidence: public functions (`verify`, `requestToRequirement`,
  `OracleNostrService.verifyAndDeliver`) take/return `Query`, `QueryResult`,
  `VerificationRequirement`, `VerificationInput`, `VerificationDetail`,
  `OracleRegistry`, `BlossomKeyMap`, but those types are exported only from
  `@anchr/sdk/testing` (a testing entry point) or from nowhere public. `docs/architecture.md:118-122,131`
  assigns them to `requests/domain/`, "not a public `@anchr/sdk/requests`
  subpath". `deno task lint:arch` authorises the file-to-file import edges but
  never checks whether an internal type is re-exported through a public
  `deno.json` subpath.
- Why it matters: a consumer of `@anchr/sdk/proofs` or `@anchr/sdk/adapters/nostr`
  cannot name the parameter/return types of documented functions without
  importing from a testing-only entry point, or cannot name them at all.
- Remediation: choose an owner home for the proof-verification public
  contract (move public-facing types to the owning feature dir and re-export
  from the same subpath, or expose request-shaped DTOs); then extend
  `scripts/arch-lint.ts` to flag any `requests/`-owned type reachable from a
  non-`/testing` `deno.json` export.
- Verify: `deno task lint:arch` (after the new rule); a `deno check` on a
  sample consumer importing only non-`/testing` subpaths.

#### SDK-02 — `@anchr/sdk/testing` ships no public `CashuClient` fake

- Severity: **medium**
- Files: `packages/sdk/src/testing/mod.ts:1-25`;
  `examples/paid-request-simulation/mod.ts:26-67`;
  `packages/sdk/README.md:169-221`
- Evidence: testing exports `createInMemoryRelayClient` (the relay half) and
  `createMockEscrowProvider` (the internal escrow, not the public
  `CashuClient`). The flagship example and the README both hand-roll a
  `CashuClient` stub.
- Why it matters: every integrator copies a mint stub — the duplication the
  testing module exists to prevent, and a place a subtly-wrong stub hides
  real bugs.
- Remediation: add `createInMemoryCashuClient()` to
  `packages/sdk/src/testing/` and export it; rewrite the README "Testing"
  section and the example to use it (delete the inline fakes per the pre-1.0
  policy).
- Verify: `deno task test:examples`, `deno task lint:strict`.

#### SDK-03 — `architecture.md` §Public Subpaths lists protocol subpaths that do not exist

- Severity: **medium**
- Files: `docs/architecture.md:55-63`; `packages/protocol/deno.json:4-10`
- Evidence: the doc names `@anchr/protocol/schemas` (plural) and `/validators`;
  the package exports exactly `.`, `./events`, `./nostr`, `./schema`
  (singular), `./types`. No `/validators` module exists. The SDK import map
  uses `@anchr/protocol/schema` (singular), matching the package.
- Why it matters: `docs/architecture.md` is the public-subpath contract; a
  consumer following it writes an unresolvable import.
- Remediation: correct the doc to `/schema` and drop `/validators` (if
  validation stays SDK-internal), or add a real `./validators` export. Make
  doc + `deno.json` agree.
- Verify: `deno task lint:arch`; `deno check` importing each documented subpath.

#### SDK-04 — Documented Customer setup path leaks the relay connection (`Customer` has no `close()`)

- Severity: **medium**
- Files: `packages/sdk/src/customer.ts:62-72`;
  `packages/sdk/src/adapters/types.ts:65-73`;
  `packages/sdk/README.md:58-77`
- Evidence: `Provider` exposes `stop()` and `RelayClient`/`Subscription`
  expose `close()`, but `Customer` exposes no teardown; the README's primary
  Customer snippet constructs a live relay pool and never closes it. Per-call
  subscriptions/timers are cleaned up; the leak is the long-lived
  caller-owned `RelayClient`.
- Why it matters: a long-running or per-request Customer leaks WebSocket pools
  and timers.
- Remediation: either document and require `relayClient.close()` in the README
  (and state relay lifecycle is caller-owned), or give `Customer` an explicit
  `close()`. Be consistent with `Provider.stop()`.
- Verify: `deno task test:examples`; README read.

#### SDK-05 — `as` casts on the public Cashu adapter boundary contradict the stated type bar

- Severity: **low**
- Files: `packages/sdk/src/adapters/cashu.ts:193,262,285,311,345,417`;
  `scripts/lint-types.ts:122-137`
- Evidence: `deno task lint:types` demotes `as <Type>` (T010) to a non-gating
  **warning** (163 warnings, exit 0), so `lint:strict` passes despite
  `as Proof[]` / `as CashuProof[]` coercions on the public adapter. CLAUDE.md
  and §1 state `as` is forbidden in `packages/`. Risk is low because
  `isValidProofShape` validates each proof before the cast.
- Why it matters: documentation-vs-enforcement gap on the most
  security-sensitive surface.
- Remediation: either make T010 an error in `packages/` (and have the shape
  predicate return the narrowed `Proof` so no cast is needed), or amend the
  prose to state `as <Type>` is a warned-but-allowed boundary pattern.
- Verify: `deno task lint:types`; `deno task test:unit` for `adapters/cashu`.

#### SDK-06 — `visibility` mitigation absent from the public Customer request API

- Severity: **medium** (class b/c)
- Files: `docs/threat-model.md:247-253`;
  `packages/sdk/src/customer-types.ts:69-79`;
  `packages/protocol/src/types.ts:1-11`;
  `packages/sdk/src/requests/domain/types.ts:77-78,303-304`
- Evidence: the threat model presents `visibility` (required, no default) as
  the user-facing knob preventing accidental proof publication, but it lives
  only inside the SDK-internal `requests/` lifecycle / proof-publication path
  and appears on no public `RequestOptions`/`Spec`. The no-default choice is
  intentional and not flagged; the gap is that the documented public path
  cannot set or observe it.
- Why it matters: the threat-model mitigation is not exercised by the
  documented integration surface.
- Remediation: either surface `visibility` (no default) on the public
  `RequestOptions`/`Spec` and thread it to publication, or scope the
  threat-model "Proof publication" section to the internal QueryService and say
  so.
- Verify: `deno task lint:invariants`; grep that the resolved location matches
  the doc.

#### SDK-07 — `@anchr/sdk/adapters/nostr` `export *` and a second Oracle-service owner

- Severity: **low**
- Files: `packages/sdk/src/adapters/nostr/mod.ts:1-16`;
  `packages/sdk/src/adapters/oracle-service/index.ts:1-9`
- Evidence: `adapters/nostr/mod.ts` re-exports via `export * from "./index.ts"`
  (implicit surface) and exposes `createOracleNostrService`, while the sibling
  `@anchr/sdk/adapters/oracle-service` subpath exports only `buildOracleApp` —
  two adjacent subpaths owning Oracle-service exposure.
- Remediation: replace `export *` with an explicit named-export list; assign
  one owner for the Oracle Nostr service and document the split in
  `docs/architecture.md`; confirm `publishOnce` is intended public.
- Verify: `deno task lint:arch`; `deno check`.

### 2.3 Directory-architecture findings (WO-2)

#### ARCH-01 — No Rust compile/clippy/test gate; `crates/tlsn-server` first built at deploy

- Severity: **high** (merge of WO-2 ARCH-01 + WO-6 OPS-08)
- Files: `scripts/test-all.sh:82,188,193`; `.github/workflows/ci.yml:50-56,72-80`;
  `.github/workflows/deploy.yml:43-62`; no `rust-toolchain.toml`
- Evidence: `test-all.sh` only `cargo build`s `frost-signer`, `tlsn-prover`,
  `tlsn-verifier`. No `cargo clippy` and no `cargo test` exist anywhere.
  `crates/tlsn-server` (the deployed TLSNotary verifier) is first compiled by
  `flyctl deploy`, after CI. The Rust toolchain is the floating
  `dtolnay/rust-toolchain@stable` with no pin.
- Why it matters: a compile- or clippy-breaking change to the cryptographic
  core (FROST release authority, TLSN verifier) passes every CI gate and only
  fails at deploy — a broken-deploy outage with no PR-time signal. CLAUDE.md's
  "done = test:all" does not type-check or lint the Rust code.
- Remediation: add a pinned `rust-toolchain.toml`; add `cargo clippy
  --all-targets -- -D warnings`, `cargo check` for `tlsn-server`, and
  `cargo test --all` to `scripts/test-all.sh` and `ci.yml`; document the Rust
  gate in `docs/architecture.md` and CLAUDE.md.
- Verify: `deno task test:all` builds+clippies+tests all four crates;
  `cargo clippy --manifest-path crates/tlsn-server/Cargo.toml -- -D warnings`.

#### ARCH-02 — `crates/` undocumented in the architecture layout and CLAUDE.md

- Severity: **medium**
- Files: `docs/architecture.md:99` (Native helpers row names no directory);
  CLAUDE.md `## Layout` (string "crates" absent)
- Evidence: `grep -c crates docs/architecture.md` → 0; `grep crates CLAUDE.md`
  → 0. The highest-trust binaries (FROST signer, TLSN prover/verifier/server)
  are unfindable from the layout docs and their build command is unstated.
- Remediation: name `crates/` and the four crates in the architecture
  "Native helpers" row; add a `crates/` bullet to the CLAUDE.md `## Layout`
  section (with the build command and the Rust-exception note).
- Verify: `grep -c crates docs/architecture.md CLAUDE.md` > 0.

#### ARCH-03 — `docs/` and `skills/` missing from the component table

- Severity: **low**
- Files: `docs/architecture.md:94-104`
- Evidence: the table covers Protocol, SDK, Specs, Native helpers, Scripts,
  Examples, E2E, `spec-site/`, `tools/types/` but has no row for tracked
  top-level `docs/` or `skills/` (the latter is described in CLAUDE.md only).
- Remediation: add two rows — `docs/` (maintainer architecture/threat-model/
  issue records) and `skills/` (repo-local Claude/Codex skill definitions;
  `.claude/skills` and `.codex/skills` symlink here).
- Verify: every directory in `git ls-files` first segment has a table row.

#### ARCH-04 — `requests/domain/types.ts` re-exports proof-owned TLSN types (second barrel)

- Severity: **medium**
- Files: `packages/sdk/src/requests/domain/types.ts:52-67`;
  `packages/sdk/src/proofs/tlsn-types.ts:2,10,21,33,39`;
  `packages/sdk/src/proofs/verification/checks/tlsn.ts:4-8`;
  `packages/sdk/src/adapters/nostr/events/oracle-attestation.ts:17`
- Evidence: `requests/domain/types.ts` re-exports `TlsnAttestation`,
  `TlsnCondition`, `TlsnEncryptedContext`, `TlsnRequirement`,
  `TlsnVerifiedData` from `proofs/mod.ts`, and a proofs file
  (`checks/tlsn.ts`) imports `TlsnVerifiedData` back through `requests/domain`
  — the round-trip `docs/architecture.md:138-141` forbids. The arch-lint E026
  exception whitelists the `requests/domain → proofs` edge but not the reverse.
- Remediation: import TLSN types directly from `@anchr/sdk/proofs`; delete the
  re-export block; update the two proofs/adapters call sites.
- Verify: `deno task lint:arch`;
  `grep -rn "from .*requests/domain/types" packages/sdk/src/proofs` returns
  nothing.

#### ARCH-05 — Documented "no package depends on examples" rule unenforced by arch-lint

- Severity: **low**
- Files: `docs/architecture.md:183-189`; `scripts/arch-lint.ts:96-116,336-353`
- Evidence: `resolvePackageDep` maps a relative import to a package only when
  the first segment is `packages`; a `packages/` file importing
  `../../../examples/foo.ts` resolves to `null` and is skipped, so E017/E025
  never fire. No tracked package currently imports examples (latent gap).
- Remediation: flag any `packages/` file whose resolved relative target's
  first segment ∈ {examples, e2e, scripts}.
- Verify: a scratch fixture import is flagged by `deno task lint:arch` (do not
  commit the fixture).

### 2.4 Anonymity and privacy findings (WO-3)

#### ANON-01 — Provider/Oracle cross-request linkability is real and undocumented

- Severity: **high** (class c + b)
- Files: `packages/sdk/src/provider.ts:199-201,226`;
  `packages/protocol/src/events.ts:160-180`;
  `packages/sdk/src/adapters/nostr/hash-responder.ts:22-23`;
  `docs/threat-model.md:178-199` (INV-07 is Customer-only)
- Evidence: a Provider signs every offer/result/selection under one stable
  key for its whole lifecycle; the Oracle requires a stable advertised pubkey
  (kind 5300 `p`-tag, kind 30088 registry). INV-07 protects only the Customer.
  No invariant or prose covers Provider/Oracle linkability.
- Why it matters: a passive relay observer clusters all of a Provider's
  activity and links each request to its Oracle. A reader of "requests are
  unlinkable" may wrongly assume the whole exchange is unlinkable.
- Remediation: document the accepted design limit — add `INV-09`
  (Provider/Oracle identities are intentionally stable/linkable) with a test,
  or an "Actor linkability" subsection stating INV-07 covers only the Customer.
- Verify: `deno task lint:invariants`; `deno task test:unit`.

#### ANON-02 — Cashu mint and Blossom HTTP have no SOCKS5/Tor routability in the SDK

- Severity: **high** (class c + partial a)
- Files: `packages/sdk/src/payments/cashu/cashu-wallet.ts:36-40`;
  `packages/sdk/src/attachments/blossom.ts:147-154,193`;
  `crates/tlsn-prover/src/main.rs:57-59,82-88`;
  `crates/tlsn-server/src/main.rs:377-381`
- Evidence: Blossom upload/download and all `@cashu/cashu-ts` mint swaps use
  the global `fetch` with no proxy/dispatcher hook. The only SOCKS5 support
  that landed is in the TLSN crates (`--socks-proxy`, `SOCKS_PROXY`). The SDK
  has zero `socks`/`SOCKS_PROXY` references. The INV-08 test stubs the
  CashuClient, so the real mint round-trip is out of scope.
- Why it matters: in any real deployment the Customer/Provider IPs are exposed
  to the mint at lock/redeem and to Blossom at upload/download — the
  deanonymization channels Tor would close. The mint can correlate lock↔redeem
  to network identities despite blind-signed ecash.
- Remediation: document that INV-08's relay-only guarantee does NOT cover the
  mint/Blossom HTTP touchpoints; add an injectable `fetchImpl`/dispatcher to
  the Blossom helpers and Cashu wallet construction (mirroring
  `createHttpOracleClient`'s existing `fetchImpl`); note
  `tlsn-prover --socks-proxy` as the supported Tor path for the target.
- Verify: `grep -rn "fetchImpl|dispatcher" packages/sdk/src/attachments
  packages/sdk/src/payments/cashu` shows injectable transport.

#### ANON-03 — `expires_at` leaks millisecond wall-clock precision in the public kind 5300 event

- Severity: **medium** (class a)
- Files: `packages/sdk/src/customer.ts:315`;
  `packages/protocol/src/events.ts:90-92`; `specs/messaging.md:94`
- Evidence: `expires_at: clock.now() + offerWindowMs` is published as a
  millisecond value while every `created_at` is floored to whole seconds. An
  observer who knows the (public default) window recovers the millisecond
  publish time as `expires_at − offerWindowMs`.
- Why it matters: a sub-second publish timestamp is a strong cross-request
  correlation/clock-skew fingerprint that partially undermines INV-07.
- Remediation: publish `expires_at` at second granularity; lock with a test
  asserting `expires_at % 1000 === 0` (and update `specs/messaging.md`).
- Verify: `deno task test:unit`; `deno task lint:strict`.

#### ANON-04 — INV-08 test proves "no HTTP injected", not "no HTTP endpoint"

- Severity: **medium** (class b)
- Files: `e2e/protocol/anonymous-relay-flow.test.ts:62-153`;
  `docs/threat-model.md:200-223`
- Evidence: the test asserts the exchange completes over the in-memory relay
  but never asserts `fetch`/`globalThis.fetch` was uncalled. A future code
  path adding an HTTP call would still pass.
- Remediation: install a `globalThis.fetch` spy (restored in `finally`) and
  assert zero calls during the exchange.
- Verify: `deno task test:e2e:protocol`; `deno task lint:invariants`.

#### ANON-05 — `region` tag is a cleartext indexable anonymity-set reducer, underdocumented

- Severity: **low** (class c)
- Files: `packages/protocol/src/events.ts:83-85`; `specs/messaging.md:72-77`
- Evidence: a supplied `regionCode` publishes an uppercase indexable
  `#region` tag on the otherwise-ephemeral kind 5300 event. The spec documents
  optional content-hiding but not the anonymity-set cost of the tag itself.
- Remediation: add one sentence to `specs/messaging.md` and the SDK
  `regionCode` docs noting the cleartext, indexable region reduces the
  anonymity set; recommend omitting it when unlinkability is the priority.
- Verify: `deno task lint:strict`.

### 2.5 Protocol and settlement findings (WO-4)

The first three findings concern the publicly-exported relay Oracle service
(`createOracleNostrService`). It is exported from `@anchr/sdk/adapters/nostr`
but no example or e2e flow wires it; the canonical Provider/Customer path does
not use it. They are real defects in a shipped public surface, and they
compound (SPEC-01, SPEC-03 below describe the same path).

#### PROT-01 — Relay Oracle delivers the preimage to any submitter when the selected-Provider binding is unset

- Severity: **high**
- Files: `packages/sdk/src/adapters/nostr/oracle-service.ts:139-145,168-229,236-269`;
  `packages/sdk/src/adapters/nostr/oracle-handlers.ts:56-74`
- Evidence: the gate `if (entry.selectedProviderPubkey && event.pubkey !==
  entry.selectedProviderPubkey) { return; }` is skipped when
  `selectedProviderPubkey` is falsy. It is set only by the public
  `recordSelectedProvider(...)`; no relay handler auto-records it from the
  Customer selection event. On a passing result the preimage DM goes to
  `event.pubkey` (the submitter) and the store entry is deleted.
- Why it matters: a deployment that does not manually call
  `recordSelectedProvider` serves the preimage to the first Provider to post a
  result, and deletes it — so the legitimately selected Provider never gets it
  and cannot redeem before locktime. INV-04 still blocks the wrong submitter
  from spending the bound token, so this is denial-of-settlement / fund
  stranding, not theft.
- Remediation: make the gate fail closed (`if (!entry.selectedProviderPubkey
  || event.pubkey !== entry.selectedProviderPubkey) return;`) and/or subscribe
  the Customer selection event and auto-record. Lock with a test asserting no
  preimage DM when the selected provider is unrecorded.
- Verify: `deno task test:unit` (new `oracle-service.test.ts` case).

#### PROT-02 — Relay Oracle re-verifies against a hardcoded synthetic requirement, ignoring the real query/schema

- Severity: **high** (merge of WO-4 PROT-02 + WO-5 SPEC-02)
- Files: `packages/sdk/src/adapters/nostr/oracle-handlers.ts:23-38` (verified);
  consumed at `packages/sdk/src/adapters/nostr/oracle-service.ts:154,174`
- Evidence: `buildQueryFromPayload` returns
  `verification_requirements: ["gps","ai_check"]` with empty
  `description`/`challenge_rule`, `expires_at: Date.now()+600_000`, and no
  `tlsn_requirements`/`expected_gps`/`max_gps_distance_km`. The release
  decision verifies against this stub, and the payload `schema` is never
  consulted to dispatch a verifier (contradicting `specs/proof-schemas.md:60-71`).
- Why it matters: the payment-release check runs against a fabricated
  requirement that omits the Customer's real constraints. A TLSN request
  routed through this Oracle is verified as GPS+ai_check; a Provider can
  satisfy the watered-down check without satisfying the real request.
- Remediation: carry the real `Query` (its requirements, `tlsn_requirements`,
  GPS policy, `challenge_rule`, `quorum`, `visibility`) into the watched entry
  and verify against it; dispatch the verifier by the payload `schema`.
- Verify: `deno task test:unit` (TLSN-required + no presentation → no preimage).

#### PROT-03 — FROST-mode `bindProvider` strands the customer refund (empty refund key + hardcoded locktime)

- Severity: **high**
- Files: `packages/sdk/src/payments/cashu/frost-escrow-provider.ts:31-45,90-97`
- Evidence: `buildFrostP2PKOptions(provider_pubkey, config.groupPubkey, "",
  locktimeSeconds)` passes an empty `customerRefundPubkey` and a hardcoded
  `now + 3600` locktime, and `.addRefundPubkey("")` / `.requireRefundSignatures(1)`
  run unconditionally.
- Why it matters: the 2-of-2 P2PK(Provider, group) escrow's only timeout
  escape is the refund key. With an empty refund pubkey no key can refund, so
  if the FROST group never releases, the Customer's funds are permanently
  stranded. The hardcoded locktime also ignores the request's real
  locktime/expiry.
- Remediation: thread the real customer refund pubkey and request locktime
  into `bindProvider`; reject binding when the refund key is empty. Lock with
  a test decoding the bound token and asserting a non-empty refund tag.
- Verify: `deno task test:unit` (new `frost-escrow-provider.test.ts` case).

#### PROT-04 — No safe-margin coupling between offer/expiry window and mint locktime

- Severity: **medium**
- Files: `packages/sdk/src/customer.ts:48,51,297-305,315,376-383`;
  `packages/sdk/src/requests/domain/value-objects.ts:9`
- Evidence: `locktimeSeconds` and `offerWindowMs`/`expires_at` derive from
  independent defaults; `validateEscrowLocktime` only enforces
  `locktime - now ≥ 600s`. Nothing enforces
  `locktime > expires_at + verification + redeem margin`.
- Why it matters: if locktime elapses before the Provider verifies + receives
  the preimage + redeems, a redeem-vs-refund race over the same token opens
  (first mint swap wins).
- Remediation: validate `locktimeSeconds*1000 ≥ offerWindowMs +
  verificationBudgetMs + redeemMarginMs` with named constants; document the
  ordering in `specs/paid-request-exchange.md`. Lock with a test.
- Verify: `deno task test:unit` (too-short locktime → `CustomerConfigError`).

#### PROT-05 — FROST signing message is bound only to `query_id`

- Severity: **medium**
- Files: `packages/sdk/src/payments/frost/frost-signature-adapter.ts:27-29`;
  `packages/sdk/src/adapters/nostr/oracle-service.ts:313-315`
- Evidence: both sites sign `sha256("anchr:sign:" + query.id)` — excluding
  `request_event_id`, the selected Provider, the escrow token, and the result
  hash.
- Why it matters: the group signature attests only "query_id X approved"; it
  is not bound to the specific escrow/Provider and lacks domain separation
  from other `anchr:sign:` uses. Latent today (no SDK path consumes the group
  signature as a P2PK witness — see PROT-06).
- Remediation: include `request_event_id`, the selected Provider pubkey, and a
  token commitment in the signed preimage; have each peer re-derive and check.
- Verify: `deno task test:e2e:frost`; a unit test on message derivation.

#### PROT-06 — FROST P2PK settlement is incomplete: the group signature is delivered but never applied to redeem

- Severity: **medium** (class b)
- Files: `packages/sdk/src/adapters/nostr/oracle-service.ts:338-345`;
  `packages/sdk/src/requests/application/escrow-flow-methods.ts:276-292`;
  no redeemer found
- Evidence: there is no function that applies a FROST `group_signature` +
  Provider key as the 2-of-2 P2PK witness; `frost-escrow-provider.settle()`
  returns `{settled:false}`. `requests/domain/types.ts:228-245` documents
  `p2pk_frost` as a settlement variant.
- Why it matters: funds locked under FROST escrow are unspendable through the
  SDK; combined with PROT-03 they would be permanently stranded.
- Remediation: implement the Provider FROST redeem, or remove the
  `p2pk_frost`/FROST escrow surface from v0 and document FROST as
  release-authority research only. Lock the chosen direction with a test.
- Verify: `deno task test:e2e:frost` (if implemented) or `deno task lint:strict`
  (after removal).

#### PROT-07 — Mint redeem swap has no idempotency guard — a timed-out-but-committed swap burns the token

- Severity: **high** (merge of WO-4 PROT-07 + WO-6 OPS-03)
- Files: `packages/sdk/src/payments/cashu/cashu-escrow-helpers.ts:34-73`;
  `packages/sdk/src/payments/cashu/cashu-escrow.ts:299-341`;
  `packages/sdk/src/adapters/cashu.ts:406-419`
- Evidence: `redeemHtlcToken`/`redeemHtlc` run `wallet.ops.send(...).run()`
  with a 30s `Promise.race` timeout that rejects without aborting the in-flight
  HTTP request and with no `checkProofsStates`/restore/retry. cashu-ts uses
  fresh random blinding per call, so a retry mints different outputs.
- Why it matters: if the mint processed the swap but the response was lost,
  the input HTLC proofs are spent while the SDK returned `null`/threw — the
  redeemed value is unrecoverable (token burned). Direct fund loss on the
  success-but-timeout path; this is the work order's "a network error must not
  burn a token".
- Remediation: before re-swapping, call `wallet.checkProofsStates(...)`; if
  inputs are `SPENT`, recover the outputs (persisted/seeded) rather than
  re-blinding; surface a distinct "uncertain — check mint" error instead of a
  flat `null`.
- Verify: `deno task test:e2e:regtest` with an interrupted-swap case.

#### PROT-08 — `frost-signer.ts` shares one `pendingNonces`, unsafe under concurrent signing sessions

- Severity: **medium**
- Files: `packages/sdk/src/payments/frost/frost-signer.ts:104-106,180,188-201`
- Evidence: `let pendingNonces: string | undefined;` is a single
  per-instance variable; round 1 sets it, round 2 reads-then-clears it, with no
  per-session keying.
- Why it matters: a signer in two overlapping sessions has its first session's
  nonces overwritten; round 2 then signs with the wrong nonces, or a nonce is
  reused across messages — which leaks the signing share's secret in
  Schnorr/FROST.
- Remediation: key pending nonces by session id
  (`Map<sessionId, nonces>`), generate-once-consume-once, refuse round 2
  without a matching session nonce. Lock with an interleaved-session test.
- Verify: `deno task test:unit` (new `frost-signer.test.ts` interleaving test).

#### PROT-09 — `cashu-escrow-provider.bindProvider` silently defaults locktime/refund when the tag is unreadable

- Severity: **low**
- Files: `packages/sdk/src/payments/cashu/cashu-escrow-provider.ts:53-66`
- Evidence: on an unparseable source secret, `locktime` defaults to
  `now + 3600` and `customerPubkey` defaults to `""` inside a swallowed
  `try/catch`, decoupling the bound escrow from the Customer's intended
  locktime/refund (same stranding class as PROT-03, lower likelihood).
- Remediation: fail closed — return `null` when locktime/refund cannot be read
  from the source token. Lock with a test.
- Verify: `deno task test:unit` (new `cashu-escrow-provider.test.ts` case).

#### PROT-10 — Coordinator `tryAggregate` is called with an empty pubkey package; session GET is a dead lookup

- Severity: **low** (fails closed)
- Files: `packages/sdk/src/adapters/oracle-service/frost-sign-routes.ts:87,107`;
  `packages/sdk/src/payments/frost/frost-coordinator.ts:193-224`;
  `crates/frost-signer/src/main.rs:317-319`
- Evidence: the HTTP shares route calls `tryAggregate(session_id)` with no
  pubkey package (becomes `""`), so the Rust `aggregate` fails parsing; and
  `GET /frost/sign/:queryId` looks up sessions by `queryId` while they are
  stored by `session_id`, so it always 404s.
- Why it matters: the coordinator-side HTTP aggregation path cannot produce a
  signature (no fund loss; fails closed), but the documented surface is
  non-functional and can mask the working DM-coordinator path during
  integration.
- Remediation: pass the real pubkey package to `tryAggregate`; resolve the GET
  by `queryId` via `querySessionMap`. Lock with a route-level test.
- Verify: `deno task test:integration` (coordinator-route test).

### 2.6 Spec ↔ implementation conformance findings (WO-5)

#### SPEC-01 — Relay Oracle parses a non-canonical `oracle_payload` shape the Provider never produces

- Severity: **blocker**
- Files: `packages/sdk/src/adapters/nostr/events/events.ts:42-64` (verified);
  `packages/sdk/src/adapters/nostr/oracle-handlers.ts:76-81`;
  canonical builder `packages/protocol/src/events.ts:337-384`;
  canonical parser `packages/protocol/src/events.ts:429-469`;
  spec `specs/messaging.md:185-197`
- Evidence: the canonical Oracle-readable payload is
  `{schema, data, proof, query_id, request_event_id}`. The relay Oracle
  instead decodes `{nonce_echo, attachments[], notes}` via
  `parseOracleResponsePayload` (`JSON.parse(decrypted) as OracleResponsePayload`
  — no field validation). The two share only the `oracle_payload` tag name.
  The canonical `parseOracleQueryResponseEvent` (which validates) is never
  called by the Oracle service. No test wires `buildQueryResponseEvent` →
  `createOracleNostrService`.
- Why it matters: a spec-conforming Provider talking to the SDK's own relay
  Oracle produces a payload read as `nonce_echo=undefined`,
  `attachments=[]`, `notes=undefined` — a silent interop break in the headline
  Oracle path. Compounds PROT-02 (the verified requirement is also synthetic).
- Remediation: replace `parseOracleResponsePayload` with the canonical
  `parseOracleQueryResponseEvent`; map its fields into the `Query`/`QueryResult`
  the verifier needs; delete `OracleResponsePayload`/`parseOracleResponsePayload`.
  Add an integration test running a real `buildQueryResponseEvent` through the
  Oracle service and asserting release.
- Verify: `deno task test:unit` + a new `*.integration.test.ts`;
  `deno task lint:strict`.

#### SPEC-03 — `parseOracleResponsePayload` / `parseOracleDM` cast decrypted JSON with no boundary validation

- Severity: **medium**
- Files: `packages/sdk/src/adapters/nostr/events/events.ts:54-64` (verified);
  `packages/sdk/src/adapters/nostr/events/dm.ts:117-128`
- Evidence: `return JSON.parse(decrypted) as OracleResponsePayload;` and
  `return JSON.parse(decrypted) as OracleDMPayload;` — neither validates the
  discriminant or required fields, unlike every `@anchr/protocol` parser
  (which returns `null` on bad shape).
- Why it matters: an adversarial relay message flows into lifecycle/release
  code as a structurally-trusted object.
- Remediation: validate the discriminant + required fields before returning;
  return `null`/throw on mismatch. If SPEC-01 deletes
  `parseOracleResponsePayload`, harden `parseOracleDM` (preimage/rejection/
  frost_signature discriminants).
- Verify: `deno task test:unit` (malformed-JSON cases).

#### SPEC-04 — `s`-tag vs content `schema` disagreement rule is unenforced

- Severity: **medium**
- Files: `specs/proof-schemas.md:80-83`; `specs/messaging.md:13-18`;
  `packages/protocol/src/events.ts:106-148`
- Evidence: the spec says implementations MUST use the content over the public
  `s` tag on disagreement, but `parseQueryRequestEvent` reads only
  `event.content` and never the `s` tag — no reference behaviour/test exists.
- Remediation: add a parser/test asserting content-wins on disagreement, or
  soften the spec to note the kind-5300 case has no encrypted body. Lock with a
  test.
- Verify: `deno task lint:strict`.

#### SPEC-05 — Code-only event kind 30103 (Oracle Attestation) is undocumented in any spec

- Severity: **medium**
- Files: `packages/protocol/src/nostr.ts:35`;
  `packages/sdk/src/adapters/nostr/events/oracle-attestation.ts:1-92`
- Evidence: a full event shape (kind 30103, tags + plaintext JSON payload)
  with builder, parser, and tests exists and is exported, but
  `grep -rn '30103|attestation' specs/` returns nothing.
- Why it matters: a v0 wire kind with no spec — an independent implementer
  cannot interoperate with public attestations.
- Remediation: document kind 30103 in `specs/messaging.md` (payload/tags/
  rejection semantics), or, if it is SDK-local policy, state that in the spec
  and move the kind out of `@anchr/protocol`.
- Verify: `grep -rn 30103 specs/`; `deno task lint:strict`.

#### SPEC-06 — Offer parser does not bind the offer to the request `e`-tag or customer `p`-tag

- Severity: **medium**
- Files: `packages/protocol/src/events.ts:166-170,183-208`;
  `specs/messaging.md:105-118`
- Evidence: `buildOfferFeedbackEvent` emits `["e", requestEventId, "",
  "request"]` and `["p", customerPubkey]`, but `parseOfferFeedbackEvent`
  validates only `status`/`provider_pubkey`/`amount_sats` and
  `provider_pubkey === event.pubkey` — never the request/customer link.
  Binding is left to the subscription filter.
- Remediation: add an optional request/customer cross-check to the parser, or
  document that offer binding is the subscriber's responsibility and lock the
  current behaviour with a test.
- Verify: `deno task lint:strict`.

#### SPEC-07 — No wire-contract version marker in the v0 protocol

- Severity: **medium**
- Files: `packages/protocol/src/events.ts`, `nostr.ts`; specs have no version
  field
- Evidence: events carry no protocol-version field; schema URLs version proof
  formats (`/v1`) but not the exchange/messaging wire contract. The unrelated
  `encryption.ts:8 PROTOCOL_VERSION` is only for region-key derivation.
- Why it matters: when a v1 wire profile lands, deployed v0 actors have no
  field to detect/reject incompatible peers.
- Remediation: add an indexable `["v","0"]` tag to kinds 5300/6300/7000 in the
  four protocol builders and a non-fatal version check in each parser
  (unknown major → `null`); document the rejection semantics. Lock with a
  round-trip test.
- Verify: `deno task lint:strict`.

#### SPEC-08 — Cashu token serialization version is unspecified

- Severity: **low**
- Files: `packages/sdk/src/payments/cashu/cashu-escrow-helpers.ts:30-32`;
  `specs/paid-request-exchange.md:66-85`
- Evidence: `encodeProofs` calls `getEncodedToken` with no explicit version,
  so the serialization (V3 `cashuA` vs V4 `cashuB`) is the cashu-ts default;
  the spec never pins it.
- Remediation: pin the serialization version explicitly and state the chosen
  token format + NUT-10/11/14 references in `paid-request-exchange.md`.
- Verify: `deno task test:unit` (regtest covers redeem under Docker).

#### SPEC-09 — `locktime_seconds` means "absolute Unix seconds" on the wire but "offset from now" in the public type

- Severity: **low**
- Files: `specs/messaging.md:156`; `packages/protocol/src/events.ts:57`;
  `packages/protocol/src/types.ts:15-19`; `packages/sdk/src/customer.ts:297-298`
- Evidence: the wire/exec field is absolute Unix seconds, but
  `Payment.locktimeSeconds` is documented as "seconds from now". Functionally
  consistent (the SDK adds `now`) but the identical name carries two meanings
  across the public boundary.
- Remediation: rename the public field to `locktimeOffsetSeconds` (pre-1.0,
  delete the old name) or document the distinction prominently. Lock with a
  test asserting `wire == now + offset`.
- Verify: `deno task lint:strict`; new customer unit test.

#### SPEC-10 — Spec completeness gaps for an independent implementer

- Severity: **low**
- Files: `specs/messaging.md`, `specs/paid-request-exchange.md`,
  `specs/proof-schemas.md:8-12`
- Evidence: rejection semantics (parse-failure → ignore) and event ordering
  (selection-after-offer, result-after-selection) are implemented but never
  stated normatively; the schema-identifier namespace has no documented
  reservation/deprecation process. (NIP-44 per-kind boundaries ARE specified
  and conformant — see §7.)
- Remediation: add a "Rejection and ordering" section to `messaging.md` and a
  "Schema namespace & deprecation" note to `proof-schemas.md`.
- Verify: `deno task lint:strict`.

Re-verification of `docs/protocol-conformance-audit.md`: its "no
protocol-conformance follow-up remains open" conclusion is **superseded** by
SPEC-01 and PROT-02 — its mapping-table granularity treated the divergent
`oracle_payload` reader and the missing schema dispatch as a single implemented
contract. The oracle-registry (kind 30088) and proof-schema-identifier rows
re-verify as conformant.

### 2.7 Operations and CI/publish findings (WO-6)

#### OPS-01 — `ANCHR_LOG_LEVEL`/`LOG_LEVEL` is dead and the SDK is silent by default

- Severity: **high** (class b)
- Files: `packages/sdk/src/internal/runtime/logger.ts:1-43` (verified)
- Evidence: `getLogger` only calls `ltGetLogger(category)` and emits; there is
  no `configure()`/sink registration anywhere, and `ANCHR_LOG_LEVEL`/`LOG_LEVEL`
  appear nowhere in `packages/`/`scripts/`/`examples/`. The header comment
  references a non-existent `src/infrastructure/logger.ts`. logTape with no
  `configure()` emits nothing by default.
- Why it matters: a standalone `@anchr/sdk` consumer gets no logs at all, and
  the env var advertised by CLAUDE.md and §1 does nothing — operators cannot
  get production-debuggable settlement/verification output.
- Remediation: add an idempotent `configure()`/`configureSync()` registering a
  console sink and reading the level from
  `Deno.env.get("ANCHR_LOG_LEVEL") ?? Deno.env.get("LOG_LEVEL")` (default
  `"info"`); lock with a test that the env var changes emitted output. Or, if
  configuration is intentionally the host's job, delete the env-var claim from
  CLAUDE.md and §1 and document the required host `configure()` call.
- Verify: `ANCHR_LOG_LEVEL=debug deno test` on a new logger test;
  `grep -rn ANCHR_LOG_LEVEL packages/sdk/src` returns a real consumer.

#### OPS-02 — Routine success/lifecycle events are logged at `error` level

- Severity: **medium**
- Files: `packages/sdk/src/adapters/nostr/oracle-service.ts:192-193,226,306`;
  `packages/sdk/src/payments/cashu/cashu-wallet.ts:173-175`
- Evidence: `grep -rhoE 'log\.(debug|info|warn|error|fatal)\(' packages/sdk/src`
  (non-test) → 62 `log.error(` vs 4 `log.info(` / 1 `log.warn(`. Success paths
  (preimage delivered, token verified UNSPENT, rejection sent) use
  `log.error`.
- Why it matters: production error-rate dashboards and alerting are meaningless
  when every happy-path settlement logs as an error.
- Remediation: reclassify — success/lifecycle → `info`, recoverable → `warn`,
  genuine failures → `error`.
- Verify: `grep -rc 'log.error(' packages/sdk/src --include='*.ts'` drops;
  manual read confirms ERROR is failure-only.

#### OPS-04 — Relay client has no reconnect/resubscribe/missed-event recovery

- Severity: **medium**
- Files: `packages/sdk/src/adapters/nostr/client.ts:57-97`
- Evidence: `createRelayClient` wraps `SimplePool.subscribe(...)` and returns
  `{ close }` with no backoff, no `since`-cursor resubscribe, and no gap
  recovery; subscriptions use point-in-time filters never re-issued with a
  watermark.
- Why it matters: on a relay drop/reconnect, offers/results/DMs published
  during the disconnect window can be silently missed, timing a request out as
  "no offers"/"no result". Compounds OPS-09 (relay scales to zero).
- Remediation: track each subscription's last-seen `created_at` and re-issue
  the filter with `since` on reconnect, or document reliance on relay-side
  replay and require replaying relays. Lock with a relay e2e dropping/restoring
  the connection mid-window.
- Verify: `deno task test:e2e:relay`.

#### OPS-05 — Unbounded process-global state in the long-running Oracle; the query sweep never runs

- Severity: **high**
- Files: `packages/sdk/src/proofs/tlsn-validation.ts:30,337`;
  `packages/sdk/src/payments/frost/frost-coordinator.ts:70-72,88,176-177`;
  `packages/sdk/src/internal/runtime/config.ts:52`;
  `packages/sdk/src/requests/application/query-service.ts:197-198`
- Evidence: `seenPresentations` (TLSN replay set) is module-global with only a
  test-only clear; the FROST coordinator's `dkgSessions`/`signingSessions`/
  `querySessionMap` are only `.set()` (no `delete`/`clear`); `watched` entries
  (2 relay subscriptions each) are never removed per-query; `querySweepIntervalMs`
  is read into config but has no consumer, and `expireQueries`/
  `purgeExpiredFromStore` have no caller — no `setInterval` sweep exists.
- Why it matters: an always-on Oracle accumulates one replay-hash per TLSN
  proof, one FROST session, and one `watched` entry + 2 live subscriptions per
  request forever, and never expires queries despite a config knob implying it
  does — a memory/FD leak and slow-DoS in exactly the always-on design target.
- Remediation: bound `seenPresentations` (TTL/LRU or persistent store with
  eviction); remove FROST sessions after aggregation/abort; remove+`.close()`
  `watched` entries at terminal state; wire a `setInterval(querySweepIntervalMs)`
  to `expireQueries`/`purgeExpiredFromStore` (clean up on `stop()`), or delete
  the dead surface and document host responsibility.
- Verify: eviction unit tests;
  `grep -n 'delete|clear' packages/sdk/src/payments/frost/frost-coordinator.ts`;
  `grep -rn querySweepIntervalMs packages/sdk/src` shows a consumer.

#### OPS-06 — JSR publish ships 58 `*.test.ts` files inside `@anchr/sdk`

- Severity: **medium**
- Files: `packages/sdk/deno.json:43-70`
- Evidence: the only test exclusion is `src/*.test.ts` (top-level);
  `deno publish --dry-run` lists ~58 nested `*.test.ts` modules
  (`adapters/cashu.test.ts`, `payments/cashu/redeem-htlc.test.ts`, …).
  `@anchr/protocol` ships 0 test files.
- Why it matters: the published artifact carries test scaffolding and risks
  leaking test-only dev imports into the dependency graph.
- Remediation: add `src/**/*.test.ts` and `src/**/*.integration.test.ts` to
  `publish.exclude`; re-run the dry-run to confirm zero test files.
- Verify: `deno publish --dry-run --allow-dirty --config packages/sdk/deno.json
  2>&1 | grep -cE '\.test\.ts'` → 0.

#### OPS-07 — License metadata gaps: no `license` field in JSR configs; crates declare none

- Severity: **medium**
- Files: `packages/protocol/deno.json`, `packages/sdk/deno.json` (no
  `license`); `crates/*/Cargo.toml` (no `license`)
- Evidence: `grep -c '"license"' packages/*/deno.json` → 0/0; no `license`
  line in any `crates/*/Cargo.toml`. Root `LICENSE` is MIT; `specs/LICENSE` is
  CC0; `packages/sdk/package.json` declares MIT.
- Why it matters: published JSR packages carry no SPDX identifier; crates with
  no license cannot be published and give downstream no signal.
- Remediation: add `"license": "MIT"` to both `deno.json` files and
  `license = "MIT"` to each `Cargo.toml`; keep `specs/` CC0.
- Verify: `grep -c '"license"' packages/*/deno.json` ≥ 1 each;
  `grep -c '^license' crates/*/Cargo.toml` ≥ 1 each.

#### OPS-09 — Production deploy uses a floating `:latest` relay image and scales the relay to zero

- Severity: **medium**
- Files: `fly.relay.toml:5,17-19`; `.github/workflows/deploy.yml:31-46`
- Evidence: `image = "scsibug/nostr-rs-relay:latest"`;
  `auto_stop_machines = "stop"`, `min_machines_running = 0`.
- Why it matters: `:latest` makes the production relay non-reproducible and
  silently mutable; scale-to-zero drops live subscriptions between requests
  and, with OPS-04, raises the chance of dropped offers/results/DMs on the sole
  inter-actor transport (INV-08).
- Remediation: pin the relay image to a digest/version; set
  `min_machines_running = 1` if always-on transport is required, else document
  the scale-to-zero trade-off and require a replaying relay.
- Verify: `grep image fly.relay.toml` shows a pinned tag/digest.

#### OPS-10 — Localhost SSRF guard keys off Node's `NODE_ENV` (insecure default in Deno) and misses IPv6 loopback

- Severity: **medium**
- Files: `packages/sdk/src/attachments/url-validation.ts:89-109`;
  `packages/sdk/src/attachments/access.ts:138-145`
- Evidence: `const isProduction = Deno.env.get("NODE_ENV") === "production";`
  gates the localhost-rejection, but `NODE_ENV` is non-idiomatic and usually
  unset in Deno, so the guard is **off by default**. `isLocalhost` covers only
  `localhost`/`127.0.0.1`, not `[::1]`/`::ffff:127.0.0.1` (despite the file
  header claiming IPv6-mapped coverage). `access.ts` falls back to a
  `http://localhost:<port>` public URL when no base URL is configured.
- Why it matters: an attacker-supplied attachment URL pointing at loopback
  co-located services is accepted unless an operator happens to set
  `NODE_ENV=production`.
- Remediation: gate on a Deno-native signal (e.g. an explicit `ANCHR_ENV` or
  default-secure unless a dev flag is set); extend `isLocalhost` to `[::1]` and
  `::ffff:127.0.0.1`; in `access.ts` throw/warn loudly when no public base URL
  is configured. Lock with tests. (Full SSRF analysis belongs to WO-3/WO-4;
  recorded here as a config-default issue.)
- Verify: `deno test packages/sdk/src/attachments/url-validation.test.ts`
  (unset env + loopback IPv6 cases).

#### OPS-11 — No signal-driven graceful shutdown / health surface for the relay-DM Oracle

- Severity: **low**
- Files: `packages/sdk/src/adapters/nostr/oracle-service.ts:359-368`;
  `packages/sdk/src/adapters/oracle-service/server.ts:70`
- Evidence: `createOracleNostrService(...).stop()` closes subscriptions but
  does not drain in-flight verifications or flush stores, and nothing wires it
  to `SIGTERM`/`SIGINT` (`grep addSignalListener|SIGTERM packages/sdk/src` →
  none). `/health` exists only on the optional HTTP oracle, not the default
  relay-DM Oracle.
- Remediation: add opt-in `addSignalListener("SIGTERM", () => service.stop())`
  wiring and a minimal status surface, or document that graceful shutdown +
  health checks are the host's responsibility (call `stop()` on SIGTERM).
- Verify: Oracle bootstrap doc read; a SIGTERM→`stop()` test if implemented.

## 3. Deep-audit work orders (executed 2026-06-11)

All six work orders ran as read-only audits and appended their findings to
Section 2 (prefixes SDK / ARCH / ANON / PROT / SPEC / OPS). Their "Checked, OK"
lists are merged into Section 7. The original work-order briefs are retained in
git history; their scope is fully reflected in the appended findings.

- **WO-1 SDK public interface** → SDK-01…SDK-07.
- **WO-2 Directory architecture** → ARCH-01…ARCH-05 (ARCH-01 merged with the
  WO-6 Rust-gate finding).
- **WO-3 Anonymity and privacy** → ANON-01…ANON-05.
- **WO-4 Protocol and settlement safety** → PROT-01…PROT-10 (PROT-02 merged
  with WO-5 SPEC-02; PROT-07 merged with WO-6 OPS-03).
- **WO-5 Spec ↔ implementation conformance** → SPEC-01, SPEC-03…SPEC-10
  (SPEC-02 folded into PROT-02).
- **WO-6 Production operations readiness** → OPS-01…OPS-11 (OPS-03 folded into
  PROT-07; OPS-08 folded into ARCH-01).

## 4. Finding schema

Every appended finding uses:

```
### <PREFIX>-NN — <title>
- Severity: blocker | high | medium | low
- Files: <repo-relative paths with line numbers>
- Evidence: <short verbatim quotes actually read>
- Why it matters: <concrete production risk / attack or loss scenario>
- Remediation: <exact change: what, where, how>
- Verify: <deno task / command that proves the fix>
```

Rules: no speculation — unverified suspicions go in §6 "needs dynamic
verification" with the exact experiment; every audited area that turned out
fine goes in §7 "Checked, OK".

## 5. State

State as of 2026-06-11.

- Section 2 governance findings (F-01…F-08) are each marked with a verified
  resolution status. F-01…F-06 are resolved; F-07 is standing guidance; F-08 is
  resolved for `spec-site/`/`tools/types/` and extended by ARCH-02/ARCH-03.
- All six work orders are executed; Section 2 holds their code-level findings.
  Coverage status is **complete**.
- No code under `packages/`/`crates/` has been modified by this audit pass
  except the issue-0115 C2PA work recorded under F-02. The remaining
  blocker/high findings (SPEC-01, PROT-01, PROT-02, PROT-03, PROT-07, ANON-01,
  ANON-02, OPS-01, OPS-05, ARCH-01, SDK-01) are remediation work, not yet
  applied — see Section 8.

## 6. Needs dynamic verification

Each item below is statically suspected but should be confirmed by the exact
experiment, without committing scratch fixtures.

1. **PROT-01 live impact** — run `createOracleNostrService` against an
   in-memory relay, post a kind-6300 result from a non-selected Provider
   without calling `recordSelectedProvider`, and observe whether a preimage DM
   is published to the submitter and the store entry deleted.
2. **PROT-07 / OPS-03 token burn** — inject a `CashuWalletAdapter` whose
   `ops.send(...).run()` resolves the mint-side state change but rejects the
   returned promise; confirm `redeemHtlc`/`redeemHtlcToken` cannot recover the
   outputs on retry (regtest).
3. **PROT-08 nonce reuse** — drive `createFrostSigner` through interleaved
   sessions (round1_A, round1_B, round2_A, round2_B) and inspect whether
   round2_A signs with B's nonces.
4. **OPS-04 missed-event recovery** — open the offer-window subscription,
   restart the Dockerised relay mid-window, publish a kind-7000 offer during
   the outage, restore, and assert whether the offer is delivered before the
   window closes.
5. **SPEC-01 end-to-end** — run a real `buildQueryResponseEvent` through
   `createOracleNostrService` on an in-memory relay and assert whether a
   preimage DM is ever delivered (expected: verification runs over an empty
   submission and no preimage releases).

## 7. Coverage appendix ("Checked, OK")

Areas audited that were verified correct:

- **Protocol/SDK export maps vs publish allowlists** — both packages' exports
  map to present files; `requests/**` and `internal/runtime/**` ship as
  transitive deps, not public subpaths; no dead allowlist entries.
  `@anchr/protocol` ships zero test files.
- **E023 in examples** — `examples/quick-start` and
  `examples/paid-request-simulation` import only `@anchr/*`.
- **Role naming** — public surface uses Customer/Provider/Oracle only; no
  market/bet/buyer/seller vocabulary. Discriminable named error subclasses
  across customer/provider/oracle/cashu/protocol.
- **`lint:arch`/`lint:strict`/`lint:invariants` pass.** `ALLOWED_PACKAGE_DEPS`
  matches the documented graph (protocol → {}, sdk → {protocol}).
- **INV-07 test strength** — `customer.test.ts` asserts distinct event pubkeys
  and `customer_pubkey` payloads across sequential requests; the hash-bootstrap
  and BUD-02 upload auth each use a fresh ephemeral key.
- **NIP-44 per-kind boundaries** — kind 5300 signed-JSON with a parser that
  rejects payment fields; kind-7000 selection, kind-6300 content +
  `oracle_payload`, and kind-4 DMs all NIP-44 v2; tests assert the public body
  omits the bound token/preimage.
- **Schema identifiers match exactly** across `specs/proof-schemas.md`,
  `packages/protocol/src/schema.ts`, and the SDK; `isSchemaUri` enforces the
  documented URL shape both directions.
- **Settlement decision rules** — INV-04 redeem paths run a local NUT-14
  spend-auth + hashlock check before the mint swap; quorum counting requires
  `passCount ≥ min_approvals` with no empty-array success; preimage reveal is
  gated on `passed` and deletes on reveal; state transitions are absorbing at
  terminal status (no double settlement in the lifecycle layer); cancel/expire
  do not touch an already-bound mint token. Preimage entropy is 32-byte CSPRNG,
  SHA-256, hex, atomic-file store; the preimage travels only in NIP-44 DMs.
- **`settle()` stubs** in both escrow providers return explicit
  `{settled:false, error}` (loud failure, not a silent `settled:true`).
- **Rust FROST CLI** — aggregation/verification delegate to
  `frost-secp256k1-tr` (below-threshold yields `Err`); DKG/round-1 use a
  CSPRNG; no share/secret material is logged or returned.
- **CI/publish/deploy/supply-chain workflows** — `ci.yml` gates match the local
  bar (typecheck, `publish:dry-run`, SDK npm build, `test:all`,
  `test:all:docker`), unit/integration are separated, all five e2e buckets run,
  `cargo audit` covers all four crates with scoped ignores; `publish.yml` is
  manual with a shared verify gate and JSR/npm provenance; `deploy*.yml` gate
  on CI success. `cargo audit` (`lint:deps`) is wired into `test:all`.
- **Runtime robustness that is correct** — preimage delivery retries with
  bounded backoff and retains the preimage on total failure (fund-safe);
  `waitForFirstEvent` cleans up its subscription and timer; the customer
  offer-window timer is in `try/finally`; the persistent preimage store writes
  atomically (temp + rename); the customer request publish throws
  `RelayPublishError` when no relay accepts. No hardcoded production mint/relay
  URLs on production paths.
- **`docs/resilience-checklist.md`** is a pointer/review document; its
  referenced surfaces all exist and its verification commands map to real deno
  tasks.

## 8. Prioritised remediation backlog

Order for a remediation pass (file each via `make-issues`):

1. **Blocker / high — relay Oracle correctness** (one cluster): SPEC-01
   (non-canonical `oracle_payload`), PROT-02 (synthetic hardcoded
   requirement), PROT-01 (unbound preimage delivery), SPEC-03 (unvalidated
   decrypt). These four share `createOracleNostrService` and should be fixed
   or the surface explicitly removed from v0 together.
2. **High — fund safety:** PROT-03 (FROST empty refund key), PROT-07/OPS-03
   (redeem token-burn idempotency).
3. **High — operations:** OPS-01 (dead logger), OPS-05 (unbounded Oracle
   state), ARCH-01 (no Rust gate).
4. **High — privacy disclosure:** ANON-01 (Provider/Oracle linkability doc),
   ANON-02 (mint/Blossom IP exposure doc + transport hook).
5. **High — public surface:** SDK-01 (request-type leak) before the API is
   frozen.
6. **Medium / low:** the remaining SDK / ARCH / ANON / PROT / SPEC / OPS
   findings, batched by area.

Final gate after remediation, from a clean worktree: `deno task test:all`,
`deno task test:all:docker`, `deno task publish:dry-run`,
`git status --short` clean.
