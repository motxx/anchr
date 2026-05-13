# component 境界を agnostic に定義する

Created: 2026-05-09
Model: Codex GPT-5
Completed: 2026-05-13

## Priority

design

## Dependencies

Depends on:
- #0001 - 三者アーキテクチャを確定する
- #0015 - 普遍性の境界を設計する

Blocks:
- #0002 - bounty を SDK に分割する
- #0013 - 実験的技術を adapter/plugin に分離する
- #0014 - 普遍部分を specs に昇格する

## Summary

現在の component 群から、Nostr、Cashu、TLSNotary、Blossom などの具体技術に依存しない責務境界を切り出す。実験的な採用技術は将来取り消される可能性があるため、component の意味を特定実装ではなく protocol 上の役割と入出力契約で表現できるようにする。

## Rationale

Anchr は実験的な技術採用が多く、個別技術に問題があれば採用を取り消す判断が十分ありうる。そのとき component 名や domain model が具体技術に引きずられていると、技術選定の変更が protocol と SDK の再設計に波及する。普遍的に残る部分は `specs/` と `docs/architecture.md` に記録し、実装はその reference implementation として位置づける必要がある。

## Plan

- 既存 component を棚卸しし、各 component の不変な責務、入力、出力、失敗条件を具体技術抜きで記述する。
- `docs/architecture.md` に、component と adapter/plugin の境界を追加する。
- 具体技術名が domain API、package boundary、spec vocabulary に入り込んでいる箇所を特定し、置き換え方針を決める。

## Resolution

Implemented by updating:

- `docs/architecture.md`

The architecture guide now records agnostic component boundaries for actor
coordination, evidence contracts, verification decisions, settlement locks,
release authority, attachment transport, local actor state, and runtime
adapters. Each boundary lists stable responsibility, inputs, outputs, failure
conditions, and current bindings. Placement of rules derived from the table
defers to `docs/universality-boundaries.md` (universal vs. adapter) and the
existing Naming migration section (actor names), so the architecture entry
stays focused on component contracts.

Verified with:

- `deno task lint:strict`
- `deno task test:all`
- `deno task test:all:docker`

Follow-up:

- None
