# SDK を三つの実行環境に対応させる

Created: 2026-05-09
Model: Codex GPT-5
Completed: 2026-05-15

## Priority

feature

## Dependencies

Depends on:
- #0002 - bounty を SDK に分割する
- #0013 - 実験的技術を adapter/plugin に分離する

Blocks:
- None

## Summary

Customer SDK と Provider SDK を pure ESM packages としてブラウザー、Node、Deno で動かせるようにする。

## Rationale

Customer UI と一部の Provider フローは SPA で動くのが自然だが、別の Provider フローはサーバーランタイムで動く。SDK はランタイム固有 API を避け、永続化を ports の背後に置き、NIP-07 signing を支援し、TLSNotary prover wasm を必須依存としてバンドルしないようにするべきである。

## Plan

- `@anchr/core-runtime` をブラウザー、Node、Deno compatibility に向けて拡張する。
- SDK の storage、signer、wallet、proof generation の挙動を注入可能な ports の背後に保つ。
- IndexedDB-backed storage を含め、必要な場所にブラウザー向け実装を追加する。

## Resolution

Implemented by updating:

- `packages/core-runtime/src/runtime.ts`, `packages/core-runtime/src/env.ts`, and related exports/docs.
- `packages/protocol/src/nostr.ts` with `NostrSigner`, keypair signer, and NIP-07 signer helpers.
- `packages/customer-sdk/src/storage.ts`, `packages/provider-sdk/src/storage.ts`, and SDK option types/exports for actor state stores.
- `packages/customer-sdk/src/customer.ts` and `packages/provider-sdk/src/provider.ts` to persist request/provider progress when a state store is injected.
- `packages/sdk/src/index.ts`, package `deno.json` exports, package READMEs, and `docs/architecture.md`.
- Focused tests for runtime detection, browser-safe module dirs, signer ports, memory/IndexedDB state stores, and Customer/Provider state checkpoints.

Verified with:

- `deno check packages/core-runtime/src/mod.ts packages/protocol/src/mod.ts packages/customer-sdk/src/mod.ts packages/provider-sdk/src/mod.ts packages/sdk/src/index.ts`
- `deno test packages/core-runtime/src packages/protocol/src packages/customer-sdk/src packages/provider-sdk/src --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys`
- `deno task lint:strict`
- `deno task test:all`
- `deno task test:all:docker`
- `check-silent-bypass`: no silent-bypass patterns detected in the changed production TypeScript files.

Harness update:

- Added unit coverage for `core-runtime` runtime detection and browser-safe `moduleDir()`.
- Added signer conformance tests for keypair and NIP-07 signer ports.
- Added storage conformance tests for memory and injected IndexedDB-backed actor state stores.
- Updated `docs/architecture.md` so storage and signer adapters are part of the documented SDK capability surface.

Review residuals:

- None.

Follow-up:

- None.
