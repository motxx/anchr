# 証明スキーマ URL を定義する

Created: 2026-05-09
Model: Codex GPT-5
Completed: 2026-05-10

## Priority

design

## Dependencies

Depends on:
- #0001 - 三者アーキテクチャを確定する

Blocks:
- #0003 - ホスト REST を Nostr に置き換える
- #0014 - 普遍部分を specs に昇格する

## Summary

`ProofGenerator` と `VerifierAdapter` の dispatch に、スキーマ URL ベースの証明キーを採用する。

## Rationale

`https://anchr-spec.org/spec/proof/tlsn/v1` のようなスキーマ URL は、中央集権的な数値 kind registry を置かずに、バージョン付きで参照可能な permissionless extension point を提供できる。Query events は `["s", "..."]` のような Nostr tag でスキーマを運べる。

## Plan

- 正確な証明キーの形と matching rules を決める。prefix matching を許可するかも含める。
- 初期の証明スキーマ文書を `specs/` 配下に追加する。
- Provider と Oracle の dispatch APIs を、スキーマ URL ベースの `canHandle()` checks を使うよう更新する。

## Resolution

Implemented by updating:

- `specs/proof-schemas.md`
- `specs/messaging.md`
- `specs/README.md`
- `packages/sdk/src/schema.ts`
- `packages/sdk/src/types.ts`
- `packages/sdk/src/events.ts`
- `packages/sdk/src/customer.ts`
- `packages/sdk/src/provider.ts`
- SDK tests, README examples, and regtest/example schema constants

The proof schema key is now an HTTPS URL such as
`https://anchr-spec.org/spec/proof/tlsn/v1`. Matching is exact; prefix matching
is not allowed. Query events now publish the proof schema discovery hint as an
`s` tag, while encrypted payloads carry the authoritative `schema` field.
Provider-side proof generator adapters and verifier adapters dispatch through
`canHandle(schema)`.

Verified with:

- `deno test packages/sdk/src/schema.test.ts packages/sdk/src/events.test.ts packages/sdk/src/customer.test.ts packages/sdk/src/provider.test.ts packages/sdk/src/integration.test.ts example/tlsn-fiat-swap-square/fiat-swap.test.ts --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys`
- `deno task test:all`
- `deno task test:all:docker`
- silent-bypass/security review of the schema dispatch diff

Follow-up:

- None
