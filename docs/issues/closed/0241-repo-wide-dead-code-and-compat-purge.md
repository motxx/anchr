# Purge dead code and backward-compat remnants repo-wide

Created: 2026-07-04
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Sweep the entire repository for dead code and backward-compatibility
remnants and delete them outright, per the pre-1.0 versioning policy
(no deprecation shims, no legacy aliases, no compat re-exports). This is
a tracking issue: the resolver re-reads the current tree, builds the
concrete deletion list, and either resolves directly or splits it with
`make-issues` first if one coherent verified change would be too large.

In scope:

- Unreferenced exports, functions, types, and modules under
  `packages/protocol/src/`, `packages/sdk/src/`, `scripts/`, `e2e/`,
  and `examples/`.
- Re-exports, aliases, or wrapper functions whose only purpose is to
  keep old call sites working after a rename or move.
- Stale feature flags or env switches where only one branch is ever
  taken, and other unreachable branches.
- Orphaned test helpers and fixtures referenced by no test.
- Unused dependencies: `deno.json` import-map entries and
  `crates/*/Cargo.toml` dependencies with no remaining consumer.
- Docs and spec prose describing surfaces that no longer exist in the
  tree (per the documentation-prose policy in `CLAUDE.md`).

Out of scope (owned elsewhere — do not double-delete):

- Dead abstractions inside `requests/` (`QueryRepository`,
  `queryTemplates`, `"submitted"` status, `ProofDelivery`, duplicate
  open-status predicates) — owned by 0228.
- The production-deadness of the `requests/` Query aggregate and
  `query-service` — gated on the 0190 ownership decision; a 0190
  migration may deliberately revive them, so leave them in place.

## Rationale

- `CLAUDE.md` Versioning (pre-1.0): "Delete replaced paths outright. No
  `@deprecated`, 'legacy', or 'backward compat' shims."
- `lint:deprecation` catches explicit markers, but semantically dead
  code (exports with no importer, single-branch flags, orphaned
  fixtures, unused deps) has no automated gate today.
- The pattern recurs: 0210 (orphaned empty dirs) and 0220 (tlsn-server
  unused dependencies) each closed one instance; 0190's evidence shows
  further production-dead surfaces exist. No repo-wide sweep has run.

## Acceptance

- Every dead or compat-only surface found by the sweep is deleted, or
  kept with the reason recorded in the resolution note; deadness is
  verified against the current tree at resolution time.
- No export in `packages/` exists solely as a compatibility alias for a
  renamed or moved path.
- No `deno.json` import-map entry or crate dependency remains without a
  consumer.
- The sweep method (how deadness was established per category) is
  recorded in the resolution note, so a future sweep is repeatable.

## Verification

- `deno task test:all` passes after the deletions.
- `rg -n "backward.?compat|@deprecated|\blegacy\b" packages/ crates/ scripts/ e2e/ examples/`
  returns no matches (expected; confirms `lint:deprecation` ground truth
  after the sweep).
- For each deleted export, `rg` for its identifier across the repo
  returns no matches outside `docs/issues/` (expected).

## Plan

- Enumerate exports per module in `packages/*/src` and find importers;
  flag zero-importer exports (excluding the 0190/0228-owned set).
- Audit `deno.json` import maps and `crates/*/Cargo.toml` for unused
  dependencies (`cargo udeps` or manual `rg` per crate).
- Audit `e2e/`, `scripts/`, `examples/` for orphaned helpers/fixtures
  and single-branch flags.
- Build the deletion list; split into child issues if the verified
  change is too large; otherwise delete and run the full gate.

Completed: 2026-07-04

## Resolution

Sweep method (repeatable):

- Exports: enumerated every `export` in `packages/*/src`, classified each
  repo-wide reference (production / test / barrel re-export), and
  hand-verified every zero-production-reference candidate with `rg`
  (multi-line signatures make automated own-file counts unreliable). The
  sweep was re-run after deletion; no transitive orphans remained.
- Modules: import-graph walk with `packages`/`e2e`/`scripts`/`examples`
  as roots.
- Dependencies: per-manifest specifier search for every import-map entry;
  `cargo machete` across all four crates (clean).
- e2e/scripts/examples and docs/specs: exhaustive sweeps with per-finding
  `rg` / file-existence verification.

Deleted:

- `packages/sdk/src/proofs/proof-redaction.ts` (+ its test + barrel line)
  — self-described as not wired into the publish pipeline; zero
  production consumers; redaction is enforced at the TLSNotary prover
  level.
