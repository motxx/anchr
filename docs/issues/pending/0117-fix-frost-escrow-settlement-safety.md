# Complete or remove FROST escrow settlement for v0

Created: 2026-06-11
Model: Claude Fable 5

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The `p2pk_frost` escrow variant is partially built: it strands customer refunds,
binds the group signature too weakly, has no redeem path, and the signer reuses
nonces across concurrent sessions. Decide whether FROST escrow is in v0 — if so
complete it safely; if not, remove the surface and document FROST as
release-authority research only.

## Rationale

From the 2026-06-11 production-readiness audit §2.5:

- **PROT-03 (high)** — `packages/sdk/src/payments/cashu/frost-escrow-provider.ts:90-97`
  calls `buildFrostP2PKOptions(provider_pubkey, config.groupPubkey, "",
  locktimeSeconds)` with an empty `customerRefundPubkey` and a hardcoded
  `now + 3600` locktime; `.addRefundPubkey("")` runs unconditionally. With no
  valid refund key, if the FROST group never releases, the customer's funds are
  permanently stranded.
- **PROT-05 (medium)** — `packages/sdk/src/payments/frost/frost-signature-adapter.ts:27-29`
  and `oracle-service.ts:313-315` sign `sha256("anchr:sign:" + query.id)` only,
  excluding `request_event_id`, the selected Provider, and a token commitment.
- **PROT-06 (medium)** — no function applies a FROST `group_signature` +
  Provider key as the 2-of-2 P2PK witness; `frost-escrow-provider.settle()`
  returns `{settled:false}`, so FROST-locked funds are unspendable via the SDK.
- **PROT-08 (medium)** — `packages/sdk/src/payments/frost/frost-signer.ts:104-106,188-201`
  uses a single `pendingNonces` variable with no per-session keying; two
  overlapping signing sessions can cross nonces or reuse a nonce across
  messages, leaking the signing share's secret. This bug holds regardless of the
  keep/remove decision.

## Acceptance

- Either `p2pk_frost` escrow is removed from v0 (surface deleted, FROST
  documented as release-authority research) — in which case the FROST escrow
  provider, signature adapter consumption, and `p2pk_frost` settlement type are
  gone; or FROST escrow is completed: real customer refund key + request
  locktime threaded into binding, signing message bound to
  `request_event_id`/Provider/token, and a working Provider redeem path.
- Regardless of the decision, `frost-signer` keys pending nonces per session and
  refuses a round-2 share with no matching session nonce.

## Verification

- `deno task test:e2e:frost`
- `deno task test:unit` with an interleaved two-session test in
  `frost-signer.test.ts` asserting each round 2 uses its own nonces.
- If kept: a unit test decoding the bound token asserts a non-empty refund tag
  whose locktime ≥ request expiry + margin.
- `deno task lint:strict`

## Plan

- Re-read the FROST escrow + signer code and make the v0 keep/remove decision.
- Split with `make-issues` if completing FROST escrow is one change too
  large (refund-key binding, message binding, redeem path, nonce-session safety
  are separable).
- Fix the nonce-session safety independently first; it is a key-leak risk that
  applies either way.
