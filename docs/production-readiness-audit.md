# Production Readiness Audit and Remediation Plan

Maintainer-facing working document. Not part of the public product surface.

- Date: 2026-06-10
- Method: direct review of `docs/architecture.md`, `docs/threat-model.md`,
  `docs/issues/pending/`, repository layout, `deno.json` task wiring, tracked
  vs. untracked file state (`git ls-files`), and `.github/workflows/` listing.
- Coverage status: **interim**. Section 2 contains findings verified against
  the repository. Section 3 contains six deep-audit work orders that have NOT
  been executed yet; each one is a self-contained instruction block for an
  audit agent and is expected to append findings to Section 2 using the schema
  in Section 4.

## 1. Executor contract

Any agent acting on this document MUST obey the repository rules. Violating
them produces changes that the lint gates will reject:

1. **Deno only.** `deno task <name>`, `deno test`, `deno run`. Never
   `npm`/`yarn`/`pnpm`/`vitest`/`jest`/`ts-node`.
2. **Type bar.** No `as`, no `any` anywhere under `packages/`. Narrow with
   type predicates. `unknown` only at boundaries (HTTP body, `JSON.parse`,
   `catch (err)`).
3. **No `console.*` in `packages/`** (rule E021). Use the existing logger;
   level comes from `ANCHR_LOG_LEVEL` / `LOG_LEVEL`.
4. **Pre-1.0 replacement policy.** Delete replaced paths outright. No
   `@deprecated`, no "legacy"/"backward compat" shims. Lock new behaviour with
   a test (`lint:deprecation` enforces this).
5. **Test placement.** Unit `*.test.ts` next to source; integration
   `*.integration.test.ts` next to source; e2e under `e2e/<bucket>/` where
   bucket ∈ {protocol, relay, regtest, frost, tlsn}. No `deno.json` edits to
   register tests.
6. **Examples import only `@anchr/*`** (rule E023). Application vocabulary
   (market, marketplace, bet, …) is forbidden in `packages/` (rule E022).
7. **Verification bar.** A change is done only after
   `deno task test:all` and, for relay/regtest/tlsn-affecting changes,
   `deno task test:all:docker` pass. Never skip, weaken, or `--no-check` a
   failing test — fix the implementation.
8. **Threat-model drift guard.** Any change to an invariant's
   Claim/Attack/Expected body requires a matching hash + `justification`
   update in `docs/threat-model.lock.json`.
9. **Repo skills.** After touching verification, settlement, redemption,
   escrow, or quorum code, run the `check-silent-bypass` skill. After
   structural refactors, run `arch-lint-llm`. New work items go through
   `make-issues` / `make-sub-issues`.
10. **Verify before fixing.** Re-read the cited files before editing; this
    document records state as of 2026-06-10 and the repository may have moved.

## 2. Verified findings

Severity scale: `blocker` = must be resolved before any production/public
release; `high` = security or correctness risk; `medium` = robustness,
interop, or documentation-accuracy risk; `low` = polish.

### F-01 — INV-05 (FROST threshold safety) is declared but not specified or enforced

- Severity: **blocker**
- Files: `docs/threat-model.md` ("Future invariants" section),
  `docs/threat-model.lock.json`, `e2e/frost/frost-threshold.test.ts`,
  `crates/frost-signer/`
- Evidence: threat-model.md states: *"INV-05: FROST t-of-n threshold safety —
  no subset of size < t can produce a valid aggregate signature. Likely
  cross-referenced to `e2e/frost/frost-threshold.test.ts::ATTACK: 1-of-3
  (below threshold) -> aggregation fails` once declared."* The invariant has
  no Claim/Attack/Expected/Tests entry, so `lint:invariants` does not protect
  it.
- Why it matters: FROST is the release-authority mechanism. A production
  deployment that relies on threshold signing has no CI-enforced guarantee
  that the below-threshold attack stays rejected across refactors.
- Remediation: promote INV-05 to a full invariant entry (Claim / Attack /
  Expected / Tests / Status) in `docs/threat-model.md`; add the matching
  entry to `docs/threat-model.lock.json`; confirm the referenced frost test
  exists and asserts below-threshold aggregation failure; annotate or add the
  test so `lint:invariants` binds both directions. Also cover: share-handling
  and nonce-reuse behaviour in `crates/frost-signer` (see work order WO-4).
