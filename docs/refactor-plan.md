# Anchr → Independent Products Refactor Plan

**Started**: 2026-04-26
**Goal**: Decompose the Anchr Protocol monolith into independent products, each with its own product/repo identity, sharing only minimal core libraries. Examples become integration tests across products.

## Strategic context

Decisions reached in design discussion (2026-04-25/26):

- **Drop "Anchr Protocol" framing**: orchestration is not protocol-worthy by itself. Composition of TLSN + Cashu + Nostr is application logic, not protocol.
- **GPS / C2PA は独立 product**: 写真/動画 bounty は TLSN とは別の persona、合成する意味なし。
- **TLSN 系も個別 product 化**: fiat-swap、auto-claim、airdrop-shield は別 persona の product。
- **Examples = integration tests**: 既存 example は独立 product を組み合わせて作り、抽出時の regression を捕まえる役を担う。
- **既存テストを max 活用**: protocol-attacks / -exploits / -quorum / -trustless および penetration tests は新 product 構成へ継承する。
- **Anchr ブランドは弱体化**: 「Anchr Protocol」「Anchr SDK」を看板に置かない。各 product は自前で立つ。

## Product 境界

| ID | Product | 主要 owns | TLSN | Cashu | FROST | Nostr |
|----|---------|-----------|:---:|:---:|:---:|:---:|
| A | photo-bounty | C2PA, EXIF, ProofMode, AI content check, GPS/Haversine, exif-strip, examples: c2pa-media-verification + supply-chain-proof, mobile camera screens | – | ✓ | – | ✓ |
| B | tlsn-fiat-swap | TLSN validation, Square API templates, crates/tlsn-* | ✓ | ✓ | – | ✓ |
| C | tlsn-auto-claim | TLSN validation, generic HTTP condition, browser ext | ✓ | ✓ | – | ✓ |
| D | tlsn-airdrop-shield | TLSN validation, GitHub/Twitter templates, distribution | ✓ | ✓ | – | ✓ |
| E | prediction-market | conditional-swap, FROST signer, order book | ✓ | ✓ | ✓ | ✓ |
| F | bounty-board | UI shell across products, mobile/Expo | – | – | – | – |

## Shared core (極小、合計 ~1000 行 target)

| Lib | 中身 | 依存元 |
|-----|------|--------|
| `core-domain` | Query / Worker / Oracle 型、ステート遷移 | A,B,C,D,E |
| `core-cashu-bind` | proof ↔ Cashu HTLC binding、P2PK 2-of-2 boilerplate | A,B,C,D,E |
| `core-tlsn-conditions` | ReDoS-safe regex + jsonpath/contains evaluator + replay store | B,C,D,E |
| `core-nostr-dvm` | NIP-90 bounty event publish/discover helper | A,B,C,D,E |

## テスト継承マップ

| 既存テスト | 配置先 | 役割 |
|-----------|-------|------|
| `src/protocol-attacks.test.ts` | core-cashu-bind | HTLC / preimage 攻撃 |
| `src/protocol-exploits.test.ts` | core-cashu-bind | escrow exploit |
| `src/protocol-quorum.test.ts` | E (prediction-market) | FROST quorum 攻撃 |
| `src/protocol-trustless.test.ts` | core-domain | trustless invariants |
| `e2e/regtest-htlc-*.test.ts` | core-cashu-bind | Cashu HTLC E2E |
| `e2e/conditional-swap.test.ts` | E | conditional swap E2E |
| `e2e/frost-threshold.test.ts` | E | FROST E2E |
| `e2e/relay.test.ts` | core-nostr-dvm | Nostr relay E2E |
| `e2e/pentest/*.test.ts` | 全 product (関連分散) | penetration |
| `tlsn-validation.test.ts` | core-tlsn-conditions | TLSN 検証 |
| `c2pa-validation.test.ts` etc. | A | C2PA 検証 |
| 各 example のテスト | 各 product の integration | – |

## 抽出順序（葉から）

1. **Phase 1: Core 抽出**
   - 1a. core-domain
   - 1b. core-cashu-bind
   - 1c. core-tlsn-conditions
   - 1d. core-nostr-dvm
2. **Phase 2: 独立性高 product**
   - 2a. **A: photo-bounty** ← 最初に手をつける（TLSN 結合なし、最小依存）
   - 2b. E: prediction-market
3. **Phase 3: TLSN 系 product**
   - 3a. B: tlsn-fiat-swap（最も具体）
   - 3b. C: tlsn-auto-claim（B との差分で形が固まる）
   - 3c. D: tlsn-airdrop-shield
