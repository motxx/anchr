# Blossom と NIP-23 のブログ公開基盤を設計する

Created: 2026-05-09
Model: Codex GPT-5
Completed: 2026-05-10

## Priority

design

## Dependencies

Depends on:
- #0009 - 開発内容の公開方針を定義する

Blocks:
- None

## Summary

個人ブログの記事を Self-host Blossom に保存し、Nostr 長文投稿 NIP-23 へ公開するための content-addressed な公開基盤を設計する。

## Rationale

本文、画像、添付資料を content-addressed に扱うことで、ブログ記事の正本性と再配信可能性を高められる。Blossom は Nostr と親和性が高く、Anchr 既存の Blossom/Nostr 方針とも揃う。NIP-23 は長文コンテンツの配信先として使えるため、個人ブログを正本にしつつ Nostr 側にも同じ開発内容を届けられる。

## Plan

- 記事ソース、生成済み HTML、画像、添付ファイルをどの単位で content-addressed にするか決める。
- Blossom 上の blob 参照と NIP-23 event の tags/content に載せる canonical URL、hash、summary、published_at の形を設計する。
- Self-host したブログ、RSS、Nostr 長文投稿の公開順序と失敗時の再実行方針を定義する。
- 手動運用から始めるか、Deno task として自動化するかの最小実装範囲を決める。

## Resolution

Implemented by updating:

- `docs/blossom-nip23-blog-publishing.md`
- `docs/development-publishing-strategy.md`

The design defines:

- a publishing workflow with Personal Blog as the canonical page, RSS and
  NIP-23 as distribution, and Blossom for media/assets only when needed
- Blossom asset upload and idempotent retry behavior
- a 2026-05-10 compatibility profile for the NIP/BUD contracts this workflow
  depends on
- the required Anchr NIP-23 tag shape, including the canonical URL
- payload ownership notes that distinguish NIP/BUD payloads from the Anchr
  profile, with a minimal BUD-03 example for the unused `.content` field
- RSS relationship, staged failure handling, and local receipts

Verified with:

- `deno task lint:strict`
- `deno task test:all`
- `deno task test:all:docker`

Follow-up:

- None