- Verify: `deno task lint:invariants` (via `deno task lint:strict`), then
  `deno task test:e2e:frost`.

### F-02 — INV-06 (C2PA manifest signature + GPS binding) is declared with no implementation path

- Severity: **high** — **decision recorded 2026-06-10: remove from v0**
- Files: `docs/threat-model.md` ("Future invariants"), `crates/`
- Evidence: *"INV-06: C2PA manifest signature + GPS binding. Scoped after
  `crates/` gets a C2PA verifier."* No C2PA verifier crate exists under
  `crates/` (only `frost-signer`, `tlsn-prover`, `tlsn-server`,
  `tlsn-verifier`).
- Why it matters: if any public claim, spec, or proof-schema identifier
  references C2PA/GPS verification, it is currently unbacked. If none does,
  the dangling declaration misleads readers about the v0 surface.
- Remediation (per recorded decision — do not re-open the choice): delete the
  INV-06 entry from `docs/threat-model.md` (and its lock entry if one exists
  in `docs/threat-model.lock.json`); confirm no C2PA/GPS proof schema is
  advertised in v0 — check `specs/proof-schemas.md`, the `packages/protocol`
  schemas module, the SDK proof dispatch, and README claims; then file one
  post-v0 tracking issue via the `make-issues` skill ("Add C2PA manifest +
  GPS binding verifier and specify INV-06") so the deferral is not lost.
- Verify: `grep -ri c2pa specs/ packages/ docs/` returns only intentional
  references; `deno task lint:invariants` passes.

### F-03 — INV-03 / INV-04 (HTLC locktime and bound-escrow safety) rely on cross-referenced annotations only

- Severity: **medium**
- Files: `docs/threat-model.md` (INV-03, INV-04),
  `e2e/regtest/regtest-htlc-trustless.test.ts`,
  `e2e/regtest/regtest-htlc-attacks.test.ts`
- Evidence: both invariants carry `Status: cross-referenced` — they are
  enforced via `// INV-03` / `// INV-04` comments on existing attack-class
  tests rather than dedicated tests. INV-04's only citation is a test named
  for the INV-03 scenario (`ATTACK: Customer redeems own HTLC proofs before
  locktime — fails`), which does not obviously exercise the stolen-preimage +
  wrong-key redemption path described by INV-04's Attack.
- Why it matters: the mint-enforced HTLC properties are the economic core.
  A cross-reference that drifts (test renamed, scenario narrowed) silently
  weakens coverage; INV-04 in particular may not be tested as written.
- Remediation: add a dedicated INV-04 test that obtains the real preimage and
  attempts redemption (i) with a non-Provider key and (ii) with no Provider
  signature, asserting mint rejection in both cases. Upgrade INV-03/INV-04 to
  `enforced` with direct test references.
- Verify: `deno task test:e2e:regtest` (Docker-backed), `deno task
  lint:invariants`.

### F-04 — Oracle trust assumption must be explicit in user-facing claims

- Severity: **high** (documentation correctness)
- Files: `docs/threat-model.md` (INV-02), root `README.md`, package READMEs
- Evidence: INV-02 explicitly limits itself: *"This is an implementation
  invariant, not a Byzantine-oracle guarantee: a malicious solo Oracle or a
  colluding FROST threshold can still reveal an unlock secret or sign the
  wrong outcome outside this wrapper."* Likewise the "Trust surface: Mint
  layer" table records single-mint trust for Cashu.
- Why it matters: production users must not read "Oracle verifies and
  releases payment" as trustlessness. The two residual trust roots (Oracle
  honesty up to the FROST threshold; single Cashu mint solvency/honesty) are
  the headline risk disclosures for any production deployment.
- Remediation: ensure the root `README.md` and `packages/sdk` README state
  both trust assumptions in a dedicated "Trust assumptions" section that maps
  to INV-02 and the mint-layer table (the claim↔invariant mapping is already
  CI-enforced by `lint:invariants`; this finding is about prose presence and
  prominence, not the mapping mechanism). If the READMEs already contain
  this, close the finding with a pointer.
- Verify: manual read of READMEs; `deno task lint:invariants`.

### F-05 — Stale application vocabulary ("pool-based betting model", "market creation") in the threat model

