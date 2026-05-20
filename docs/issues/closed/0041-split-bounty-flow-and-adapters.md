# Split bounty flow and adapters

Created: 2026-05-20
Model: GPT-5
Completed: 2026-05-20

## Priority

maintenance

## Dependencies

Depends on:
- 0037
- 0038
- 0039
- 0040

Blocks:
- 0043

## Summary

Shrink `@anchr/bounty` from a broad migration facade into a flow package plus
separate adapters and proof engines. The current package exports domain,
application service, Nostr worker/requester services, escrow providers, oracle
server/client, verification helpers, Blossom helpers, and claim-gate code from
one public surface.

## Rationale

Relevant references:

- `docs/architecture.md` target directory taxonomy
- `docs/issues/closed/0037-document-target-boundary-taxonomy.md`
- `packages/bounty/src/mod.ts`
- `packages/bounty/src/domain/`
- `packages/bounty/src/application/`
- `packages/bounty/src/infrastructure/nostr/`
- `packages/bounty/src/infrastructure/escrow/`
- `packages/bounty/src/infrastructure/blossom/`
- `packages/bounty/src/infrastructure/verification/`
- `packages/bounty/src/infrastructure/oracle-service/`
- `packages/bounty/src/infrastructure/claim-gate/`

`bounty` is documented as migration scaffolding around the three-actor model.
As long as it remains the place where every adapter and proof integration is
publicly re-exported, package ownership remains hard to reason about and
downstream examples keep depending on a transitional surface.

Boundary facts to preserve while splitting:

- The FROST files under `packages/bounty/src/infrastructure/oracle-service/`
  are not bounty-specific business logic. They are currently the HTTP
  orchestration layer for threshold Oracle release authority:
  `frost-dkg-routes.ts`, `frost-sign-routes.ts`, and `frost-signer-routes.ts`.
- Moving those routes should preserve the existing real DKG/signing path:
  Rust sidecar in `crates/frost-signer`, TypeScript wrapper in
  `packages/frost-oracle/src/frost-cli.ts`, and peer coordination in
  `packages/frost-oracle/src/signing-coordinator.ts`.
- The split should keep local single-key/demo release stores distinct from
  distributed FROST signing. Treating all Oracle implementations as either
  simple HTTP hash clients or synchronous key stores would reintroduce the
  boundary mismatch tracked by 0040.

## Plan

- Keep bounty-specific lifecycle/domain/application code in the accepted flow
  location.
- Move or re-export Nostr, Cashu, Blossom, Oracle HTTP/Nostr, and verification
  integrations from their accepted adapter/proof packages.
- Decide whether claim-gate is a reusable flow or belongs to the airdrop app.
- Replace app/example imports from `@anchr/bounty/*` with the narrower target
  surfaces.
- Reduce the `@anchr/bounty` public facade or mark it explicitly transitional
  until it can be removed.

## Resolution

Implemented by updating:

- `packages/bounty/src/mod.ts`
- `packages/bounty/src/flow.ts`
- `packages/bounty/src/attachments.ts`
- `packages/bounty/src/escrow.ts`
- `packages/bounty/src/nostr.ts`
- `packages/bounty/src/oracle-client.ts`
- `packages/bounty/src/oracle-service.ts`
- `packages/bounty/src/verification.ts`
- `packages/bounty/src/claim-gate.ts`
- `packages/bounty/deno.json`
- `packages/bounty/README.md`
- `example/anchr-mcp/`
- `example/data-marketplace/`
- `example/airdrop-bot-shield/deno.json`
- `example/two-party-binary-bet/src/url-guard.ts`
- `docs/architecture.md`

Reduced the `@anchr/bounty` root facade to the query/domain/application flow and
moved concrete public surfaces behind explicit subpath exports:
`attachments`, `escrow`, `nostr`, `oracle-client`, `oracle-service`,
`verification`, and `claim-gate`. Updated example imports away from the removed
legacy subpaths (`attachment-access`, `domain-types`, `nostr-events`,
`nostr-transport`, and `url-validation`) to the narrower boundary they use.

Verified with:

- `deno check packages/bounty/src/mod.ts packages/bounty/src/flow.ts packages/bounty/src/attachments.ts packages/bounty/src/escrow.ts packages/bounty/src/nostr.ts packages/bounty/src/oracle-client.ts packages/bounty/src/oracle-service.ts packages/bounty/src/verification.ts packages/bounty/src/claim-gate.ts`
- `deno test --allow-all example/anchr-mcp/src/mcp-query-backend.test.ts example/anchr-mcp/src/mcp-server.integration.test.ts example/data-marketplace/src/marketplace/marketplace-routes.test.ts example/airdrop-bot-shield/src/service.test.ts example/two-party-binary-bet/src/server-routes.test.ts`
- `deno task lint:strict`
- `deno task test:examples`
- `deno task test:unit`

Harness update:

- Added `packages/bounty/README.md` to document the narrowed public surfaces and
  updated `docs/architecture.md` to record the transitional root/subpath split.

Silent-bypass review:

- No findings. The changed in-scope package files are re-export boundary files;
  no verification, validation, settlement, redemption, auth, signing, or quorum
  branch behavior changed.

Review residuals:

- The filesystem package names remain transitional until #0043 updates boundary
  lints, workspace config, and docs around the final layout.
- `claim-gate` remains a reusable bounty subpath for now; final ownership is
  still part of the #0043 boundary cleanup.

Follow-up:

- #0043
