# component 境界を agnostic に定義する

Created: 2026-05-09
Model: Codex GPT-5

## Priority

design

## Summary

現在の component 群から、Nostr、Cashu、TLSNotary、Blossom などの具体技術に依存しない責務境界を切り出す。実験的な採用技術は将来取り消される可能性があるため、component の意味を特定実装ではなく protocol 上の役割と入出力契約で表現できるようにする。

## Rationale

Anchr は実験的な技術採用が多く、個別技術に問題があれば採用を取り消す判断が十分ありうる。そのとき component 名や domain model が具体技術に引きずられていると、技術選定の変更が protocol と SDK の再設計に波及する。普遍的に残る部分は `specs/` と `docs/architecture.md` に記録し、実装はその reference implementation として位置づける必要がある。

## Plan

- 既存 component を棚卸しし、各 component の不変な責務、入力、出力、失敗条件を具体技術抜きで記述する。
- `docs/architecture.md` に、component と adapter/plugin の境界を追加する。
- 具体技術名が domain API、package boundary、spec vocabulary に入り込んでいる箇所を特定し、置き換え方針を決める。
