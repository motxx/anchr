# 実験的技術を adapter/plugin に分離する

Created: 2026-05-09
Model: Codex GPT-5
Completed: 2026-05-13

## Priority

feature

## Dependencies

Depends on:
- #0002 - bounty を SDK に分割する
- #0012 - component 境界を agnostic に定義する

Blocks:
- #0006 - SDK を三つの実行環境に対応させる

## Summary

Nostr、Cashu、TLSNotary、Blossom などの実験的または置換可能な技術を、core component から直接参照される実装ではなく adapter/plugin として差し替えられる構造にする。

## Rationale

採用技術の一部が要件、運用性、セキュリティ、保守性の面で不適と判明した場合でも、Anchr の普遍的な protocol と SDK surface は残せるようにしたい。component は port 型と capability contract に依存し、具体技術は reference adapter として同梱する形にすると、採用取消や代替実装の評価を局所化できる。

## Plan

- core component が必要とする storage、transport、payment、proof、media 配布などの port/capability を定義する。
- 既存の具体技術実装を、それぞれ port を満たす adapter/plugin として切り出す。
- example と tests を、直接具体技術に結合する形から adapter 注入または plugin 選択の形へ移行する。
- adapter/plugin ごとの conformance test を用意し、差し替えても core contract が保たれることを確認する。

## Resolution

Implemented by updating:

- `packages/protocol/src/capabilities.ts` and `packages/protocol/src/capabilities.test.ts`
- `packages/customer-sdk/src/customer.ts`, `packages/customer-sdk/src/types.ts`, and related Customer SDK tests
- `packages/provider-sdk/src/provider.ts`, `packages/provider-sdk/src/types.ts`, and related Provider SDK tests
- bundled Nostr/Cashu adapters in `packages/customer-sdk/src/` and `packages/provider-sdk/src/`
- SDK export/build alias config, examples, package READMEs, `docs/architecture.md`, and `specs/protocol-contract.md`

Verified with:

- `deno check packages/protocol/src packages/customer-sdk/src packages/provider-sdk/src packages/sdk/src/index.ts example/auto-claim/agent.ts example/auto-claim/insurer.ts example/c2pa-media-verification/worker.ts example/c2pa-media-verification/requester.ts example/tlsn-fiat-swap-square/buyer.ts example/tlsn-fiat-swap-square/seller.ts`
- `deno test packages/protocol/src packages/customer-sdk/src packages/provider-sdk/src --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys`
- `cd packages/sdk && bun run build`
- `deno task lint:strict`
- `deno task test:examples`
- `deno task lint:arch -- --errors-only`
- `cargo audit --no-fetch --stale --deny warnings ...` for all Rust crates after the live RustSec fetch failed
- `deno task test:all` ran lint, unit, example, and FROST E2E successfully, but overall status stayed failed because `deno task lint:deps` could not fetch `https://github.com/RustSec/advisory-db.git` during `cargo audit`

Harness update:

- Added adapter capability conformance tests in `packages/protocol/src/capabilities.test.ts`.
- Added bundled Cashu adapter manifest coverage in `packages/customer-sdk/src/cashu.test.ts`.
- Updated architecture and protocol docs so concrete technologies remain reference adapters, not SDK core requirements.

Review residuals:

- None for this issue. The live RustSec network fetch should be rerun in CI or a network-stable shell, but the cached advisory DB audit passed for all configured Rust crates.

Follow-up:

- #0006 remains responsible for runtime-specific browser, Deno, and Node adapter packaging and storage/signer/runtime details.
