# Bind FROST release signatures to oracle, request, and verdict (INV-C2)

Created: 2026-07-26
Model: Claude Opus 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0253

## Summary

FROST release material is not cryptographically bound to a verification
outcome. `packages/sdk/src/payments/frost/signing-message.ts` derives two
signing messages: `deriveFrostSigningMessage(queryId)` =
`sha256("anchr:sign:" + queryId)` and `deriveFrostP2pkMessages` =
`sha256(proof.secret)` per proof. Neither commits to the oracle group,
the proof material, or the verdict. Two frauds are therefore executable
today without leaving any cryptographic trace:

1. **Unverified release** — a colluding or compromised threshold signs the
   spend messages for a request whose verification never passed. The
   resulting signature is byte-shape-identical to an honest release; even
   the defrauded Customer cannot distinguish theft from a legitimate payout.
2. **Equivocation** — the quorum publishes a kind 30103 attestation saying
   `passed: false` while covertly producing release signatures for the
   Provider. The two artifacts never reference each other, so no
   contradiction is expressible.

Require the quorum to produce a signed verdict statement bound to
`(oracle group pubkey, query_id, proof hash, verdict)` as part of every
release, so that a false release becomes provable by re-running the
deterministic verifier, and equivocation becomes a self-contained fraud
proof (two contradictory signatures under one group key).

## Rationale

- Constraint: NUT-11 `SIG_INPUTS` fixes the mint-facing message as the proof
  secret — the mint-verified signature cannot carry the verdict. The binding
  must be an additional quorum-signed statement produced in the same signing
  flow (coordinator session), such that partial signers refuse to co-sign
  spend messages outside a verdict-bound session.
- `docs/threat-model.md` already limits INV-02 to an implementation
  invariant, "not a Byzantine-oracle guarantee"; this issue is the missing
  mitigation for that documented gap.
- The evidence has consumers: `adapters/oracle-client/registry.ts` and
  `oracle-discovery.ts` can exclude oracles with published contradictions.
- This also aligns semantics with the NUT-CTF proposal
  (cashubtc/nuts PR #337), where the attestation signature over
  `(oracle pubkey, event id, outcome)` *is* the release material, making a
  later settlement-backend swap behavior-preserving (see 0253).
- The Cashu-HTLC-alone path cannot satisfy this binding (a preimage commits
  to nothing); record it as non-compliant in the threat-model mint-layer
  trust table rather than removing it — it remains the works-on-any-mint
  floor.

## Acceptance

- Release material produced by the FROST coordinator is accompanied by, and
  bound to, a quorum-signed statement covering the oracle group pubkey, the
  query id, the proof hash, and the verdict; signing sessions that omit the
  statement produce no spend signatures.
- The statement has a canonical serialization and a domain-separated hash,
  and that hash is committed into the FROST signing session itself (the
  NUT-11 `SIG_INPUTS` spend messages stay unchanged), so partial signatures
  cannot be produced in, or reattached to, a session with a different
  statement.
- `docs/threat-model.md` gains an INV-C2 entry (claim, attack, expected,
  tests) with a matching `threat-model.lock.json` hash, and the mint-layer
  table marks the HTLC-alone path as INV-C2 non-compliant.
- An e2e/frost test locks: (a) a release without a verdict statement is
  refused, (b) a verdict statement contradicting a published attestation for
  the same query is detectable from the two artifacts alone.

## Verification

- `deno task test:e2e:frost` passes, including the new negative cases.
- `deno task lint:invariants` passes with the new INV-C2 lock entry.

## Plan

- Extend the signing-session message derivation to include the verdict
  statement; thread it through `frost-coordinator.ts` /
  `frost-signing-coordinator.ts` and the signer sidecar contract.
- Add the threat-model entry and tests.
