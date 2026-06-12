# Operations robustness follow-ups

Created: 2026-06-11
Model: Claude Fable 5
Completed: 2026-06-13

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Tracking issue for the medium/low operations findings: success logged at error
level, no relay reconnect/resubscribe, test files in the JSR publish, missing
license metadata, a floating/scale-to-zero relay image, an insecure SSRF-guard
default, and no graceful shutdown/health surface for the relay-DM Oracle.

## Rationale

From the 2026-06-11 production-readiness audit §2.7:

- **OPS-02** — 62 `log.error` vs 5 info/warn; success/lifecycle events log at
  error level (`oracle-service.ts:192-193,226,306`, `cashu-wallet.ts:173-175`).
- **OPS-04** — `packages/sdk/src/adapters/nostr/client.ts:57-97` has no
  reconnect/`since`-resubscribe/missed-event recovery.
- **OPS-06** — `deno publish --dry-run` ships ~58 nested `*.test.ts` in
  `@anchr/sdk`; the only exclusion is `src/*.test.ts`
  (`packages/sdk/deno.json:43-70`).
- **OPS-07** — no `license` field in `packages/*/deno.json`; no `license` in
  `crates/*/Cargo.toml`.
- **OPS-09** — `fly.relay.toml:5,17-19` uses `:latest` and
  `min_machines_running = 0`.
- **OPS-10** — `packages/sdk/src/attachments/url-validation.ts:89-109` gates the
  localhost-SSRF rejection on Node's `NODE_ENV` (off by default in Deno) and
  misses `[::1]`/`::ffff:127.0.0.1`; `access.ts:138-145` falls back to a
  localhost public URL.
- **OPS-11** — no `SIGTERM`/`SIGINT` wiring to `service.stop()` and no health
  surface on the default relay-DM Oracle (`oracle-service.ts:359-368`).

## Acceptance

- Log levels reflect outcome (success → info, recoverable → warn, failure →
  error).
- Relay reconnect resubscribes with a `since` watermark, or relay-side replay is
  documented as required.
- JSR publish excludes `src/**/*.test.ts` and `src/**/*.integration.test.ts`.
- `license` is present in both `deno.json` files and each `Cargo.toml`.
- The relay image is pinned; the scale-to-zero trade-off is resolved or
  documented.
- The localhost-SSRF guard is default-secure on a Deno-native signal and covers
  IPv6 loopback; `access.ts` fails loudly without a configured base URL.
- Graceful shutdown + health for the relay-DM Oracle is wired or documented as
  host responsibility.

## Verification

- `deno publish --dry-run --allow-dirty --config packages/sdk/deno.json 2>&1 | grep -cE '\.test\.ts'`
  returns 0.
- `grep -c '"license"' packages/*/deno.json` ≥ 1 each;
  `grep -c '^license' crates/*/Cargo.toml` ≥ 1 each.
- `deno test packages/sdk/src/attachments/url-validation.test.ts` (unset-env +
  loopback IPv6 cases).
- `deno task test:e2e:relay` (reconnect case); `deno task lint:strict`.

## Plan

- Apply the mechanical items (publish exclude, license fields, log-level
  reclassification) directly.
- Treat relay reconnect, SSRF-guard default, and Oracle shutdown/health as
  separable changes; split with `make-issues` if needed.

## Resolution

Implemented by updating:

- **OPS-02** — success/lifecycle messages reclassified (preimage/FROST
  delivery → info, retries → warn, binary discovery → debug, quote-reuse →
  warn) across `oracle-service.ts`, `proof-publisher.ts`, `frost-cli.ts`,
  `tlsn-validation.ts`, `c2pa-validation.ts`, `cashu-wallet.ts`
- **OPS-04** — `adapters/nostr/client.ts` documents the durability contract:
  no auto-reconnect/replay; hosts run replaying relays (resubscribe with a
  `since` watermark) or wrap the client
- **OPS-06** — `packages/sdk/deno.json` publish excludes `src/**/*.test.ts`
  and `src/**/*.integration.test.ts`
- **OPS-07** — `license: MIT` in both `packages/*/deno.json` and all four
  `crates/*/Cargo.toml` (matches the repository LICENSE)
- **OPS-09** — `fly.relay.toml` pins `scsibug/nostr-rs-relay:0.10.0`;
  scale-to-zero is documented as accepted for the dev/test relay with the
  production requirement stated
- **OPS-10** — `attachments/url-validation.ts` is default-secure on the
  Deno-native `ANCHR_ALLOW_LOCALHOST_ATTACHMENTS=1` opt-in (NODE_ENV signal
  deleted) and covers `[::1]` and `::ffff:127.*` (dotted and hex);
  `attachments/access.ts` throws without a configured base URL instead of
  minting localhost URLs
- **OPS-11** — `adapters/nostr/oracle-service.ts` documents host
  responsibility: SIGTERM/SIGINT → `stop()`, health surface, scheduled
  `expireQueries()`

Verified with:

- `deno publish --dry-run --allow-dirty --config packages/sdk/deno.json`
  ships zero `*.test.ts`
- `grep -c '"license"' packages/*/deno.json` and
  `grep -c '^license' crates/*/Cargo.toml` ≥ 1 each
- `deno task test:unit` (unset-env + IPv6 loopback SSRF cases)
- `deno task test:all`; Docker bar for relay/regtest

Harness update:

- The url-validation default-secure tests lock OPS-10; the publish exclude
  is re-verified by the dry-run command when the publish surface changes.

Review residuals:

- Relay reconnect/watermark layering and daemon health remain host
  responsibilities, documented at the owning modules (OPS-04 / OPS-11
  accepted alternative).

Follow-up:

- None
