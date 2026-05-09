# 証明スキーマ URL を定義する

Created: 2026-05-09
Model: Codex GPT-5

## Priority

design

## Summary

`ProofGenerator` と `VerifierAdapter` の dispatch に、スキーマ URL ベースの証明キーを採用する。

## Rationale

`https://anchr.dev/spec/proof/tlsn/v1` のようなスキーマ URL は、中央集権的な数値 kind registry を置かずに、バージョン付きで参照可能な permissionless extension point を提供できる。Query events は `["s", "..."]` のような Nostr tag でスキーマを運べる。

## Plan

- 正確な証明キーの形と matching rules を決める。prefix matching を許可するかも含める。
- 初期の証明スキーマ文書を `specs/` 配下に追加する。
- Provider と Oracle の dispatch APIs を、スキーマ URL ベースの `canHandle()` checks を使うよう更新する。
