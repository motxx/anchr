# Spec 04: Threshold Oracle

## Abstract

A threshold Oracle requires t-of-n independent Oracles to approve before payment is released. This eliminates single-Oracle trust. This spec defines FROST distributed key generation (DKG), threshold signing, and quorum verification.

## Quorum Config

The Requester specifies:

```
quorum: { min_approvals: t }
oracle_ids: [oracle_1, oracle_2, ..., oracle_n]
```

`min_approvals` is the threshold `t`. `oracle_ids` lists the `n` participating Oracles.

## FROST (Flexible Round-Optimized Schnorr Threshold)

FROST produces BIP-340 Schnorr signatures that are indistinguishable from single-signer signatures on-chain.

### Phase 1: Distributed Key Generation (DKG)

DKG runs once to establish a signing group. Each signer generates key shares without any party learning the group secret key.

**Rounds:**

1. **Round 1**: Each signer broadcasts a commitment (VSS polynomial commitment).
2. **Round 2**: Each signer sends secret shares to every other signer (point-to-point, NIP-44 encrypted).
3. **Round 3**: Each signer verifies received shares and computes their signing share.

**Output:**
- `group_pubkey`: BIP-340 x-only public key (used in escrow conditions)
- Each signer holds a private signing share (never leaves the signer)

### Phase 2: Threshold Signing

When a Worker submits a proof for a threshold query:

1. Each Oracle independently runs `verify(query, result)`.
2. Oracles that pass produce a FROST nonce commitment (Round 1).
3. Nonce commitments are exchanged (via coordinator or peer-to-peer).
4. Each passing Oracle produces a signature share (Round 2).
5. When `t` shares are collected, they are aggregated into a BIP-340 Schnorr group signature.
6. The group signature is delivered to the Worker.
7. Worker redeems escrow with `group_signature + Worker signature`.

### Signing Session States

```
pending --> committing --> signing --> completed
                |            |
                v            v
             failed       failed
```

| State | Description |
|-------|-------------|
| `pending` | Session created, awaiting participants |
| `committing` | Collecting nonce commitments (Round 1) |
| `signing` | Collecting signature shares (Round 2) |
| `completed` | Group signature produced |
| `failed` | Insufficient shares or timeout |

## Communication

DKG and signing messages are exchanged via Nostr NIP-44 encrypted direct messages. Message types:

### DKG Messages

| Type | Direction | Content |
|------|-----------|---------|
| `dkg_round1` | Broadcast | VSS commitment |
| `dkg_round2` | Point-to-point | Secret share (encrypted to recipient) |
| `dkg_round3` | Broadcast | Completion acknowledgment |

### Signing Messages

| Type | Direction | Content |
|------|-----------|---------|
| `sign_request` | Coordinator → signers | Query ID, message to sign |
| `nonce_commitment` | Signer → coordinator | FROST nonce commitment |
| `signature_share` | Signer → coordinator | FROST signature share |
| `aggregate_signature` | Coordinator → Worker | Final BIP-340 signature |

## Security Properties

| Property | Guarantee |
|----------|-----------|
| No single Oracle decides | Requires t signature shares |
| Byzantine tolerance | Up to n-t malicious Oracles |
| Key secrecy | No party learns the group secret key |
| Signature indistinguishability | Group signature is a standard BIP-340 Schnorr signature |
| Verification determinism | Honest Oracles always agree on the same input |

## Residual Risks

- **t colluding Oracles** can approve anything. Mitigation: increase n, diversify operators.
- **Common-mode failure**: All Oracles run the same verification code. A bug affects everyone. Mitigation: open-source, auditable code.
- **Cashu Mint trust**: The Mint is trusted for token issuance and spending condition enforcement. See Spec 02 for future mitigation (Fedimint, DLC).

## Choosing a Mode

| Scenario | Mode | Config |
|----------|------|--------|
| Trusted Oracle operator | Single | Default (no `quorum`) |
| High-value queries | 2-of-3 | `quorum: { min_approvals: 2 }` |
| Maximum security | 3-of-5 | `quorum: { min_approvals: 3 }` |

No code changes required — the Requester specifies `oracle_ids` and `quorum` at query creation time.
