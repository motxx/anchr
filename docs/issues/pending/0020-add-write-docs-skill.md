# Add write-docs skill for concise, DRY documentation

Created: 2026-05-13
Model: Opus 4.7 (1M context)

## Priority

feature

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`docs/` 配下のドキュメントを書く／更新するときに、簡潔さと既存ドキュメントとの
DRY 性を担保する Anchr ローカル SKILL を `skills/write-docs/SKILL.md` として追加する。
既存の汎用 SKILL (`superpowers:*`, `doc-coauthoring`, `writing-documentation`,
`simplify`) を呼び出すオーケストレータとして実装し、Anchr 固有の制約
（CLAUDE.md の「Comments / 履歴コメント禁止」「pre-1.0 で deprecated 残さない」など）
と doc レイアウト (`docs/architecture.md`, `docs/threat-model.md`,
`docs/review-harness.md`, `docs/universality-boundaries.md`, `specs/`) に紐づける。

## Rationale

- 現状、ドキュメントの重複・冗長化を検出する自動チェックは無い。`scripts/`
  配下の lint は code 寄りで、Markdown は `lint:deprecation` が
  "deprecated/legacy/backward compat" 表現を弾く程度。
- 既存 `docs/*.md` は役割が明確に分かれている (architecture / threat-model /
  review-harness / universality-boundaries / publishing-strategy) が、新規
  ドキュメントを書くたびに「どこに何を書くか」「どこと重複しているか」を
  人手で判断しており、レビュー時に指摘されがち。
- 利用可能な既存 SKILL:
  - `writing-documentation` — Elements of Style ベースの簡潔化ルール
  - `doc-coauthoring` — 構造化された執筆ワークフロー
  - `simplify` — 変更済みコード / テキストの簡素化レビュー
  - `superpowers:writing-skills` — SKILL 自体の書き方
  - `superpowers:brainstorming` — 着手前の意図整理
- Anchr 固有の上書きルール（CLAUDE.md 抜粋）:
  - "Default to none" のコメント方針
  - `lint:no-history-comments` の存在
  - pre-1.0 ポリシーで "added for X / previously did Y" 禁止
  - `docs/` と `specs/` の役割分担、`example/<app>/` の自治
- 関連ファイル: `skills/make-issues/SKILL.md`（既存 SKILL のテンプレ例として参照）、
  `docs/review-harness.md`（recurring review finding をどこへ落とすかの台帳）。

## Plan

- `skills/write-docs/SKILL.md` を追加。frontmatter の description は
  「`docs/` / `specs/` / SKILL Markdown を新規作成・大幅編集する直前と直後に呼ぶ」
  をトリガとして明示する。
- ワークフローを以下の段で構成:
  1. 意図確認: `superpowers:brainstorming` を任意で呼ぶ（大きめのドキュメントのみ）。
  2. 重複チェック: 既存 `docs/*.md` と `specs/*.md` を Glob + Grep し、
     書こうとしているトピックの先住者を列挙。重複があれば「追記 or リンク」を
     既定提案。
  3. 配置決定: `docs/architecture.md` / `threat-model.md` / `review-harness.md` /
     `universality-boundaries.md` / `specs/` のどれに置くかをルーティング表で決める。
  4. 執筆: `doc-coauthoring` のワークフローに乗せる。
  5. 簡潔化: 書き終えたら `writing-documentation` と `simplify` を順に走らせ、
     `lint:deprecation` / `lint:no-history-comments` 観点でも自己レビュー。
- `skills/write-docs/` 配下に Anchr 専用ルーティング表 (`references/doc-routing.md`)
  を置き、「この種類の情報はここに書く」を 1 ページで参照可能にする。
- `.claude/skills` / `.codex/skills` は `skills/` への symlink なので、新規追加時は
  `skills/` のみ編集（CLAUDE.md "Skill routing" 節の規約）。
- `docs/review-harness.md` の "semantic skills" 列に `write-docs` を追記し、
  ドキュメント関連の recurring review finding をこのスキルにルーティングできる
  ようにする。
