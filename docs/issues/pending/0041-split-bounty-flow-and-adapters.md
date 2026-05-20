# Split bounty flow and adapters

Created: 2026-05-20
Model: GPT-5

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
