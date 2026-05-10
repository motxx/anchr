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
- **Status** — `enforced` (tests live-bear) or `cross-referenced` (covered by
  existing attack-class tests, marked via `// INV-NN` comment).

An invariant without tests breaks CI. A test whose name references an invariant
not declared here also breaks CI.

When an invariant's Claim/Attack/Expected body changes, the matching entry in
`docs/threat-model.lock.json` must be updated with a fresh hash plus a
`justification` string describing the change. This is a drift guardrail: you
can't silently weaken an invariant without a PR reviewer seeing the hash bump.

## Invariants

### INV-01: Worker can't forge TLSN proofs

**Status:** `enforced`

**Claim:** The Oracle's TLSN verifier rejects any presentation whose transcript,
notary signature, or MPC-TLS MAC chain is invalid. A Worker cannot produce a
presentation for an HTTPS response they did not actually observe.

**Attack:** Generate a valid TLSN presentation, mutate a byte in the transcript
commitment / notary signature / target-host field, submit to the Oracle's
verifier.

**Expected:** Verifier returns a typed error (`VerifierError::Transcript`,
`::Signature`, or `::Server` per mutation class). Oracle does NOT release the
preimage. Oracle does NOT emit a FROST signature share.

**Tests:**

- `e2e/tlsn/tlsn.test.ts` — `INV-01: rejects a mutated TLSNotary presentation`.

### INV-02: Oracle wrapper does not release preimage when verification fails

**Status:** `enforced`

**Claim:** The honest Oracle HTTP wrapper never returns the Cashu HTLC preimage
in response to a `POST /queries/:id/result` unless verification passes.
Protocol-layer outcome: regardless of which cryptographic check fails (missing
presentation, malformed JSON, wrong signature, expired presentation, empty
worker_pubkey), the response body does not contain `preimage`. This is an
implementation invariant, not a Byzantine-oracle guarantee: a malicious solo
Oracle or a colluding FROST threshold can still reveal an unlock secret or sign
the wrong outcome outside this wrapper.

**Attack:** Submit adversarial payloads to `POST /queries/:id/result`: missing
presentation, malformed JSON, invalid worker_pubkey, oracle not yet registered.

**Expected:** HTTP response body has no `preimage` field. HTTP status rejects
(4xx) or returns `ok: false`. Oracle's preimage store is not decremented.

**Tests:**

- `e2e/pentest/oracle-attacks.test.ts` — `ORACLE-ATTACK: Preimage
  protection`
  suite (both tests).

### INV-03: Requester can't unlock escrow before timeout

**Status:** `cross-referenced`

**Claim:** Cashu HTLC proofs locked with `locktime > now` cannot be redeemed via
the Requester's refund key. Only the Worker's key + valid preimage can redeem
before locktime. The Mint enforces this, not the application layer.

**Attack:** Requester attempts to swap HTLC proofs back to themselves before
`locktime` has elapsed, presenting only their refund key.

**Expected:** Cashu Mint rejects the swap (returns `null` from `attemptRedeem`).
Funds remain locked until locktime expires.

**Tests:** Cross-referenced from existing attack-class tests, annotated with
`// INV-03` comments:

- `e2e/regtest-htlc-trustless.test.ts` —
  `ATTACK: Requester refund key
  before locktime → Mint REJECTS`
- `e2e/regtest-htlc-attacks.test.ts` —
  `ATTACK: Requester redeems own
  HTLC proofs before locktime — fails`

Related (not INV-03 but same surface, kept for context):
`LEGIT: Requester refund key after locktime → Mint ACCEPTS` demonstrates the
refund path works once locktime elapses.

### INV-04: Stolen preimage alone cannot redeem bound escrow

**Status:** `cross-referenced`

**Claim:** A Provider-bound Cashu HTLC proof cannot be redeemed with the Oracle
preimage alone. The redeeming party must also satisfy the bound Provider P2PK
lock with the selected Provider's signature.

**Attack:** Learn or steal the Oracle preimage for an active Provider-bound
escrow, then attempt to redeem the token with a different private key or with no
Provider signature.

**Expected:** The Cashu Mint rejects the swap. Funds stay locked for the
selected Provider until they present both the matching preimage and the bound
Provider signature, or for the Customer refund path after locktime.

