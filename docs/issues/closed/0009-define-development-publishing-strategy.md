# 開発内容の公開方針を定義する

Created: 2026-05-09
Model: Codex GPT-5
Completed: 2026-05-09

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- #0010 - Blossom と NIP-23 のブログ公開基盤を設計する

## Summary

Anchr の開発内容を自然言語で公開するための編集方針と配信方針を定義する。媒体は個人ブログを主軸にし、SEO の時流最適化ではなく、同じ課題を抱える人へ確実に届く経路を重視する。

## Rationale

この開発は短期的な検索トレンドへ寄せる性質ではない。個人ブログを正本にすれば、Nostr、RSS、HN などの公開方式を add-on でき、将来の配信経路を増やしやすい。コンテンツは self-sovereign に扱い、発信者がホスト、署名、配信先を管理できる設計にする。

## Plan

- 誰に何を伝えるのかを、開発ログ、設計ノート、リリース告知、検証記事のような記事種別ごとに定義する。
- 個人ブログを正本にし、RSS、Nostr 長文投稿、HN 共有を add-on として扱う公開フローを文書化する。
- SEO 目的の量産や流行語最適化を避ける編集基準を決める。

## Resolution

Implemented by updating:

- `docs/development-publishing-strategy.md`

Verified with:

- `deno task lint:strict`
- `deno task test:all`
- `deno task test:all:docker`

Follow-up:

- #0010 can now use the editorial and channel policy as input for the
  Blossom-first NIP-23 workflow design.
