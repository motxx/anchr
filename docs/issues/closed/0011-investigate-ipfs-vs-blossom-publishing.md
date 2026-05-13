# IPFS と Blossom の公開基盤比較を調査する

Created: 2026-05-09
Model: Codex GPT-5
Completed: 2026-05-09

## Priority

investigation

## Dependencies

Depends on:
- None

Blocks:
- #0009 - 開発内容の公開方針を定義する
- #0010 - Blossom と NIP-23 のブログ公開基盤を設計する

## Summary

個人ブログの self-sovereign な公開基盤として、IPFS ではなく Blossom を採用する判断を出典付きで検証する。

## Rationale

現時点の仮説は、IPFS はノード実装や運用面が集権的に見える懸念があり、Blossom は NIP/BUD ベースで Nostr エコシステムとの親和性とスケールが期待できる、というもの。ただし IPFS に関する評価は印象に留まっているため、公開方針として採用する前に一次情報または信頼できる資料で確認する必要がある。

## Plan

- IPFS の主要実装、運用分布、pinning/provider 依存、コンテンツ可用性モデルを調べ、集権化懸念を出典付きで整理する。
- Blossom の BUD/Nostr 連携、認証、content-addressing、サーバー選択、可用性モデルを調べる。
- 個人ブログ用途での比較軸を、自己主権性、移行容易性、読者到達性、運用負荷、検閲耐性に分けてまとめる。
- 調査結果を `0009` と `0010` の方針へ反映できる形で結論化する。

## Resolution

Implemented by updating:

- `docs/publishing-storage-comparison.md`
- `docs/issues/pending/0009-define-development-publishing-strategy.md`
- `docs/issues/pending/0010-design-blossom-nip23-blog-publishing.md`

Verified with:

- `deno task lint:strict`
- `deno task test:all`
- `deno task test:all:docker`

Follow-up:

- #0009 now depends on none.
- #0010 now depends only on #0009.
