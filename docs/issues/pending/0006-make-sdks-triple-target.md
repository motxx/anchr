# SDK を三つの実行環境に対応させる

Created: 2026-05-09
Model: Codex GPT-5

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