**Tests:** Cross-referenced from existing attack-class tests, annotated with
`// INV-04` comments:

- `e2e/regtest/regtest-htlc-attacks.test.ts` —
  `ATTACK: Requester redeems own HTLC proofs before locktime — fails`

## Settlement Decision Rules

Provider-side settlement separates three decisions:

- **Mint-level redeem:** a hard gate that checks token spendability only. The
  Provider can redeem when the bound token's hashlock matches the released
  preimage, the token is locked to the Provider pubkey, the Provider can sign,
  and the mint accepts the swap.
- **Clean settlement:** a protocol-quality decision. The release material must
  come from the expected Oracle pubkey or FROST group key and its signature must
  bind the payment hash, Provider pubkey, `query_id`, and `request_event_id`.
- **Audit / reputation:** anomaly recording for release source mismatch,
  signature mismatch, `query_id` mismatch, `request_event_id` mismatch, stale
  reply threads, short locktime, or implementation drift.

The Provider redeem gate MUST NOT re-run mutable Provider policy after a
preflight ticket has accepted an escrow. Redeem is governed by token
spendability plus the immutable preflight ticket fields: token fingerprint,
payment hash, Provider pubkey lock, accepted amount, mint URL, locktime, and
expected authority. Policy changes after `produce()` starts can affect future
quotes, clean-settlement reporting, or reputation, but they must not block
recovery of funds from an already spendable token.

Unexpected release material is not a clean valid release. However, if the
material unlocks the currently held bound token and the Provider can satisfy the
Provider signature requirement, the Provider SDK should attempt the economic
redeem and record the mismatch as audit evidence instead of treating it as a
redeem failure.

Oracle release depends on proof validity and expected authority, not on a host,
coordinator, or Customer cancel flag observed after the proof has verified. A
cancel race after valid proof submission can affect Customer UX and audit state,
but it must not suppress release of material needed for a Provider to redeem
valid completed work.

## Future invariants (declared, not yet specified)

- **INV-05:** FROST t-of-n threshold safety — no subset of size < t can produce
  a valid aggregate signature. Likely cross-referenced to
  `e2e/frost-threshold.test.ts::ATTACK: 1-of-3 (below threshold) ->
  aggregation fails`
  once declared.
- **INV-06:** C2PA manifest signature + GPS binding. Scoped after `crates/` gets
  a C2PA verifier.

---

## Trust surface: Proof publication

Proof publication (visibility `"public"`) is implemented and irreversible (Nostr
events cannot be deleted). Risks to other use cases:

| Risk                                          | Severity | Trigger                                         | Mitigation                                           |
| --------------------------------------------- | -------- | ----------------------------------------------- | ---------------------------------------------------- |
| Accidental publication (Nostr is append-only) | High     | Developer misconfiguration                      | `visibility` is a required parameter with no default |
| Metadata correlation                          | Medium   | Same Oracle handles public + private proofs     | Separate Oracle keys per use case                    |
| Tor anonymity breach                          | Medium   | Same node does Tor traffic + Nostr publish      | Node isolation or Tor-routed Nostr relay             |
| Default-change pressure                       | Medium   | Future protocol updates                         | `visibility` must never have a default value         |
| Query content inference                       | Low      | Oracle specialization revealed by public proofs | Oracle separation                                    |

## Trust surface: Mint layer

| Option          | Trust level                        | Anchr fit                            | Cost            |
| --------------- | ---------------------------------- | ------------------------------------ | --------------- |
| Cashu (current) | Single Mint trust                  | High (existing impl)                 | 0               |
| Fedimint        | Federated Mint (threshold signing) | High (EscrowProvider ready)          | ~10 person-days |
| DLC             | No Mint (2-of-2 multisig)          | Low (incompatible with pool betting) | ~50 person-days |

DLC removes Mint trust entirely but conflicts with Anchr's pool-based betting
model: DLC requires pairwise contracts (not many-to-many pools), pre-enumerated
outcomes (limiting Anchr's arbitrary-URL market creation), and TLSNotary-to-DLC
attestation conversion is an open research problem. Better suited as a future
"high-value market" option.
