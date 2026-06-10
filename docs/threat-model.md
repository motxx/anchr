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

### INV-01: Provider can't forge TLSN proofs

**Status:** `enforced`

**Claim:** The Oracle's TLSN verifier rejects any presentation whose transcript,
notary signature, or MPC-TLS MAC chain is invalid. A Provider cannot produce a
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

**Claim:** The honest Oracle/query-service wrapper never returns the Cashu HTLC
preimage unless verification passes. Protocol-layer outcome: regardless of
which cryptographic check fails (missing presentation, malformed payload, wrong
signature, expired presentation, empty Provider key), the result does not
contain `preimage`. This is an implementation invariant, not a Byzantine-oracle
guarantee: a malicious solo Oracle or a colluding FROST threshold can still
reveal an unlock secret or sign the wrong outcome outside this wrapper.

**Attack:** Submit adversarial payloads to the query result path: missing
presentation, malformed payload, invalid Provider key, oracle not yet
registered.

**Expected:** Result outcome has no `preimage` field, returns `ok: false`, and
the Oracle's preimage store is not decremented.

**Tests:**

- `e2e/protocol/paid-request-attacks.test.ts` — `preimage not leaked on rejected
  verification`.

### INV-03: Customer can't unlock escrow before timeout

**Status:** `cross-referenced`

**Claim:** Cashu HTLC proofs locked with `locktime > now` cannot be redeemed via
the Customer's refund key. Only the Provider's key + valid preimage can redeem
before locktime. The Mint enforces this, not the application layer.

**Attack:** Customer attempts to swap HTLC proofs back to themselves before
`locktime` has elapsed, presenting only their refund key.

**Expected:** Cashu Mint rejects the swap (returns `null` from `attemptRedeem`).
Funds remain locked until locktime expires.

**Tests:** Cross-referenced from existing attack-class tests, annotated with
`// INV-03` comments:

- `e2e/regtest/regtest-htlc-trustless.test.ts` —
  `ATTACK: Customer refund key
  before locktime → Mint REJECTS`
- `e2e/regtest/regtest-htlc-attacks.test.ts` —
  `ATTACK: Customer redeems own
  HTLC proofs before locktime — fails`

Related (not INV-03 but same surface, kept for context):
`LEGIT: Customer refund key after locktime → Mint ACCEPTS` demonstrates the
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
  `ATTACK: Customer redeems own HTLC proofs before locktime — fails`

## Settlement Decision Rules

The normative redeem contract lives in
[`specs/paid-request-exchange.md#release-and-redeem`](../specs/paid-request-exchange.md#release-and-redeem).
This threat model treats the settlement-decision separation as
security-sensitive because collapsing Cashu spendability, clean settlement, and
audit decisions can strand Provider funds or hide release anomalies.

The security claim is that mutable Provider policy, release-source mismatch,
signature mismatch, `query_id` mismatch, `request_event_id` mismatch, stale
reply threads, and Customer cancel races are not standalone reasons to suppress
economic redeem when the currently held Provider-bound token is spendable.
Those facts belong to clean-settlement reporting and audit. Conversely, a token
that does not match the release material, is not bound to the Provider, cannot
be signed by the Provider, or is rejected by the settlement backend is not
spendable and must not redeem.

## Future invariants (declared, not yet specified)

- **INV-05:** FROST t-of-n threshold safety — no subset of size < t can produce
  a valid aggregate signature. Likely cross-referenced to
  `e2e/frost/frost-threshold.test.ts::ATTACK: 1-of-3 (below threshold) ->
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
