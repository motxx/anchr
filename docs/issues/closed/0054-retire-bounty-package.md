# Retire bounty package

Created: 2026-05-23
Model: GPT-5
Completed: 2026-05-24

## Priority

maintenance

## Dependencies

Depends on:
- 0046
- 0050
- 0051
- 0052
- 0053
- 0057
- 0058
- 0059
- 0060
- 0061
- 0062
- 0063

Blocks:
- 0047

## Summary

Absorb reusable `packages/bounty/` lifecycle code into SDK paid-request modules
and delete `@anchr/bounty` as a public package and concept.

## Rationale

#0046 deletes `bounty` as a core noun. The current package contains useful
pieces for paid-request lifecycle, proof delivery, attachments, payment release,
Nostr transport, and Oracle integration, but the public surface must become SDK
Customer/Provider/Oracle, payments, proofs, attachments, and adapters.

Relevant current surfaces:

- `packages/bounty/`
- `packages/sdk/`
- `e2e/protocol/`
- `e2e/relay/`
- `e2e/regtest/`
- `e2e/tlsn/`

## Acceptance

- Reusable paid-request lifecycle code lives under SDK modules with Customer,
  Provider, Oracle, payment, proof, attachment, or adapter ownership.
- No public `@anchr/bounty` or `@anchr/sdk/bounty` surface exists.
- Query, claim-gate, and bounty terminology is removed from new SDK public APIs
  unless preserved only in historical tests or issue text.
- Package and e2e code no longer imports from `packages/bounty/src/...`.
- The `packages/bounty/` manifest and directory are deleted once retained code
  has moved.

## Verification

- No matches are expected:
  `rg -n "@anchr/bounty|@anchr/sdk/bounty|packages/bounty/src" packages e2e deno.json`
- `deno task test:unit`
- `deno task test:e2e:protocol`

## Plan

- #0057, #0058, #0059, and #0060 moved retained code and deleted the old
  package shell.
- Resolve #0061 to replace the root SDK HTTP convenience client query
  vocabulary with paid-request vocabulary.
- Resolve #0062 to rename the public Nostr adapter requester/worker/query
  surface to Customer/Provider/request vocabulary.
- Resolve #0063 to remove query-shaped helper names from public SDK
  attachments, proof, and oracle adapter surfaces.
- Close this parent after the child issues verify that no public
  `@anchr/bounty`, `@anchr/sdk/bounty`, claim-gate, or query/bounty SDK surface
  remains.

## Resolution

Implemented by updating:

- `packages/sdk/src/index.ts`
- `e2e/protocol/bounty-attacks.test.ts`
- `e2e/protocol/bounty-quorum.test.ts`
- `e2e/protocol/bounty-trustless.test.ts`
- `e2e/protocol/bounty-vulns.test.ts`
- `e2e/regtest/core-flow.test.ts`
- `e2e/regtest/regtest-cashu.test.ts`
- `e2e/relay/oracle-discovery.test.ts`
- `e2e/relay/relay.test.ts`
- `e2e/tlsn/tlsn.test.ts`

Verified with:

- `rg -n "@anchr/bounty|@anchr/sdk/bounty|packages/bounty/src" packages e2e deno.json` returned no matches.
- `rg -n "createQueryService|createQueryStore|type QueryService|type QueryStore|type Query\\b|type QueryResult\\b|makeFakeToken|makeMockOracle|makeServiceWithPreimage|driveToProcessing|driveQuorumToProcessing|makeQuorumService|makeEscrowInfo|MIN_ESCROW_LOCKTIME_SECS" packages/sdk/src/index.ts` returned no matches.
- `find packages -maxdepth 2 -name deno.json -print | sort`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- `deno task lint:strict`
- `check-silent-bypass` review found no in-scope silent-bypass patterns.

Harness update:

- Root SDK compilation plus the issue-specific grep checks now lock that the
  internal query service and protocol test helpers are not exported from the
  public SDK root surface.

Review residuals:

- None

Follow-up:

- None