4. **Phase 4: 統合**
   - 4a. F: bounty-board UI
   - 4b. example/* を integration test として再構成

## Quality Gate（各抽出ステップで必ず通す）

抽出のたびに以下を pass：

1. 抽出先 product 単独で `deno task test` 全 pass
2. 該当 product の attack tests / penetration tests 全 pass
3. 元 monorepo の `deno task test:ci` 全 pass（regression なし）
4. 該当 product を使う `example/*` がそのまま動作

これを通らない限り次の抽出に進まない。

## Workspace 構成

monorepo を維持しつつ packages/ workspace 化：

```
anchr/
├── packages/
│   ├── core-domain/
│   ├── core-cashu-bind/
│   ├── core-tlsn-conditions/
│   ├── core-nostr-dvm/
│   ├── photo-bounty/
│   ├── tlsn-fiat-swap/
│   ├── tlsn-auto-claim/
│   ├── tlsn-airdrop-shield/
│   ├── prediction-market/
│   ├── bounty-board/
│   └── sdk/                 ← 既存 anchr-sdk
├── example/                 ← integration tests
├── crates/                  ← FROST + TLSN Rust crates
└── docs/
```

各 product 後日別 repo へ切り出すかは、抽出後に判断。

## 進捗ログ

このセクションに作業進捗を追記する。

### 2026-04-26
- ✅ 計画記録（このファイル）
- ✅ ベースライン test:ci 実行：**242 passed / 850 steps / 0 failed (7s)**
- ✅ Photo Bounty 依存解析完了
  - **photo-bounty owns**：`domain/geo.ts`、`verification/{c2pa,exif,proofmode,ai-content}-*.ts`
  - **残す（共有資産）**：`infrastructure/exif-strip*`（blossom/attachment-store が使用、privacy primitive）、`infrastructure/attachments`（一般 attachment handling）
  - **DI 化が必要**：`ai-content-check.ts`（`infrastructure/attachments` と `infrastructure/config` を内部参照）→ 後回し
- ✅ Sub-step 1: `geo.ts` を `packages/photo-bounty/src/geo.ts` に移動
  - 旧 path（`src/domain/geo.ts`）は re-export shim として維持（transition pattern）
  - 旧 test も並行維持（shim が機能することを検証）
  - 新 test pass：3/3 ok
  - 旧 test pass：3/3 ok（shim 経由）
  - `lint:arch`: ✓ no violations
  - 既存 consumer（`exif-validation.ts`）は変更なしで動作
- ✅ Sub-step 2: `c2pa-validation.ts` 抽出
  - canonical: `packages/photo-bounty/src/c2pa-validation.ts`（268 行）
  - 旧 path → re-export shim
  - runtime import：`../../runtime/mod.ts` → `../../../src/runtime/mod.ts`（**migration debt** コメント記録）
  - 新 test：4/4 ok、旧 test（shim 経由）：4/4 ok
  - `lint:arch` ✓、`test:ci` 全 242 passed
- ✅ Sub-step 3: `proofmode-validation.ts` 抽出
  - canonical: `packages/photo-bounty/src/proofmode-validation.ts`（280 行）
  - 旧 path → re-export shim、同 migration debt
  - 新 test + 旧 test（shim 経由）：2 passed (12 steps) ok
  - `lint:arch` ✓
- ✅ Sub-step 4: `exif-validation.ts` 抽出
  - canonical: `packages/photo-bounty/src/exif-validation.ts`（374 行）
  - **package 内 sibling import** に変更：`../../domain/geo` → `./geo`（package 構造の利点が初めて現れる）
  - 旧 path → re-export shim
  - 新 test + 旧 test：12 passed (26 steps) / 0 failed
  - `lint:arch` ✓

### 現状サマリ（2026-04-26 終了時点）

`packages/photo-bounty/src/` 配下：
- `geo.ts` + test
- `c2pa-validation.ts` + test
- `proofmode-validation.ts` + test
- `exif-validation.ts` + test

合計約 **930 行 + 4 test ファイル**。すべて canonical 化、`src/` 側は re-export shim。

**残作業**：
- `ai-content-check.ts`（DI refactor 必要：`infrastructure/attachments` と `infrastructure/config` を内部参照中）
- 旧 path consumer（`verifier.ts`、`worker-api-routes.ts`、`index.ts`）は shim 経由で動作中、抽出時に直接 import に書き換え予定
- Phase 4（example/* 再構成）で全 shim 削除

次のセッションで再開する場合の起点：**Task #9 (ai-content-check DI refactor)**。

### 2026-04-26（午後）— Photo Bounty Phase 1 完了

- ✅ Sub-step 5: `ai-content-check.ts` DI refactor + 抽出
  - canonical: `packages/photo-bounty/src/ai-content-check.ts`（193 行）
  - **DI 設計**：`createAiContentChecker({ getConfig, readAttachment })` factory
  - `getConfig: () => AiContentCheckConfig` を per-call で呼ぶことで env 変更を動的反映（既存テストの `withEnv` 挙動を維持）
  - `readAttachment(ref, blossomKey)` でホスト側の `readStoredAttachmentBuffer` を注入
  - 旧 path（`src/infrastructure/verification/ai-content-check.ts`）は **host adapter** として残存（pure shim ではなく wiring 役）
  - 新 test：5 sub-tests（DI 直接利用、`withEnv` 不要でクリーン）pass
  - 旧 test（adapter 経由）：5 sub-tests pass（既存挙動完全維持）

- ✅ Sub-step 6: Phase 4 — Consumer 書き換え + shim 削除
  - 6 consumer を package 直接 import に書き換え：
    - `src/infrastructure/verification/index.ts`（package 直接 export）
    - `src/infrastructure/verification/verifier.ts`（package import）
    - `src/infrastructure/verification/integrity-store.ts`（type import）
    - `src/infrastructure/verification/integrity-store.test.ts`（type import）
    - `src/infrastructure/attachment-store.ts`（c2pa, exif, proofmode）
    - `src/infrastructure/attachment-store-helpers.ts`（proofmode 型）
    - `src/infrastructure/worker-api-routes.ts`（haversineKm）
  - shim ファイル 9 個削除：
    - `src/domain/geo.ts`, `src/domain/geo.test.ts`
    - `src/infrastructure/verification/{c2pa,exif,proofmode}-validation.ts` + `.test.ts` × 3
    - `src/infrastructure/verification/ai-content-check.test.ts`（package test に移行済み）
  - 残した host adapter：`src/infrastructure/verification/ai-content-check.ts`（pure shim ではなく `createAiContentChecker` の wiring。host の env / storage を package に注入する役）

### Photo Bounty Phase 1 最終状態

`packages/photo-bounty/src/`：
| File | Lines | Tests |
|---|---|---|
| `geo.ts` | 13 | 3 ok |
| `c2pa-validation.ts` | 268 | 4 ok |
| `proofmode-validation.ts` | 280 | 6 ok |
| `exif-validation.ts` | 374 | 9 ok |
| `ai-content-check.ts` | 193 | 5 ok |
| **合計** | **1,128** | **8 tests / 27 steps** |

`src/` 側：
- shim 全削除（host-adapter `ai-content-check.ts` のみ残存、22 行の wiring）
- 6 consumer は packages/photo-bounty/ から直接 import

**migration debt（既知）**：
- `packages/photo-bounty/src/` から `../../../src/runtime/mod.ts` を参照（`core-runtime` 抽出時に解消）
- `packages/photo-bounty/src/ai-content-check.ts` から `../../../src/domain/types` を参照（`core-domain` 抽出時に解消）
- `geo.ts` は概念的には photo-bounty 専用ではない（worker-api-routes も使用）→ 将来 `core-domain` 抽出時に移動

次の Phase（Phase 2）：**E (prediction-market)** または **B (tlsn-fiat-swap)** からの抽出。Photo Bounty で migration pattern が確立。

### 確立した migration pattern（Photo Bounty で検証済み）

**5 sub-step サイクル**：

1. **依存解析**: `Grep "^import .* from"` で対象ファイルの import を列挙、内部依存（同 package 内へ）と外部依存（src/runtime, src/domain/types など）を分類
2. **Canonical 配置**: `packages/<product>/src/X.ts` に内容を複製、import path を新環境に合わせ、migration debt をコメント記録
3. **Shim 化**: 旧 path を re-export shim に変換、または DI を要する場合は host adapter として wiring
4. **両側 test 同時 pass**: 新 test（package 内）+ 旧 test（shim 経由）両方が pass することを確認、`lint:arch` clean、`test:ci` regression なし
5. **Phase 4 で shim 削除**: 全 consumer を package 直接 import に書き換え、shim ファイル削除、`test:ci` に packages/ を含める

**重要な学び**：
- `--ignore=packages/sdk/` を `--ignore` に追加して bun:test との衝突を回避
- DI が必要なケース（ai-content-check）は host adapter を残す方が consumer の書き換えコスト低い
- `packages/<product>/` を test:ci の対象に明示追加が必要（自動 discover されない）
- 各 product 抽出後に `deno task test:ci` を必ず走らせて baseline 維持を確認

**ベースライン推移**：
- 開始時: 242 passed / 850 steps
- Phase 1 完了時: 242 / 850（shim 経由で完全互換）
- Phase 4 完了時: 249 / 861（package テスト追加で増加、regression 0）
- tlsn-toolkit 抽出後: 250 / 861（verifier-tlsn.test.ts 追加）
- 最終: 250 / 861（全 4 core packages 抽出後、regression 0）

### 2026-04-26（夕方）— 全 core packages 抽出完了

抽出された 4 つの独立 core packages：

| Package | Files | Lines | Tests | 用途 |
|---|---|---|---|---|
| `packages/photo-bounty/` | 11 | ~1,200 | 9 / 28 steps | C2PA + GPS + ProofMode + AI 検証 |
| `packages/tlsn-toolkit/` | 5 | ~700 | 4 / 39 steps | TLSNotary application layer |
| `packages/cashu-frost-oracle/` | 10 | ~1,200 | 10 / 29 steps | FROST t-of-n cluster for Cashu P2PK |
| `packages/cashu-conditional-swap/` | 9 | ~1,500 | 18 / 45 steps | N:M binary outcome conditional swap |
| **合計** | **35** | **~4,600** | **41 tests / 141 steps** | |

加えて：
- 7 examples すべて working（auto-claim / c2pa-media-verification / tlsn-fiat-swap-square に独自 deno.json 追加完了）
- `test:ci` に全 packages/* 含むよう更新
- 全 5 commits、各 commit で test:ci + arch-lint + test:example 通過確認

### 達成した分離

**「Anchr Protocol」一枚岩 → 4 brand-neutral core packages + host server**：

```
packages/                       ← 独立利用可能な core libraries
├── photo-bounty/              ← Anchr-branded（multi-modal verification factor 抽象が独自価値）
├── tlsn-toolkit/              ← brand-neutral（TLSN を本番運用するための app layer）
├── cashu-frost-oracle/        ← brand-neutral（Cashu P2PK 用 FROST cluster）
├── cashu-conditional-swap/    ← brand-neutral（N:M binary outcome 共通プリミティブ）
└── sdk/                        ← 既存 anchr-sdk

src/                            ← Anchr server (host)
├── domain/                     ← server domain types
├── application/                ← server use cases
├── infrastructure/
│   ├── verification/          ← verifier orchestrator + ai-content-check host adapter
│   ├── frost/                  ← signer.ts、frost-escrow-provider.ts (host-coupled)
│   ├── cashu/                  ← escrow + wallet (将来 core-cashu に移動候補)
│   ├── nostr/                  ← Nostr 通信 (host)
│   ├── oracle/                 ← Oracle endpoint (host)
│   └── ...
└── runtime/                    ← Deno runtime helpers (将来 core-runtime に移動候補)

example/                        ← integration tests + 独自 deno.json
├── photo-bounty 系: c2pa-media-verification, supply-chain-proof
├── tlsn 系: tlsn-fiat-swap-square, auto-claim, airdrop-bot-shield
├── prediction-market           ← cashu-conditional-swap + cashu-frost-oracle 利用
└── bounty-board                ← UI shell (Expo)
```

### 残った migration debt（次のセッションでの抽出候補）

- `core-runtime`: `src/runtime/mod.ts` を独立 package に → 全 packages の `../../../src/runtime/...` 参照を解消
- `core-domain`: `src/domain/types.ts`、`src/domain/oracle-types.ts` を独立 package に → photo-bounty/ai-content-check, tlsn-toolkit, cashu-frost-oracle/config の参照を解消
- `core-cashu`: `src/infrastructure/cashu/escrow.ts`、`escrow-helpers.ts`、`src/infrastructure/preimage/preimage-store.ts` → cashu-conditional-swap が参照中

これらは **構造的負債ではなく単純な path 整理**で、必要に応じて段階的に解消可能。

### 確立した migration pattern (再掲)

各抽出は：
1. 依存解析（Grep）
2. Canonical 配置（packages/<product>/src/、`migration debt` コメント付き）
3. 旧 path を re-export shim 化 or host adapter 化
4. 新 test + 旧 test 両方 pass、`lint:arch` clean、`test:ci` regression 0
5. 全 consumer 更新後 shim 削除、test:ci に packages/ 追加

このパターンは **TypeScript / Deno project の段階的 monorepo split のテンプレート**として再利用可能。


### Migration pattern（記録）

各ファイル抽出は以下のサイクル：

1. 新 package に canonical 配置（`packages/<product>/src/X.ts`）
2. 旧 path を **re-export shim** に変換（`export { ... } from "../../packages/<product>/src/X";`）
3. 既存 test は両方 pass を確認
4. `lint:arch` clean
5. `test:ci` clean
6. consumer の import path 更新は当該 consumer 抽出時にまとめて

shim は Phase 4（example/* 再構成）で全 consumer 抽出完了後に削除。