- Severity: **medium**
- Files: `docs/threat-model.md`, final "Trust surface: Mint layer" paragraph
- Evidence: *"DLC removes Mint trust entirely but conflicts with Anchr's
  pool-based betting model: DLC requires pairwise contracts (not many-to-many
  pools), pre-enumerated outcomes (limiting Anchr's arbitrary-URL market
  creation)…"*
- Why it matters: `docs/architecture.md` §Naming forbids market/bet
  vocabulary as core repository vocabulary, and the documentation policy
  requires live docs to describe only the current target contract. Issue
  0090 (vocabulary cleanup) is closed, yet this paragraph still frames Anchr
  as a betting/market product — wrong first impression for a public release
  and contradictory to the architecture doc.
- Remediation: rewrite the DLC row rationale in protocol-neutral terms
  (e.g. "DLC requires pairwise contracts and pre-enumerated outcomes, which
  conflicts with Anchr's many-to-many paid-request model and arbitrary-URL
  verification targets") or move the comparison to an ADR if it meets the ADR
  bar. Update `docs/threat-model.lock.json` only if an invariant body
  changes (this paragraph is outside the invariant entries).
- Verify: `grep -nE 'betting|market' docs/threat-model.md` returns nothing
  unintended; `deno task lint:strict`.

### F-06 — Remaining release work is exactly issues 0085 → 0080, and both are unblocked

- Severity: **blocker** (it is the release gate itself)
- Files: `docs/issues/pending/0085-finalize-public-repository-layout.md`,
  `docs/issues/pending/0080-prepare-public-release-cleanup.md`,
  `docs/issues/closed/`
- Evidence: all listed dependencies of both issues (0082, 0083, 0084, 0086,
  0087, 0088, 0089, 0090, 0097, 0098, 0099, 0102) are present in
  `docs/issues/closed/` (verified by listing). 0085 blocks 0080; nothing
  blocks 0085.
- Why it matters: these two issues encode the agreed definition of
  "ready for public presentation". Their acceptance bullets are the
  authoritative remaining checklist: final layout pass, README→SDK/protocol
  navigation, maintainer-queue labelling, `deno task publish:dry-run`, full
  local + Docker verification from a clean worktree.
- Remediation: execute 0085 per its own Plan section, then close 0080 after
  confirming every acceptance bullet (use the `resolve-issues` skill, which
  also moves the files to `docs/issues/closed/` with a resolution note).
  Fold the deep-audit results from Section 3 into this pass where they
  overlap (stale references, README navigation).
- Verify: `deno task test:all`, `deno task test:all:docker`,
  `deno task publish:dry-run`, `git status --short` clean.

### F-07 — Untracked local directories must not be mistaken for repo content

- Severity: **low** (executor guardrail)
- Files/dirs: `dist/`, `mobile/`, `packages/sdk/dist/`,
  `packages/sdk/node_modules/`, `packages/sdk/types/`, `e2e/web/`,
  `e2e/pentest/`, `.local/`, `.frost/`, `.gstack/`, `.direnv/`
- Evidence: `git ls-files` shows **0 tracked files** in each of `dist/`,
  `mobile/`, `packages/sdk/dist/`, `packages/sdk/node_modules/`,
  `packages/sdk/types/`, `e2e/web/`, `e2e/pentest/`. The documented e2e
  buckets in `deno.json` are exactly
  `test:e2e:{frost,protocol,regtest,relay,tlsn}`, matching CLAUDE.md; no
  task references `e2e/web` or `e2e/pentest`.
- Why it matters: a remediation agent scanning the working tree could waste
  effort "cleaning up" or, worse, deleting local artifacts (e.g. someone's
  local pentest scratch space) that are not part of the repository.
- Remediation: none required in-repo. Executors: scope all cleanup work to
  `git ls-files` output. Optionally confirm each of the above paths is
  covered by `.gitignore` so they can never be committed accidentally.
- Verify: `git ls-files <dir>` empty; `git check-ignore -v <dir>` resolves.

### F-08 — `spec-site/` and deploy workflows are live surfaces that the 0085 layout pass must classify

- Severity: **medium**
- Files: `spec-site/` (5 tracked files), `.github/workflows/`
  (`ci.yml`, `publish.yml`, `supply-chain.yml`, `deploy.yml`,
  `deploy-proof-schema-site.yml`, `claude.yml`, `claude-code-review.yml`)
- Evidence: `git ls-files spec-site` → 5 tracked files;
  `deploy-proof-schema-site.yml` exists, implying a published schema site.
  `tools/` has exactly 1 tracked file (`tools/types/`). Neither `spec-site/`
  nor `tools/` is described in `docs/architecture.md`'s component table or
  CLAUDE.md's layout section.
- Why it matters: issue 0085 requires every top-level directory to have a
  clear current responsibility or be removed, and public docs/specs to be
  reachable from the README. Two tracked-but-undocumented top-level
  directories fail that bar; CI/deploy workflows must also match the gates
  the repo claims (CLAUDE.md verification bar) — unaudited as of this
  document (see WO-6).
- Remediation (decision recorded 2026-06-10: keep and document): add a
  one-sentence owner responsibility for `spec-site/` and `tools/types/` to
  the `docs/architecture.md` component table (`spec-site/` is live — it is
  deployed by `deploy-proof-schema-site.yml`). Exception: if WO-2 finds
  `tools/types/` referenced by no task, workflow, or code, delete it instead
  of documenting it. WO-6 audits the workflow files' content.
- Verify: `docs/architecture.md` component table covers every tracked
  top-level directory; `deno task lint:arch`.

## 3. Deep-audit work orders (not yet executed)

Each work order below is self-contained: run it as a read-only audit, then
append findings to Section 2 using the Section 4 schema with the given ID
prefix. Common rules for every work order: **read-only** (no file mutations,
no Docker tasks, no state-changing commands); report only findings verified
by reading the actual code, with file:line evidence; include a "Checked, OK"
list so coverage is provable; distinguish (a) implementation bugs,
(b) documented-but-untested claims, (c) inherent design limits that need
documentation rather than code.

### WO-1 — SDK public interface (`SDK-NN`)

Compare the real export surface of `@anchr/sdk` / `@anchr/protocol`
(`packages/*/deno.json` exports + publish allowlist, root modules, every
public subpath listed in `docs/architecture.md` §Public Subpaths) against the
documented policy. Flag: policy violations, `requests/` internals leaking
publicly, missing exports needed for documented flows, dead exports. Audit
API ergonomics (Customer/Provider/Oracle naming only; close/dispose on every
long-lived object; subscription and timer cleanup), public-boundary type
safety (no `as`/`any`; discriminable error types; throw-vs-result
consistency), the minimal setup path via `examples/quick-start` and
`examples/paid-request-simulation` (E023: `@anchr/*` imports only; note that
the required `visibility` parameter having no default is intentional — do not
flag), publish config vs export map, and whether `@anchr/sdk/testing`
suffices to test an integration without real relays/mints.

### WO-2 — Directory architecture conformance (`ARCH-NN`)

Verify every tracked top-level directory against `docs/architecture.md`'s
component table and dependency rules. Read `scripts/arch-lint.ts` and confirm
the allowed-package-deps map matches the documented graph (protocol depends
on nothing; sdk → protocol only; examples/e2e/scripts → `@anchr/*` only) —
flag any documented rule the lint does not actually enforce. Check
single-purpose violations inside `packages/sdk/src/` (second-owner facades,
cross-feature barrels, `requests/` imports that are not request-scoped
lifecycle state per the ownership table). Determine how `crates/*` are
built, tested, and gated: are cargo build/test/clippy wired into
`deno task test:all`, `test:all:docker`, or CI? Flag absent Rust gates.
Grep docs/specs/READMEs for references to paths or package names that no
longer exist.

### WO-3 — Anonymity and privacy (`ANON-NN`)

Verify INV-07/INV-08 test strength (do
`packages/sdk/src/customer.test.ts` and
`e2e/protocol/anonymous-relay-flow.test.ts` assert what the threat model
claims?). Audit: ephemeral key lifecycle (generation entropy, reuse,
zeroization) for all three roles — Customer unlinkability is INV-07; decide
whether Provider/Oracle cross-request linkability is accepted design (then
document it) or a gap (then propose a new INV); wire-metadata leaks
(created_at precision, tags, filters, reply threads, cleartext amounts/mint
URLs — check each kind in `specs/messaging.md` against the protocol
builders' NIP-44 boundaries); every non-relay network touchpoint (Cashu mint
HTTP, Blossom upload/download, optional oracle HTTP, TLSN target
connections) for IP exposure and SOCKS5/Tor routability — check what of the
Tor SOCKS5 work landed in `crates/` and the SDK; mint-side correlation
inherent to single-mint HTLC (document if inherent); BUD-02 upload auth key
linkability in attachments; logger output of pubkeys/preimages/tokens at
default levels. Propose new INV entries for anonymity properties that are
claimed but untested.

### WO-4 — Protocol and settlement safety (`PROT-NN`)

Walk the Query lifecycle (`packages/sdk/src/requests/`: hold → bind → lock
verification → settle/cancel/expire/refund) hunting fund-stranding states,
double settlement, settlement before lock verification, and
application-expiry vs mint-locktime mismatches (same source value? safe
margins?). Verify the code matches `docs/threat-model.md` §Settlement
Decision Rules (cancel races and policy/audit mismatches must NOT suppress
redeem of a spendable Provider-bound token; non-spendable tokens must never
redeem). Trace preimage handling on ALL paths (INV-02 tests cover some):
generation entropy, storage, NIP-44 encryption in transit, release binding to
`query_id`/`request_event_id`/selected Provider (replay across requests must
fail). Check the Cashu HTLC adapter against NUT-10/11/14 semantics (hash
function, locktime, refund key, P2PK binding, n_sigs). Audit
`crates/frost-signer` (threshold enforcement, nonce reuse, share handling)
and the TS `FrostSignaturePort` checks, plus FROST-key↔oracle-registry
identity binding. Hunt silent bypasses in verification/settlement/quorum
paths (empty-array success, defaulted `ok:true`, swallowed catches,
absent-optional-disables-check), then run the `check-silent-bypass` skill's
checklist mentally over the same files. Check replay/idempotency: duplicate
offers, result resubmission, release reuse, relay redelivery. Anything
unconfirmable statically: mark "needs dynamic verification" with the exact
experiment.

### WO-5 — Spec ↔ implementation conformance (`SPEC-NN`)

Field-by-field: every kind/tag/payload in `specs/messaging.md` and
`specs/paid-request-exchange.md` vs the builders/parsers/validators in
`packages/protocol/src/` — spec-only fields, code-only fields,
encoding mismatches, skipped validations, over-strict validators. Re-verify
each finding of the earlier `docs/protocol-conformance-audit.md` against
current code: resolved / partial / open, with citations. Assess spec
completeness for an independent implementer (rejection semantics, ordering,
NIP-44 boundaries per kind, oracle-registry flow per `specs/oracle-registry.md`,
release-material format, Cashu token serialization version, locktime
semantics, schema-identifier registry process) and the wire-contract
versioning story (none documented → propose the minimal v0 version marker).
Confirm schema identifiers match exactly across `specs/proof-schemas.md`,
the protocol schemas module, and the SDK proof dispatch. Confirm protocol
validators gate every inbound event path in `packages/sdk/src/adapters/nostr/`
(no unvalidated event reaches lifecycle code).

### WO-6 — Production operations readiness (`OPS-NN`)

Read all 7 workflow files under `.github/workflows/`: do `ci.yml` gates match
the local verification bar (lint:strict, unit vs integration separation, e2e
buckets, Rust crates, Docker e2e or documented local-only)? Are deno/rust
toolchains pinned? What do `publish.yml`, `supply-chain.yml`, `deploy.yml`,
`deploy-proof-schema-site.yml` actually gate? Audit the publish pipeline
(JSR/npm target, version consistency, allowlist vs export map,
license consistency: repo license vs `specs/` CC0 vs crate licenses).
Audit runtime robustness with file:line evidence: relay reconnect/backoff/
resubscribe and missed-event recovery in the Nostr adapter; mint HTTP
timeout/retry with idempotent redeem (a network error must not burn a
token); unbounded maps/queues vs the purge lifecycle; timer cleanup;
oracle-service graceful shutdown. Check observability (lifecycle/settlement/
verification logging at production-debuggable levels without secret
leakage; long-running Oracle health surface or an explicit out-of-scope
note). Check config validation (relays, mint URLs, keys, `ANCHR_LOG_LEVEL`)
and grep `packages/` for hardcoded `localhost`/`127.0.0.1`/test-mint URLs on
production paths. Compare `docs/resilience-checklist.md` claims against
implemented/tested reality, item by item.

## 4. Finding schema

Every appended finding uses:

```
### <PREFIX>-NN — <title>
- Severity: blocker | high | medium | low
- Files: <absolute or repo-relative paths with line numbers>
- Evidence: <short verbatim quotes actually read>
- Why it matters: <concrete production risk / attack or loss scenario>
- Remediation: <exact change: what, where, how>
- Verify: <deno task / command that proves the fix>
```

Rules: no speculation — unverified suspicions go in a separate "needs
dynamic verification" list with the exact experiment to run; every audited
area that turned out fine goes in a "Checked, OK" list.

## 5. Resumption state and agent dispatch notes

State as of 2026-06-10, so a later session can resume without rediscovery.

**Completed:** Section 2 (F-01…F-08) is based on full reads of
`docs/architecture.md`, `docs/threat-model.md`,
`docs/issues/pending/0080…md`, `docs/issues/pending/0085…md`, plus these
verified facts (do not re-derive them):

- All 12 dependencies of issues 0080/0085 (0082–0084, 0086–0090, 0097–0099,
  0102) exist in `docs/issues/closed/`. Both pending issues are unblocked.
- `git ls-files` confirms 0 tracked files in `dist/`, `mobile/`,
  `packages/sdk/dist/`, `packages/sdk/node_modules/`, `packages/sdk/types/`,
  `e2e/web/`, `e2e/pentest/`; `spec-site/` has 5 tracked files; `tools/` has 1.
- `deno.json` defines exactly `test:e2e:{frost,protocol,regtest,relay,tlsn}`;
  nothing references `e2e/web` or `e2e/pentest`.
- `.github/workflows/` contains: `ci.yml`, `claude-code-review.yml`,
  `claude.yml`, `deploy-proof-schema-site.yml`, `deploy.yml`, `publish.yml`,
  `supply-chain.yml` (contents NOT yet read — that is WO-6).

**Not started:** all six work orders (WO-1…WO-6). No code under
`packages/`, `crates/`, `e2e/`, or `scripts/` has been read yet beyond
directory listings — every code-level claim in this document comes from the
governance docs, so WO findings may supersede Section 2 details.

**How to dispatch:** spawn one read-only audit agent per work order
(parallel if budget allows; otherwise sequential in the Section 6 order).
Prepend this context block to each WO text verbatim:

> You are auditing the Anchr repository at its checkout root (Deno runtime —
> never npm/node; Rust crates under `crates/`). Anchr is an SDK for verifiable
> paid requests: a Customer posts a paid request, a Provider returns work
> with proof, an Oracle verifies and releases payment. Transport: Nostr
> NIP-90-style events + NIP-44 DMs. Settlement: Cashu HTLC payment locks
> (Provider-bound P2PK + preimage; Customer refund after locktime). Release
> authority: Oracle preimage release, optionally FROST t-of-n
> (`crates/frost-signer`). Proofs: TLSNotary (`crates/tlsn-*`). Public
> packages: `@anchr/protocol` (`packages/protocol/`) and `@anchr/sdk`
> (`packages/sdk/`). Read first: `docs/architecture.md`,
> `docs/threat-model.md`, `CLAUDE.md`, and
> `docs/production-readiness-audit.md` Sections 1–5 (executor contract,
> existing findings, already-verified facts). THIS IS A READ-ONLY AUDIT:
> create/modify/delete nothing; no Docker tasks; allowed commands are
> read-only (`ls`, `find`, `git ls-files`, `git log`, `deno check`,
> `deno task lint:strict`, `deno task test:unit`). Output findings in the
> Section 4 schema with your assigned ID prefix, plus a "Checked, OK" list.

After each agent returns: append its findings to Section 2 (keep prefix
numbering), merge its "Checked, OK" list into a coverage appendix, and when
all six are done change the header's coverage status from **interim** to
**complete**.

## 6. Recommended execution order

1. **WO-4 (protocol/settlement safety)** and **WO-3 (anonymity)** first —
   their findings can invalidate release plans and are the costliest to
   discover late.
2. **WO-5 (spec conformance)** and **WO-1 (SDK interface)** next — they
   define the public contract that 0085 freezes.
3. **WO-2 (architecture)** and **WO-6 (ops/CI/publish)**.
4. Fix all `blocker`/`high` findings (F-01 immediately; F-02 per the
   recorded decision — remove INV-06 from v0; F-04 is prose work, no
   decision needed).
5. Execute issue **0085**, then **0080** (F-06), folding in F-05 and F-08.
6. Final gate from a clean worktree: `deno task test:all`,
   `deno task test:all:docker`, `deno task publish:dry-run`.
