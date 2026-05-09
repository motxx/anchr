# MCP アダプターを切り出す

Created: 2026-05-09
Model: Codex GPT-5

## Priority

maintenance

## Summary

MCP 対応を core SDK paths から外し、CLI、HTTP gateway、Discord bot、Web UI 統合と並ぶ一つのアダプター兼 example として扱う。

## Rationale

MCP は agent runtime integration であり、Anchr protocol の一部ではない。SDK から `@modelcontextprotocol/sdk` への依存を取り除くことで、ブラウザービルドを小さく保ち、SDK が主要な統合面であることを明確にする。

## Plan

- MCP の統合点として `example/anchr-mcp/` を作成または更新する。
- protocol と actor SDK packages から MCP 依存を取り除く。
- その方針を維持する場合は、`anchr-reference-host` を `anchr-mcp` に置き換えて example 数を安定させる。