- `packages/sdk/src/payments/cashu/wallet-store.ts` +
  `wallet-store-helpers.ts` (+ test + barrel lines) — parallel wallet
  persistence abstraction consumed only by its own test (same class as
  0228's `QueryRepository`).
- `e2e/tlsn/tlsn-browser.test.ts` — permanently skipped: `TLSN_EXT_BUILD`
  is set nowhere and `headless: false` precludes CI; the body was
  unreachable in every automated run.
- Zero-reference symbols: `isTlsnVerifierAvailable`, `TlsnEvidence`,
  `TlsnEncryptedContext` + `isTlsnEncryptedContext`, `resetQueryCounter`,
  `publishOnce`, `readStoredAttachmentAsBase64`,
  `readStoredAttachmentBuffer`, `statStoredAttachment` (with the
  transitively orphaned `StoredAttachmentBuffer` / `StoredAttachmentStats`
  types and `readBlossomAttachment` / `readExternalAttachment` helpers).
- Own-test-only surface: `materializeResultAttachments`,
  `createMemoryPersistenceStore` (+ `MemoryPersistenceStoreOptions`).
- Import-map entries with no consumer in their scope: root `hono`,
  `nostr-tools/nip19`, `nostr-tools/nip44`, `@logtape/logtape`,
  `puppeteer`; sdk bare `@anchr/protocol`, `nostr-tools/nip19`,
  `nostr-tools/nip44`. Cargo dependencies: none unused.
- Stale doc references: `specs/oracle-registry.md` "Specs 03-04" → the
  actual spec files; `specs/README.md` dead `payments/frost-*` glob and
  the deleted credential-leakage-guard mention; `packages/sdk/README.md`
  nonexistent `cashuClient.locks`.

Kept, with reason:

- `VERIFICATION_FACTORS` and the architecture-doc meta-commentary —
  remove-vs-document decision owned by 0202/0206/0225.
- All `requests/` dead surfaces (aggregate, `query-service`, templates,
  repository, `isTerminal`, `HtlcEscrow`, `P2pkFrostEscrow`,
  `QueryServiceDeps`) — owned by 0190 and 0228.
- `createCashuEscrowProvider` / `createFrostSigner` /
  `createFrostSignatureAdapter` — production-dead factories whose
  wire-or-delete decision must align with 0190/0196 → follow-up 0242.
- `adapters/oracle-service/server-entry.ts` — documented operator process
  entrypoint (`docs/architecture.md`); its env-port routing is owned by
  0231.
- `getRuntimeConfig` / `AnchrConfigPort.runtime()` — test-only today, but
  0231's server-entry config-port routing would make them the consumer.
- INV-01 "Expected" text naming `VerifierError::…` — no such typed enum
  exists in `crates/tlsn-verifier`; correcting it belongs with 0184's
  INV-01 strengthening (threat-model lock bump required).
- `PaymentRecoveryError` — public error contract pinned by customer
  tests.
- `isC2paAvailable`, `_clearSeenPresentationsForTest`, and `testing/`
  exports — deliberate test seams and testing surface.
- `scripts/frost-dkg-bootstrap.ts` — manual operator CLI referenced by
  `payments/frost/frost-config.ts` as the setup path.
- `BYPASS_BASE` / `BYPASS_RECORD` / `ARCH_BASE` / `ARCH_RECORD` — CLI
  override knobs of the verify-hook scripts.
- `packages/protocol/src/mod.ts`, `packages/sdk/src/adapters/mod.ts`, and
  the root `@anchr/protocol` import-map entry — published package front
  doors with no in-repo bare-specifier consumer; API-shape decisions are
  owned by 0224/0225.
- `packages/sdk/src/test-helpers.ts` — shared test helper of
  `provider.test.ts` / `integration.test.ts` (placement question, not
  deadness).
- `MIN_PAYMENT_LOCK_DURATION_SECONDS` — alive: derives
  `MIN_CUSTOMER_PAYMENT_LOCK_DURATION_SECONDS`.
- `SPEC.md` convention in `docs/universality-boundaries.md` —
  forward-looking policy, not a stale claim.

Implemented by updating:

- `deno.json`, `packages/sdk/deno.json`
- `packages/sdk/src/proofs/{mod,tlsn-types,tlsn-validation}.ts`
- `packages/sdk/src/adapters/nostr/{mod,client}.ts`
- `packages/sdk/src/adapters/storage.ts` (+ `storage.test.ts`)
- `packages/sdk/src/attachments/{access,attachment-helpers,types}.ts`
  (+ `access.test.ts`)
- `packages/sdk/src/payments/cashu/mod.ts`
- `packages/sdk/src/testing/factories.ts`
- `packages/sdk/README.md`, `specs/README.md`, `specs/oracle-registry.md`
- Deleted: `packages/sdk/src/proofs/proof-redaction.{ts,test.ts}`,
  `packages/sdk/src/payments/cashu/wallet-store.ts`,
  `wallet-store-helpers.ts`, `wallet-store.test.ts`,
  `e2e/tlsn/tlsn-browser.test.ts`

Verified with:

- `deno task check`
- `deno task test:all` (lint:strict + lint:deps + unit + integration +
  e2e:protocol + scripts + examples + Rust crate gate + frost e2e) — pass
- `deno task publish:dry-run` — pass
- `/check-silent-bypass` and `/arch-lint-llm` — no findings; diff below
  the ship-gate record threshold
- `rg` per deleted identifier returns no matches outside `docs/issues/`

Harness update:

- None — dead-export deadness needs per-symbol public-API intent judgment
  a deterministic lint would false-positive on; the repeatable sweep
  method is recorded above and each recurring residue class is owned by a
  pending issue (0190, 0196, 0202, 0228, 0231, 0242).

Review residuals:

- Wire-or-delete for the payments escrow factories — pending 0242.
- INV-01 typed-error wording vs the `anyhow`-based verifier — pending
  0184.

Follow-up:

- 0242 (created by this resolution).
