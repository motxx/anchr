# Spec 00: Protocol Overview

## Abstract

Anchr atomically exchanges cryptographic proofs for Bitcoin payments. Data is not released until verified. Payment is not released until proof is accepted. No single party can cheat.

## Roles

| Role | Responsibility |
|------|---------------|
| **Requester** | Posts a query with a bounty. Defines what data is needed and how much to pay. |
| **Worker** | Fulfills the query by producing a cryptographic proof (TLSNotary, C2PA, etc.). |
| **Oracle** | Verifies the proof independently. Controls payment release. |

No role can unilaterally cheat:

- **Requester** cannot revoke payment after work begins (sats are locked in escrow).
- **Worker** cannot forge proofs (verification is cryptographic).
- **Oracle** cannot steal funds (escrow requires Worker's signature to redeem).

## Agnostic Design

The protocol separates concerns into pluggable layers. Each layer has a current implementation but the protocol does not depend on it.

| Layer | Role | Interface |
|-------|------|-----------|
| Payment | Escrow + atomic settlement | `EscrowProvider` |
| Web Verification | Prove HTTPS responses | `verify()` |
| Photo Verification | Prove real-world captures | `verify()` |
| Messaging | Broadcast queries, deliver results | Nostr DVM (NIP-90) |
| Storage | Store encrypted blobs | Blossom (BUD-01~06) |
| Threshold Signing | Multi-Oracle consensus | FROST (BIP-340 Schnorr) |

Adding a new provider (e.g., replacing Cashu with Fedimint, or TLSNotary with another zkTLS) means implementing an adapter — not changing the protocol.

## Security Properties

1. **Atomicity**: Proof and payment are exchanged in a single atomic step. Either both succeed or neither does.
2. **Non-repudiation**: Once the Worker produces a valid proof, the Oracle cannot deny it (especially with proof publication — see Spec 03).
3. **Timeout safety**: If no valid proof is submitted before locktime, escrow refunds to the Requester automatically.
4. **Cryptographic determinism**: Given the same proof and conditions, any honest Oracle produces the same result for cryptographic checks (`tlsn`, `gps`, `nonce`, `timestamp`, `oracle`). Advisory factors (`ai_check`) are non-deterministic and produce warnings rather than hard failures — see Spec 03.

## Protocol Flow (Summary)

```
Requester                Oracle              Worker              Target
    |                      |                   |                   |
    |-- get hash --------->|                   |                   |
    |-- lock escrow ------>|                   |                   |
    |-- post query (Nostr) ---------------------------------------->
    |                      |                   |                   |
    |                      |   discover query  |                   |
    |                      |<-- submit quote --|                   |
    |-- select worker ---->|------------------>|                   |
    |                      |                   |-- TLS/photo ----->|
    |                      |                   |<-- response ------|
    |                      |<-- submit proof --|                   |
    |                      |-- verify -------->|                   |
    |                      |                   |                   |
    |              [pass]  |-- reveal preimage |                   |
    |                      |------------------>|                   |
    |                      |                   |-- redeem escrow   |
    |                      |                   |                   |
    |              [fail]  |  withhold preimage|                   |
    |              [timeout] escrow refunds to Requester           |
```

See Spec 01 for the full state machine and Spec 02 for escrow details.
