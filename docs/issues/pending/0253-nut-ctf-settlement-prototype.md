# Prototype NUT-CTF as a Payment Lock against the cdk reference fork

Created: 2026-07-26
Model: Claude Opus 5

## Priority

investigation

## Dependencies

Depends on:
- 0246
- 0247
- 0248

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
rounds, no coordinator. Build a prototype Payment Lock implementation against the cdk
fork to validate the mapping and identify problems in the specification while it
is still open. Full replacement is out of scope: the spec is unmerged and no
production mint supports it.

## Rationale

- Mapping hypotheses to validate (from the 2026-07-26 design session):
  per-request outcomes enumerate as PASS/FAIL, so the DLC pre-enumeration
  constraint is trivially satisfied; the per-request oracle announcement
  round-trip follows the same exchange as the existing pre-lock hash issuance
  (`issueQueryHash` / hash-responder); Anchr's kind 30103 attestation event
  can carry the attestation signatures, making publish-before-release
  structural.
- Open spec questions where Anchr has real-usage input: condition
  registration volume proportional to request count, `ttl`, fees, and
  mint-visible metadata (condition registration reveals more to the mint
  than an HTLC does — evaluate against the threat-model mint-layer table
  and INV-07/INV-08 scope).
- Depends on 0246 because FROST must first commit to the verdict; those semantics are the
  compatibility target: with binding in place, swapping to CTF preserves
  guarantees instead of changing them.
- Findings should be fed back to the PR #337 discussion.

## Acceptance

- A prototype implements the Payment Lock capabilities required by each role (Customer
  prepares and refunds the lock, Provider verifies its binding and redeems,
  Oracle produces Release Material as attestation signatures) against a cdk build with the CTF
  changes, exercised by an experimental e2e flow (Customer locks, Provider
  redeems after oracle attestation, refund path on timeout).
- A written findings note records: the pinned NUT-CTF spec revision and cdk
  commit plus build configuration, mapping confirmations or deviations
  (hypotheses kept distinct from confirmed behavior), mint-visible metadata
  compared to HTLC, and spec feedback filed or drafted.

## Requirement traceability

| Requirement | Verification |
| --- | --- |
| Customer can prepare a CTF Payment Lock | The experimental e2e test registers a condition and inspects the resulting lock against the chosen Provider and Oracle outcome. |
| Provider can verify binding and redeem after a passing attestation | The e2e test rejects a wrong Provider or condition and succeeds only with the expected attestation signatures. |
| Customer can refund after timeout without a Provider redemption | A clock-controlled e2e case advances past the timeout and recovers the locked amount. |
| Oracle Release Material is the attestation signatures | A protocol fixture round-trips the message format chosen by the investigation without introducing an unversioned Payment Lock type. |
| The prototype is reproducible | A setup check records and verifies the pinned NUT-CTF revision, cdk commit, and build configuration. |
| Findings distinguish evidence from hypotheses | A findings-template lint requires a result for every mapping hypothesis and open-spec question listed above, with an evidence link or an explicit unresolved result. |
| Privacy and trust effects are compared with HTLC | The findings check requires mint-visible fields and INV-07/INV-08 impact to be recorded. |

## Verification

- The pinned experimental e2e task passes the prepare, redeem, wrong-binding,
  and timeout-refund cases, or the findings note records the exact unsupported
  capability and reproducible failure. Because this is an investigation,
  discovering an unsupported capability is a valid result; omitting a result
  is not.

## Plan

- Pin a cdk commit containing the CTF reference implementation; script mint
  bootstrap in the experimental e2e bucket.
- Implement the prototype through the Payment Lock capabilities for each role; run the flow;
  write the findings note.
