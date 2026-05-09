# Blossom と NIP-23 のブログ公開基盤を設計する

Created: 2026-05-09
Model: Codex GPT-5

## Priority

design

## Summary

個人ブログの記事を Self-host Blossom に保存し、Nostr 長文投稿 NIP-23 へ公開するための content-addressed な公開基盤を設計する。

## Rationale

本文、画像、添付資料を content-addressed に扱うことで、ブログ記事の正本性と再配信可能性を高められる。Blossom は Nostr と親和性が高く、Anchr 既存の Blossom/Nostr 方針とも揃う。NIP-23 は長文コンテンツの配信先として使えるため、個人ブログを正本にしつつ Nostr 側にも同じ開発内容を届けられる。

## Plan

- 記事ソース、生成済み HTML、画像、添付ファイルをどの単位で content-addressed にするか決める。
- Blossom 上の blob 参照と NIP-23 event の tags/content に載せる canonical URL、hash、summary、published_at の形を設計する。
- Self-host したブログ、RSS、Nostr 長文投稿の公開順序と失敗時の再実行方針を定義する。
- 手動運用から始めるか、Deno task として自動化するかの最小実装範囲を決める。
