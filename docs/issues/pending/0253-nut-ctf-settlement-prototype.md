# Prototype a NUT-CTF settlement adapter against the cdk reference fork

Created: 2026-07-26
Model: Claude Opus 5

## Priority

investigation

## Dependencies

Depends on:
- 0246

Blocks:
- None

## Summary

The NUT-CTF proposal (cashubtc/nuts PR #337, open, author `joemphilips`;
reference implementation cdk PR #1666) standardizes conditional tokens
redeemed by presenting DLC-style oracle attestation signatures to the mint,
with an m-of-n oracle threshold built into the spec (`threshold` field,
error 13027, 2-of-3 test vectors). If it lands, it replaces the parts of
Anchr's settlement stack that are hardest to maintain: preimage custody
disappears (nothing secret exists before verification), verdict binding is
structural (the attestation signature is the release material), and the
threshold becomes t independent signatures — no DKG, no FROST signing
rounds, no coordinator. Build a prototype settlement adapter against the cdk
fork to validate the mapping and surface spec-level friction while the spec
is still open. Full replacement is out of scope: the spec is unmerged and no
production mint supports it.

## Rationale

- Mapping hypotheses to validate (from the 2026-07-26 design session):
  per-request outcomes enumerate as PASS/FAIL, so the DLC pre-enumeration
  constraint is trivially satisfied; the per-request oracle announcement
  round-trip has the same shape as the existing pre-lock hash issuance
  (`issueQueryHash` / hash-responder); Anchr's kind 30103 attestation event
  can carry the attestation signatures, making publish-before-release
  structural.
- Open spec questions where Anchr has real-usage input: condition
  registration volume proportional to request count, `ttl`, fees, and
  mint-visible metadata (condition registration reveals more to the mint
  than an HTLC does — evaluate against the threat-model mint-layer table
  and INV-07/INV-08 scope).
- Depends on 0246 because the verdict-bound FROST semantics are the
  compatibility target: with binding in place, swapping to CTF preserves
  guarantees instead of changing them.
- Findings should be fed back to the PR #337 discussion.

## Acceptance

- A prototype adapter implements the settlement obligations (prepare lock
  via condition registration, produce release material as attestation
  signatures, verify provider binding) against a cdk build with the CTF
  changes, exercised by an experimental e2e flow (Customer locks, Provider
  redeems after oracle attestation, refund path on timeout).
- A written findings note records: mapping confirmations or deviations,
  mint-visible metadata compared to HTLC, and spec feedback filed or drafted.

## Verification

- Unknown until investigation

## Plan

- Pin a cdk commit containing the CTF reference implementation; script mint
  bootstrap in the experimental e2e bucket.
- Implement the adapter behind the settlement obligations; run the flow;
  write the findings note.
