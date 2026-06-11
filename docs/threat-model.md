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

**Status:** `enforced`

**Claim:** Cashu HTLC proofs locked with `locktime > now` cannot be redeemed via
the Customer's refund key. Only the Provider's key + valid preimage can redeem
before locktime. The Mint enforces this, not the application layer.

**Attack:** Customer attempts to swap HTLC proofs back to themselves before
`locktime` has elapsed, presenting only their refund key.

**Expected:** Cashu Mint rejects the swap (returns `null` from `attemptRedeem`).
Funds remain locked until locktime expires.

**Tests:**

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

**Status:** `enforced`

**Claim:** Anchr's Provider redemption path refuses to redeem a Provider-bound
Cashu HTLC proof with the Oracle preimage alone. Before asking the Mint to swap,
the SDK verifies that the witness also satisfies the bound Provider P2PK lock
with the selected Provider's signature.

**Attack:** Learn or steal the Oracle preimage for an active Provider-bound
escrow, then attempt to redeem through Anchr with a different private key or
with no Provider signature.

**Expected:** Anchr returns `null` before a successful redemption when the
signature is missing or does not match the Provider-bound key. The no-signature
direct Mint attack is also expected to reject; relying on Mint-specific P2PK
behavior alone is not the invariant.

**Tests:**

- `e2e/regtest/regtest-htlc-trustless.test.ts` —
  `ATTACK: Oracle has preimage but no Provider key → Mint REJECTS`
- `e2e/regtest/regtest-htlc-trustless.test.ts` —
  `redeemHtlcToken rejects Oracle's key (server-side P2PK check)`
- `e2e/regtest/regtest-htlc-trustless.test.ts` —
  `redeemHtlcToken rejects wrong Provider's key (server-side P2PK check)`
- `e2e/regtest/regtest-htlc-attacks.test.ts` —
  `ATTACK: Customer redeems own HTLC proofs before locktime — fails`

### INV-05: FROST threshold safety

**Status:** `enforced`

**Claim:** A FROST release-authority group cannot produce a valid aggregate
signature from fewer than the configured threshold number of signer shares.

**Attack:** Run a 2-of-3 DKG, generate a signing commitment and share from only
one signer, and attempt to aggregate a group signature for the release message.

**Expected:** Aggregation fails and no valid BIP-340 group signature is
produced. With any valid threshold pair, aggregation succeeds and the resulting
signature verifies against the group public key.

**Tests:**

- `e2e/frost/frost-threshold.test.ts` —
  `INV-05: ATTACK: 1-of-3 (below threshold) -> aggregation fails`

### INV-06: C2PA manifest signature binds GPS evidence

**Status:** `enforced`

**Claim:** A C2PA image proof satisfies Anchr's built-in
`c2pa-image/v1` schema only when a cryptographically verified active manifest
contains a signed EXIF GPS assertion within the request's accepted distance
from the expected location.

**Attack:** Submit an unsigned image, a C2PA image with an invalid manifest
signature, a verified C2PA manifest without GPS, or a verified manifest whose
signed GPS is outside the accepted distance window.

**Expected:** The verifier rejects the proof before release. GPS coordinates
are not trusted unless they come from the verified manifest and satisfy the
distance policy.

**Tests:**

- `packages/sdk/src/proofs/c2pa-validation.test.ts` —
  `INV-06: passes only when the verified manifest contains nearby signed GPS`
- `packages/sdk/src/proofs/c2pa-validation.test.ts` —
  `INV-06: rejects GPS when the manifest signature is invalid`
- `packages/sdk/src/proofs/c2pa-validation.test.ts` —
  `INV-06: rejects verified manifests without signed GPS`
- `packages/sdk/src/proofs/c2pa-validation.test.ts` —
  `INV-06: rejects signed GPS outside the allowed distance`
- `packages/sdk/src/proofs/verification/verifier.test.ts` —
  `INV-06: attachment with expected GPS requires C2PA-signed GPS binding`

### INV-07: Requests are unlinkable by key material

**Status:** `enforced`

**Claim:** Every `Customer.request` lifecycle signs and advertises under a
fresh ephemeral keypair. Two requests from the same Customer instance carry
distinct event pubkeys and distinct `customer_pubkey` advertisement fields, so
a relay observer cannot link them through key reuse.

**Attack:** A passive relay observer collects kind 5300 advertisements and
correlates them to one Customer via a reused signing key or a reused
`customer_pubkey` field.

**Expected:** The kind 5300 events of two sequential requests have different
`pubkey` values and different `customer_pubkey` payload fields, and each
payload's `customer_pubkey` matches its own event `pubkey`.

**Tests:**

- `packages/sdk/src/customer.test.ts` — `INV-07: two sequential requests
  publish under distinct ephemeral pubkeys`.

### INV-08: The exchange completes relay-only

**Status:** `enforced`

**Claim:** The full Customer / Provider / Oracle exchange (advertise → offer →
select → result → release → redeem) completes with relay events and NIP-44 DMs
as the only inter-actor transport. No actor is required to run or contact an
HTTP endpoint: the Oracle hash bootstrap rides the relay as NIP-44 DMs by
default (`createNostrOracleClient` / `serveHashRequests`), and HTTP oracle
access is an explicitly injected option, never the required path.

**Attack:** A deployment constraint or implementation regression forces an
actor to expose an IP-revealing network endpoint (or to reach a counterparty's
endpoint) to complete the exchange.

**Expected:** With the default relay-DM hash bootstrap and an in-memory relay,
the exchange completes end-to-end — the Provider redeems with the
relay-delivered Release Material — without any HTTP listener or HTTP request
in the flow.

**Tests:**

- `e2e/protocol/anonymous-relay-flow.test.ts` — `INV-08: full exchange
  completes relay-only with no HTTP endpoint`.

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
| DLC             | No Mint (2-of-2 multisig)          | Low (pairwise outcomes only)         | ~50 person-days |

DLC removes Mint trust entirely but conflicts with Anchr's many-to-many
paid-request model: DLC requires pairwise contracts, pre-enumerated outcomes
(limiting arbitrary-URL verification targets), and TLSNotary-to-DLC attestation
conversion is an open research problem. Better suited as a future high-value
request option.
