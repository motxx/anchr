# Threat Model

This document enumerates Anchr's cryptographic and protocol-state invariants.
Every safety claim in `README.md` must map to one of these invariants. Every
invariant must have at least one test. CI enforces both directions via
`deno task lint:invariants`.

## How this document works

Each invariant has the shape:

- **Claim** — one-line property the protocol guarantees.
- **Attack** — the adversary behavior this invariant defends against.
- **Expected** — the observable outcome when the attack is attempted.
- **Tests** — file paths + test names (or `fn` names for Rust).
- **Status** — `enforced` (tests live-bear), `tests-pending-PR-N` (declared,
  tests land in a follow-up PR), or `cross-referenced` (covered by existing
  attack-class tests, marked via `// INV-NN` comment).

An invariant without tests breaks CI. A test whose name references an
invariant not declared here also breaks CI.

When an invariant's Claim/Attack/Expected body changes, the matching entry
in `docs/threat-model.lock.json` must be updated with a fresh hash plus a
`justification` string describing the change. This is a drift guardrail:
you can't silently weaken an invariant without a PR reviewer seeing the
hash bump.

## Invariants

### INV-01: Worker can't forge TLSN proofs

**Status:** `tests-pending-PR-2`

**Claim:** The Oracle's TLSN verifier rejects any presentation whose
transcript, notary signature, or MPC-TLS MAC chain is invalid. A Worker
cannot produce a presentation for an HTTPS response they did not actually
observe.

**Attack:** Generate a valid TLSN presentation, mutate a byte in the
transcript commitment / notary signature / target-host field, submit to
the Oracle's verifier.

**Expected:** Verifier returns a typed error (`VerifierError::Transcript`,
`::Signature`, or `::Server` per mutation class). Oracle does NOT release
the preimage. Oracle does NOT emit a FROST signature share.

**Tests:** Declared here. Implementation lands in PR-2 after the
`tlsn-verifier` crate is refactored to expose a `lib.rs` + typed error
enum. Target path: `crates/tlsn-verifier/tests/invariants.rs::inv_01_*`.

**Why pending:** The `tlsn-verifier` crate is currently `[[bin]]`-only
with `anyhow::Error`. Writing `assert_matches!(err, VerifierError::Transcript)`
requires extracting a library + typed error enum, which is scoped to PR-2.

### INV-02: Oracle can't release preimage without valid proof

**Status:** `enforced`

**Claim:** The Oracle's HTTP wrapper never returns the Cashu HTLC preimage
in response to a `POST /queries/:id/result` unless verification passes.
Protocol-layer outcome: regardless of which cryptographic check fails
(missing presentation, malformed JSON, wrong signature, expired
presentation, empty worker_pubkey), the response body does not contain
`preimage`.

**Attack:** Submit adversarial payloads to `POST /queries/:id/result`:
missing presentation, malformed JSON, invalid worker_pubkey, oracle not
yet registered.

**Expected:** HTTP response body has no `preimage` field. HTTP status
rejects (4xx) or returns `ok: false`. Oracle's preimage store is not
decremented.

**Tests:**
- `e2e/pentest/oracle-attacks.test.ts` — `ORACLE-ATTACK: Preimage
  protection` suite (both tests).

### INV-03: Requester can't unlock escrow before timeout

**Status:** `cross-referenced`

**Claim:** Cashu HTLC proofs locked with `locktime > now` cannot be
redeemed via the Requester's refund key. Only the Worker's key + valid
preimage can redeem before locktime. The Mint enforces this, not the
application layer.

**Attack:** Requester attempts to swap HTLC proofs back to themselves
before `locktime` has elapsed, presenting only their refund key.

**Expected:** Cashu Mint rejects the swap (returns `null` from
`attemptRedeem`). Funds remain locked until locktime expires.

**Tests:** Cross-referenced from existing attack-class tests, annotated
with `// INV-03` comments:
- `e2e/regtest-htlc-trustless.test.ts` — `ATTACK: Requester refund key
  before locktime → Mint REJECTS`
- `e2e/regtest-htlc-attacks.test.ts` — `ATTACK: Requester redeems own
  HTLC proofs before locktime — fails`

Related (not INV-03 but same surface, kept for context):
`LEGIT: Requester refund key after locktime → Mint ACCEPTS` demonstrates
the refund path works once locktime elapses.

## Future invariants (declared, not yet specified)

- **INV-04:** FROST t-of-n threshold safety — no subset of size < t can
  produce a valid aggregate signature. Likely cross-referenced to
  `e2e/frost-threshold.test.ts::ATTACK: 1-of-3 (below threshold) →
  aggregation fails` once declared.
- **INV-05:** C2PA manifest signature + GPS binding. Scoped after
  `crates/` gets a C2PA verifier.
