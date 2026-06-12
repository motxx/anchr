# Document and enable transport routing for mint/Blossom IP exposure

Created: 2026-06-11
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0143

## Summary

The relay-only anonymity guarantee (INV-08) does not cover the Cashu mint and
Blossom HTTP touchpoints, which expose Customer/Provider IPs with no SOCKS5/Tor
routability in the SDK. Document the limit and add an injectable transport hook
so callers can route those calls over a proxy.

## Rationale

From the 2026-06-11 production-readiness audit §2.4 (ANON-02):

- `packages/sdk/src/attachments/blossom.ts:147-154,193` and the
  `@cashu/cashu-ts` wallet (`packages/sdk/src/payments/cashu/cashu-wallet.ts:36-40`)
  use the global `fetch` with no proxy/dispatcher hook; the SDK has zero
  `socks`/`SOCKS_PROXY` references.
- The only SOCKS5 support that landed is in the TLSN crates
  (`crates/tlsn-prover/src/main.rs:57-59,82-88`,
  `crates/tlsn-server/src/main.rs:377-381`).
- The INV-08 test stubs the CashuClient, so the real mint round-trip is out of
  scope (see ANON-04 / 0128).
- `createHttpOracleClient` already exposes an injectable `fetchImpl`
  (`packages/sdk/src/oracle.ts:49,84`) — the same pattern fits here.

## Acceptance

- `docs/threat-model.md` states INV-08's relay-only guarantee excludes the
  mint/Blossom HTTP touchpoints and that IP-level anonymity there requires
  operator-supplied transport.
- The Blossom helpers and the Cashu wallet construction accept an injectable
  `fetchImpl`/dispatcher so callers can route over a SOCKS5 proxy.
- `tlsn-prover --socks-proxy` is documented as the supported Tor path for the
  target connection.

## Verification

- `rg -n "fetchImpl|dispatcher" packages/sdk/src/attachments packages/sdk/src/payments/cashu`
  shows injectable transport.
- `deno task test:unit` covering the injected-transport path.
- `deno task lint:strict`

## Plan

- Add the `fetchImpl`/dispatcher option to the Blossom upload/download helpers
  and the Cashu wallet factory, mirroring `createHttpOracleClient`.
- Update `docs/threat-model.md` and the relevant spec/README transport notes.
