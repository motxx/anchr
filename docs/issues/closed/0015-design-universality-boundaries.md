# 普遍性の境界を設計する

Created: 2026-05-09
Model: Codex GPT-5
Completed: 2026-05-12

## Priority

design

## Dependencies

Depends on:
- #0001 - 三者アーキテクチャを確定する

Blocks:
- #0012 - component 境界を agnostic に定義する
- #0016 - 人間レビュー領域をハーネスへ写像する

## Summary

人間が判断する「普遍性」を、プロトコル不変条件、wire-format、パッケージ境界、example 固有判断から分離して文書化する。AI が実装を進める前に、どの判断が普遍的で、どの判断が一実装の選択なのかを明確にする。

## Rationale

`docs/threat-model.md` はセキュリティ不変条件を、`specs/README.md` は相互運用に必要な wire-format を、`CLAUDE.md` はパッケージとテストの境界を定義している。今後のリファクタリングでは、人間レビューを普遍性の設定に集中させるため、これらの境界を横断する判断基準が必要になる。

## Plan

- 普遍性、実装選択、example 固有判断、agent runtime integration の分類基準を文書化する。
- 新しい設計判断を `specs/`、`docs/threat-model.md`、各 `SPEC.md`、`docs/architecture.md`、`example/` のどこへ置くべきかのルールを定義する。
- 既存の pending issue がこの分類に従っているか確認し、必要なら追記対象を明確にする。

## Resolution

Implemented by updating:

- `docs/universality-boundaries.md`
- `docs/architecture.md`
- `specs/README.md`

The new boundary guide classifies universal protocol contracts, security
invariants, architecture boundaries, package contracts, adapter/runtime
integrations, example policy, and agent harness rules. It also records where
pending SDK, component, adapter, and harness issues should place their follow-up
decisions.

Verified with:

- `deno fmt docs/universality-boundaries.md docs/architecture.md specs/README.md`
- `deno task lint:strict`
- `deno task test:all`
- `deno task test:all:docker`

Follow-up:

- None
