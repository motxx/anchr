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

The NUT-CTF proposal (cashubtc/nuts PR #337; reference implementation cdk PR
#1666) standardizes conditional tokens
redeemed by presenting DLC-style oracle attestation signatures to the mint,
with an m-of-n oracle threshold built into the spec (`threshold` field,
error 13027, 2-of-3 test vectors). If it lands, it replaces the parts of
Anchr's settlement stack that are hardest to maintain: preimage custody
disappears (nothing secret exists before verification), verdict binding is
structural (the attestation signature is the release material), and the
threshold becomes t independent signatures — no DKG, no FROST signing
rounds, no coordinator. Build a prototype Payment Lock implementation against the cdk
fork to validate the mapping and identify compatibility gaps or open questions
while the specification is still open. Full replacement is out of scope: the
spec is unmerged and no production mint supports it.

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

## Acceptance

- The investigation produces one of two reproducible outcomes: a prototype
  implements the required Customer prepare/refund, Provider verify/redeem, and
  Oracle Release Material capabilities against a cdk build with the CTF
  changes; or the findings identify the exact unsupported capability, pinned
  revisions, reproduction command, observed failure, and effect on Anchr.
- A written findings note records: the pinned NUT-CTF spec revision and cdk
  commit plus build configuration, mapping confirmations or deviations
  (hypotheses kept distinct from confirmed behavior), mint-visible metadata
  compared to HTLC, and repository-local recommendations or follow-up work.
- The prototype, reproducible setup, tests, and findings note are checked into
  this repository. External publication is not required for completion.

## Requirement traceability

| Requirement | Verification |
| --- | --- |
| Customer prepare is supported or confirmed unsupported by the pinned revision | The experimental e2e test registers and inspects a condition, or the findings record the unsupported result and reproduction command. |
| Provider verify/redeem is supported or confirmed unsupported by the pinned revision | The e2e test rejects a wrong Provider or condition and redeems only with the expected attestation signatures, or the findings record the unsupported result and reproduction command. |
| Customer timeout refund is supported or confirmed unsupported by the pinned revision | A clock-controlled e2e case recovers the locked amount after timeout, or the findings record the unsupported result and reproduction command. |
| Oracle Release Material mapping is supported or confirmed unsupported by the pinned revision | A protocol fixture round-trips the chosen attestation-signature message format, or the findings record why that revision cannot supply it without an unversioned Payment Lock type. |
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
