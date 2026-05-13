# 人間レビュー領域をハーネスへ写像する

Created: 2026-05-09
Model: Codex GPT-5
Completed: 2026-05-12

## Priority

maintenance

## Dependencies

Depends on:
- #0015 - 普遍性の境界を設計する

Blocks:
- #0017 - ハーネス保守ループを標準化する
- #0018 - 人間レビュー残差を追跡する

## Summary

人間がレビューしている観点を棚卸しし、テスト、lint、skill、issue テンプレート、仕様ロックのどれで機械的に検査するかを対応表にする。繰り返し発生するレビュー観点を人間の目視確認から外し、AI の実装結果をハーネスで検査できる状態に近づける。

## Rationale

既に `deno task lint:strict`、`deno task lint:invariants`、`scripts/arch-lint.ts`、`skills/check-silent-bypass/SKILL.md`、各 e2e task が存在する。一方で、どの人間レビュー観点がどのハーネスに委譲済みか、どの観点がまだ人間の判断に残っているかは一覧化されていない。

## Plan

- 現在の gating command、semantic skill、docs lock、e2e bucket を一覧化する。
- レビュー観点ごとに `automated`、`semantic skill`、`human universal decision`、`not yet covered` の分類を付ける。
- `not yet covered` の観点を、追加テスト、lint、skill、仕様追記のいずれに変換するか決める。

## Resolution

Implemented by updating:

- `docs/review-harness.md`
- `CLAUDE.md`

Verified with:

- `deno task lint:strict`

Follow-up:

- #0017 should standardize the loop for turning repeated review findings into harness updates.
- #0018 should define the residual human-review checklist after the harness passes.
