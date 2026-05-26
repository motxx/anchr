# Anchr Protocol カオスエンジニアリングレポート

**バージョン**: 1.0
**作成日**: 2026-04-06
**対象**: Anchr Protocol v0.x（TLSNotary + Cashu HTLC + Nostr NIP-90 + Blossom）
**実行環境**: Docker Compose regtest スタック

> **Status: historical snapshot.** This report records the 2026-04-06
> chaos-engineering analysis. It has not been kept in lockstep with the current
> Customer/Provider/Oracle vocabulary, `packages/bounty/src/...` layout, or
> resolved resilience fixes. Treat paths, code snippets, and recommendations
> below as historical context, not current implementation guidance. Use
> [`docs/resilience-checklist.md`](../resilience-checklist.md) for the current
> resilience review entry point.

---

## 目次

1. [概要と目的](#1-概要と目的)
2. [アーキテクチャと信頼モデルの再確認](#2-アーキテクチャと信頼モデルの再確認)
3. [障害モード分析](#3-障害モード分析)
4. [カオス実験カタログ](#4-カオス実験カタログ)
5. [プロトコル固有のエッジケース](#5-プロトコル固有のエッジケース)
6. [レジリエンス改善勧告](#6-レジリエンス改善勧告)
7. [実験実行チェックリスト](#7-実験実行チェックリスト)
8. [ゲームデイ計画](#8-ゲームデイ計画)

---

## 1. 概要と目的

### 1.1 背景

Anchr は TLSNotary（MPC-TLS 証明）、Cashu HTLC（Bitcoin エスクロー）、Nostr（NIP-90 DVM メッセージング）、Blossom（暗号化 Blob ストレージ）を組み合わせた分散型データマーケットプレイスである。Worker がサーバーの返答内容や撮影した写真を暗号学的に証明することで sats を獲得する。

このアーキテクチャの特性として、各コンポーネントが独立して障害を起こしうる上に、HTLC のタイムロック・preimage の単回開示・ステートマシン遷移という時間的に厳密な制約が存在する。カオスエンジニアリングの目的は、**これらの制約がコンポーネント障害下でも正しく機能することを確認し、失敗から学ぶこと**である。

### 1.2 定常状態（Steady State）の定義

実験前に以下の定常状態が成立していることを確認する。

| 指標 | 正常値 | 計測方法 |
|------|--------|----------|
| Nostr Relay 接続率 | 100%（設定 relay 全接続） | `ws://localhost:7777` への WebSocket 接続成功 |
| Cashu Mint 応答時間 | < 500ms | `GET /v1/info` のレスポンス時間 |
| Blossom アップロード成功率 | 100% | `PUT /upload` の HTTP 200 率 |
| TLSNotary Verifier 応答時間 | < 5s | `verify` コマンドの実行時間 |
| HTLC ロック→解放フロー完了率 | 100% | E2E テスト `regtest-htlc-trustless.test.ts` 合格率 |
| Oracle `/health` 応答 | `{"ok": true}` | HTTP 200 + JSON ボディ |
| クエリステートマシン整合性 | `status` が有効遷移のみ | `deno test src/domain/` 合格 |

### 1.3 爆風半径の制御方針

- すべての実験は **regtest 環境** で実施（メインネット接触なし）
- Docker Compose ネットワーク内に隔離（外部ネットワークから遮断）
- 実験単位で `docker compose restart <service>` によるロールバックを 30 秒以内に実行できること
- 実験中は `docker compose logs -f` でリアルタイム観測

---

## 2. アーキテクチャと信頼モデルの再確認

### 2.1 コンポーネント依存グラフ

```
Requester
  │
  ├─── Oracle HTTP（/hash, /verify, /preimage）
  │       └── PreimageStore（インメモリ Map）
  │
  ├─── Cashu Mint（:3338）── LND mint（:8081）── Bitcoind（regtest）
  │
  └─── Nostr Relay（:7777）
         │
         ├── Worker（kind 5300 購読）
         │     ├── TLSNotary Server（TCP :7047 / WS :7048）
         │     ├── Blossom Server（:3333）
         │     └── Oracle NIP-44 DM（kind 4）待機
         │
         └── Oracle（kind 6300, 7000 購読）
```

### 2.2 クリティカルパスと信頼境界

| パス | 信頼の根拠 | 残留リスク |
|------|------------|------------|
| Worker → TLSNotary Server | Verifier が独立した鍵シェアを保持 | Verifier 自体の単一障害点 |
| Oracle → Worker（preimage DM） | NIP-44 暗号化（X25519 + ChaCha20-Poly1305） | Relay の検閲・遅延 |
| Cashu Mint の HTLC 強制 | NUT-14 仕様（hashlock + P2PK） | Nutshell 0.19.2 が NUT-14 を完全実施しない問題（コード内コメントに明記）→ アプリ側で `verifyHtlcProofs()` による補完が必要 |
| Preimage 削除後の再配信不可 | `preimageStore.delete(hash)` after delivery | インメモリ → プロセス再起動で消失 |

---

## 3. 障害モード分析

### 3.1 Nostr Relay（port 7777）

#### 3.1.1 完全停止

**影響範囲:**
- Requester が kind 5300（Job Request）を発行できない → クエリ作成が停止
- Worker が kind 5300 を受信できない → 新規ジョブを発見できない
- Worker が kind 7000（feedback / selection）を受信できない → Worker 選択が進行しない
- Oracle が kind 4 DM（preimage）を Worker に届けられない → HTLC が最終的にタイムアウト
- `publishQueryToRelay()` は失敗をログ出力するが例外を発生させない（`catch (err) => console.error()`）→ クエリ自体は `defaultService.createQuery()` で作成されるが Nostr 反映なし

**コード参照:** `src/infrastructure/nostr/client.ts:publishEvent()` — `Promise.allSettled` を使うため全 relay 失敗でも例外は投げない

**現状の回復経路:** Relay 再起動後に Worker が再購読するが、再起動前の未配信イベントは失われる（nostr-rs-relay はオンライン時のみ relay する）

#### 3.1.2 遅延・パケットロス（部分障害）

**影響範囲:**
- 種別 7000 selection event が遅れると Worker が HTLC token を受け取れず、先に作業を開始する可能性がある
- Oracle DM が遅れると Worker が HTLC タイムアウト前に preimage を受け取れないリスクがある（min locktime = 600秒 ≒ 10分）
- 複数の Worker が同一クエリに対してそれぞれ quote を送り、Requester が複数の Worker に selection を送ってしまうリスク（実装上は最初の selection event を受けた Worker のみが続行する）

#### 3.1.3 Byzantine 動作（種別ごとの検閲）

**影響範囲:**
- Relay が kind 5300 のみブロック → Worker が新規クエリを発見できない（kind 4 DM は別種別なので preimage 配信は影響受けない）
- Relay が kind 4 DM のみブロック → preimage が Worker に届かず全 HTLC がタイムアウト → Requester に全額返金されるが Worker は無報酬

---

### 3.2 Cashu Mint（port 3338）

#### 3.2.1 完全停止（Phase 1 または Phase 2 中）

**Phase 1 中停止（createHtlcToken 呼び出し中）:**
- `loadAndSend()` の `wallet.loadMint()` が失敗 → `createHtlcToken()` が `null` を返す
- `requester-service.ts:createHtlcQuery()` が `if (!initialToken) return null` で早期リターン → クエリ作成失敗
- Nostr への kind 5300 発行は行われないため Worker への影響なし

**Phase 2 中停止（swapHtlcBindWorker 呼び出し中）:**
- `swapHtlcBindWorker()` が `null` を返す
- `requester-service.ts:selectWorker()` が `if (!finalToken) return null` → Worker 選択が完了しない
- Worker は kind 7000 selection を受け取れないまま待機状態
- Phase 1 トークン（平文 proofs）は Requester が保持したまま → Mint 復旧後に再試行可能だが再試行ロジックは未実装

**Mint 復旧後の再試行問題:**
- `getCashuWallet()` はシングルトン（`_wallet`）を返す。Mint が再起動した場合、`wallet.loadMint()` は再実行されるが keyset が変わった場合の対応が不明

#### 3.2.2 高遅延（swap タイムアウト）

- `escrow-helpers.ts:loadAndSend()` にはタイムアウト設定がなく、Mint が応答するまで無限待機
- 複数の HTLC swap が並行して詰まった場合、Deno のイベントループがブロックされる可能性

#### 3.2.3 Byzantine 動作（二重支出・トークン無効化）

**Nutshell 0.19.2 の NUT-14 未実施問題:**
- コード内（`escrow.ts:298`）に明記: "Nutshell 0.19.2 does NOT enforce NUT-14 spending conditions on /v1/swap"
- アプリ側の `verifyHtlcProofs()` が補完しているが、これはクライアント検証であり Mint 側の強制ではない
- つまり、Mint が直接攻撃を受けた場合（不正な /v1/swap リクエスト）、NUT-14 条件が Mint レベルで拒否される保証がない

**Mint の keyset ローテーション:**
- Mint が keyset をローテーションした場合、古い keyset の proofs は新しい keyset で検証できなくなる可能性がある
- `wallet.loadMint()` がローテーション後の keyset を正しく取得するかは未検証

---

### 3.3 TLSNotary Server（TCP 7047 / WS 7048）

#### 3.3.1 完全停止

- `tlsn-validation.ts:findTlsnVerifier()` でバイナリが見つからない場合、`verifierPath = null` となり検証が必ず失敗する
- "TLSNotary: tlsn-verifier binary not available — cannot verify presentation" エラーで検証失敗
- `available: false` を返す → `verifyTlsn()` で `failures` に追加 → `verify()` が `passed: false` を返す
- HTLC クエリの場合: Oracle が preimage を配信しない → Worker は HTLC タイムアウトで無報酬

**重要**: フォールバックなし（コメント: "When the binary is not available, verification FAILS (no fake structural fallback)"）はセキュリティ上正しい選択だが、運用上の SLA には影響する

#### 3.3.2 MPC-TLS セッション途中切断

- `runVerifierBinary()` は subprocess を spawn して結果を待つ
- TLSNotary Server（Docker コンテナ）が MPC handshake 中に落ちた場合:
  - `proc.exited` は解決するが `proc.exitCode !== 0`
  - stderr からエラーメッセージを取得（最大 200 文字）して `signatureValid: false` を返す
- Worker 側は半完成の `.presentation.tlsn` ファイルを持つが署名が不完全なため検証失敗
- Worker はリトライできるが、新規 TLSNotary セッションが必要（既存セッションの再開不可）

#### 3.3.3 高遅延

- `spawn()` の結果待機にタイムアウトがない
- 大きな presentation ファイルの検証が長時間かかる場合、Oracle の preimage 配信が遅れ、HTLC タイムアウトに近づく

---

### 3.4 Blossom Server（port 3333）

#### 3.4.1 完全停止（アップロード時）

- `blossom/client.ts:uploadToBlossom()` は `Promise.allSettled` で全 server への並行アップロードを試みる
- すべての server が失敗した場合: `if (successUrls.length === 0) return null`
- `worker-service.ts:encryptAndUpload()` が `null` を返す → Worker は kind 6300 result event を発行できない
- Oracle は blob を取得できず検証できない → Worker は無報酬

**回復経路の欠如:**
- Blossom server が復旧しても、Worker は再度アップロードと kind 6300 発行をやり直す必要がある
- 既に計算コストをかけた暗号化・EXIF ストリップが無駄になる

#### 3.4.2 アップロード成功後のダウンタイム（Oracle download 時）

- Worker が kind 6300 を発行した後、Oracle が blob をダウンロードしようとする際に Blossom が停止
- `downloadFromBlossom()` は全 server を順番に試みるが全失敗の場合 `null` を返す
- `fetchBlossomAttachment()` が `null` → `verifyC2paFromAttachments()` で "C2PA: could not retrieve attachment for verification" 失敗
- Oracle は検証できず preimage を配信しない → Worker は HTLC タイムアウトで無報酬
- **問題**: Blob は Worker がアップロード済みであり、Blossom が復旧すれば Oracle は再試行できるはずだが、Oracle は自動リトライをしない

#### 3.4.3 Blob の部分的破損

- `decryptBlob()` は AES-256-GCM の認証タグを検証するため、破損した blob は `TypeError: Decryption failed` をスロー
- `downloadFromBlossom()` の `catch { continue; }` でエラーが飲み込まれて次のサーバーを試みる
- 全 server が同じ破損 blob を持つ場合（単一アップロード）、回復不能

---

### 3.5 Oracle

#### 3.5.1 Oracle プロセス再起動（preimage 消失）

- `PreimageStore` はインメモリ `Map`（`preimage-store.ts`）
- Oracle プロセスが再起動すると `queryHashMap`（queryId → hash）と `preimageStore` が消える
- Requester が `/hash` で取得した hash と紐づく preimage が消える
- Worker が正しい証明を提出しても Oracle は preimage を見つけられない（`getPreimage(hash)` が `null` を返す）
- Oracle は `null` の preimage で DM を送らない → Worker は HTLC タイムアウトで無報酬
- **残留ハッシュ問題**: Cashu Mint には `hash` がエンコードされた proof が存在し続けるが、対応する preimage を持つ者がいなくなる → タイムアウト後 Requester が refund

**コード参照:** `oracle-server.ts:49-55` — `queryHashMap` と `verifiedQueries` が両方インメモリ。`preimageStore` も `createPreimageStore()` がインメモリ実装

#### 3.5.2 Oracle の検証遅延（HTLC タイムアウト競合）

- C2PA 検証（`validateC2pa()`）は外部バイナリ `c2patool` を subprocess で実行
- TLSNotary 検証も外部バイナリを subprocess で実行
- 複数の証明ファイルを順次検証する場合、合計検証時間が HTLC タイムアウトを超える可能性
- min locktime = 600 秒（10分）。大きな証明ファイルや低速環境では競合のリスク

#### 3.5.3 Oracle の Byzantine 動作（悪意的な不承認）

- 現在の信頼モデルでは Oracle の判定が最終（"oracle judgment is final" — `protocol-attacks.test.ts:216`）
- `trust-minimization-roadmap.md` に記載の通り、Oracle が条件を満たしているのに拒否することは技術的に可能
- k-of-n Oracle（quorum）は実装済み（`QuorumConfig`、`resolveMultiple()`）だが、単一 Oracle 構成はこのリスクに対して無防備

#### 3.5.4 Oracle の preimage 重複配信

- 現在のコード: `oracle-nostr-service.ts:113-120` で preimage 配信後に `preimageStore.delete(hash)` を実行
- しかし `oracle-server.ts` では `/preimage` エンドポイントで `verifiedQueries` を確認するが `preimageStore.delete()` を**呼ばない**
- HTTP フローと Nostr フローで preimage 削除の一貫性がない → HTTP フロー経由で preimage を2回取得できる可能性

**コード参照:** `oracle-server.ts:149-171` — `preimage` 取得後に削除処理がない

---

### 3.6 Lightning / Bitcoind（regtest）

#### 3.6.1 LND-mint 停止

- Cashu Mint は `lnd-mint` を LND REST バックエンドとして使用
- `lnd-mint` が停止すると Cashu Mint は Lightning invoice の作成・決済ができない
- `docker-compose.yml`: `cashu-mint` は `lnd-mint` の依存を持ち、`restart: on-failure` → LND 復旧後に自動再起動するが初回の mint/swap 操作は失敗

#### 3.6.2 Bitcoind 停止

- `lnd-mint` と `lnd-user` が両方 `bitcoind` に依存
- Bitcoind 停止 → 両 LND が ZMQ 購読を失い、新しいブロックを認識できない
- regtest でのブロック生成が止まる → Lightning チャネルのファンディング確認が進まない

---

## 4. カオス実験カタログ

以下の実験は Docker Compose 環境で実行可能。各実験は独立して実施できる。

---

### 実験 CE-001: Nostr Relay 完全停止（クエリ発行中）

**カテゴリ:** インフラ障害
**対象コンポーネント:** Nostr Relay
**優先度:** 高

**仮説:**
Relay が停止していても `createQuery()` はクエリ内部状態を作成する。Relay への発行は非同期・非ブロッキングで失敗するが、クエリオブジェクトは返される。HTLC フローは Relay なしでは進行できない。

**注入方法:**
```bash
# Relay を停止
docker compose stop relay

# Requester 側でクエリを作成（HTTP API 経由）
curl -X POST http://localhost:8000/api/queries \
  -H "Content-Type: application/json" \
  -d '{"description": "chaos-test", "ttl_seconds": 600}'
```

**観測ポイント:**
- API レスポンス: 200（クエリ作成成功）か 500 か
- サーバーログ: `[relay] Failed to publish query:` が出力されるか
- クエリ状態: `GET /api/queries/{id}` で `status: "awaiting_quotes"` のままか
- Worker ログ: 新規クエリを受信するログが出ないこと

**爆風半径:**
- 実験中に発行したクエリは Worker に届かないため自動的に `expired` に遷移する
- 既存の進行中クエリへの影響なし（Relay 停止前に受信済みの quote/selection には影響なし）

**ロールバック:**
```bash
docker compose start relay
# 30秒以内に WebSocket 接続が復旧することを確認
```

**成功基準:**
- クエリ作成 API は 200 を返す（Relay 依存でブロックされない）
- ログに警告が出力される
- Relay 復旧後に Worker が新規クエリを受信できる

**既存テスト対応:** `src/infrastructure/nostr/client.test.ts`

---

### 実験 CE-002: Relay 復旧後のイベント再送信テスト

**カテゴリ:** 回復テスト
**対象コンポーネント:** Nostr Relay
**優先度:** 中

**仮説:**
Relay が停止中に発行しようとした kind 5300 イベントは失われる（再送信なし）。Relay 復旧後、新しいクエリは正常に発行される。

**注入方法:**
```bash
# 1. Relay を停止してクエリを作成（5300 発行失敗を誘発）
docker compose stop relay
curl -X POST http://localhost:8000/api/queries -d '{"description": "lost-event-test"}'

# 2. Relay を起動
docker compose start relay
sleep 5

# 3. 新しいクエリを作成（今度は成功するはず）
curl -X POST http://localhost:8000/api/queries -d '{"description": "post-recovery-test"}'
```

**観測ポイント:**
- 停止中に作成したクエリが Relay 復旧後も Worker に届かないこと
- 復旧後に作成したクエリが正常に Worker に届くこと

**成功基準と改善機会:**
- 現状: 失われたイベントは再送信されない（設計上の弱点）
- 改善案: `onCreated` フックに再試行ロジックを追加（後述 R-001）

---

### 実験 CE-003: Cashu Mint 停止（Phase 2 swap 途中）

**カテゴリ:** インフラ障害
**対象コンポーネント:** Cashu Mint
**優先度:** 高（資金リスクに直結）

**仮説:**
Phase 2 の `swapHtlcBindWorker()` 呼び出し中に Mint が停止すると、`null` が返され Worker 選択が完了しない。Phase 1 トークン（plain proofs）は Requester が保持したままであり、Mint 復旧後に再試行できる。

**注入方法:**
```bash
# E2E 環境のセットアップ
docker compose up -d
sleep 30
./scripts/init-regtest.sh
docker compose restart cashu-mint

# Phase 2 swap 中に Mint を停止するタイミングを狙う
# （Requester の selectWorker() を呼び出す HTTP API を叩きながら）
docker compose stop cashu-mint &
curl -X POST http://localhost:8000/api/queries/{queryId}/select-worker \
  -H "Content-Type: application/json" \
  -d '{"worker_pubkey": "..."}'
```

**Deno テストとして実行:**
```typescript
// e2e/cashu-fault.test.ts に追加
test("swap fails gracefully when mint is unreachable", async () => {
  process.env.CASHU_MINT_URL = "http://localhost:9999"; // 存在しない URL
  const result = await swapHtlcBindWorker(validProofs, params);
  expect(result).toBeNull(); // null が返ること
});
```

**観測ポイント:**
- `swapHtlcBindWorker()` が `null` を返すこと（例外を投げないこと）
- `selectWorker()` が `{ ok: false }` を返すこと
- Phase 1 proofs が重複使用されていないこと（Mint に送信された場合は spent になっている）

**爆風半径:**
- Phase 1 proofs が swap コール中に Mint で使用済みになった場合、Requester は proofs を失う
- Mint がロールバック（transaction atomicity）をサポートするかに依存

**ロールバック:**
```bash
docker compose start cashu-mint
sleep 10
```

---

### 実験 CE-004: Blossom Server 完全停止（Worker アップロード中）

**カテゴリ:** インフラ障害
**対象コンポーネント:** Blossom Server
**優先度:** 高

**仮説:**
Blossom が停止中は `uploadToBlossom()` が `null` を返す。Worker は kind 6300 を発行できず、作業が無駄になる。HTLC はタイムアウトで Requester に返金される。

**注入方法:**
```bash
docker compose stop blossom

# Worker が blob をアップロードしようとするシナリオを作成
# (既存 E2E テストを部分実行)
BLOSSOM_SERVERS=http://localhost:3333 \
CASHU_MINT_URL=http://localhost:3338 \
NOSTR_RELAYS=ws://localhost:7777 \
deno test --allow-all e2e/regtest-cashu.test.ts --filter "upload"
```

**Deno 単体テストとして:**
```typescript
// src/infrastructure/blossom/client.test.ts に追加
test("uploadToBlossom returns null when all servers are down", async () => {
  process.env.BLOSSOM_SERVERS = "http://localhost:9999";
  const data = new Uint8Array([1, 2, 3]);
  const identity = generateEphemeralIdentity();
  const result = await uploadToBlossom(data, identity);
  expect(result).toBeNull();
});
```

**観測ポイント:**
- `uploadToBlossom()` が `null` を返すこと
- ログ: "Upload to http://localhost:3333 failed: 500" 等が出力されること
- HTLC が残留し、タイムアウト後に Requester refund が可能なこと

**成功基準:**
- データ損失なし（Worker は再試行可能な状態）
- ログに明確なエラーメッセージ

---

### 実験 CE-005: Blossom Server 停止（Oracle ダウンロード中）

**カテゴリ:** インフラ障害
**対象コンポーネント:** Blossom Server
**優先度:** 高

**仮説:**
Worker が kind 6300 を発行した後 Blossom が停止すると、Oracle は blob をダウンロードできず検証に失敗する。Oracle は preimage を配信しない。

**注入方法:**
```bash
# 1. Worker のアップロードを完了させる
# 2. kind 6300 の発行直後に Blossom を停止
docker compose stop blossom

# 3. Oracle が /verify を呼び出すのを観測
docker compose logs oracle
```

**Deno テストとして:**
```typescript
// src/infrastructure/verification/verifier.test.ts に追加
test("verification fails with clear error when blossom blob unavailable", async () => {
  const query = makeTestQuery({ verification_requirements: ["gps"] });
  const result: QueryResult = {
    attachments: [{
      id: "att-1",
      uri: "http://localhost:9999/deadbeef",  // 存在しない URL
      mime_type: "image/jpeg",
      storage_kind: "blossom",
      blossom_hash: "deadbeef",
      blossom_servers: ["http://localhost:9999"],
    }],
  };
  const blossomKeys = { "att-1": { encrypt_key: "aa".repeat(32), encrypt_iv: "bb".repeat(12) } };

  const detail = await verify(query, result, blossomKeys);
  expect(detail.passed).toBe(false);
  expect(detail.failures.some(f => f.includes("C2PA: could not retrieve attachment"))).toBe(true);
});
```

**改善機会:** Oracle 側にリトライロジックを追加（後述 R-003）

---

### 実験 CE-006: TLSNotary verifier バイナリ欠落

**カテゴリ:** アプリケーション障害
**対象コンポーネント:** TLSNotary Verifier
**優先度:** 高

**仮説:**
`tlsn-verifier` バイナリが存在しない場合、検証は偽のパスではなく明示的な失敗を返す。

**注入方法:**
```bash
# tlsn-verifier バイナリを一時的にリネーム
mv crates/tlsn-verifier/target/release/tlsn-verifier \
   crates/tlsn-verifier/target/release/tlsn-verifier.bak
```

**Deno テスト（既存）:**
```typescript
// src/infrastructure/verification/tlsn-validation.test.ts に既存
// _setVerifierPathForTest(null) でバイナリ欠落をシミュレート
```

**観測ポイント:**
- `isTlsnVerifierAvailable()` が `false` を返すこと
- `validateTlsn()` が `available: false`, `signatureValid: false` を返すこと
- failures に "tlsn-verifier binary not available" が含まれること
- `verify()` が `passed: false` を返すこと

**成功基準:** フォールバックなし（現状の実装は正しい）

---

### 実験 CE-007: Oracle プロセス再起動（preimage 消失）

**カテゴリ:** アプリケーション状態障害
**対象コンポーネント:** Oracle
**優先度:** 最高（資金消失リスク）

**仮説:**
Oracle が再起動すると `PreimageStore`（インメモリ）が消える。Worker が正しい証明を提出しても Oracle は preimage を配信できない。HTLC は最終的にタイムアウトで Requester に返金される。

**注入方法:**
```bash
# 1. Requester がクエリを作成（Oracle に /hash を要求）
# 2. Worker が選択され、処理を開始
# 3. Oracle を再起動
docker compose restart oracle  # または kill & restart

# 4. Worker が証明を提出（kind 6300 発行）
# 5. Oracle が種 6300 を受信するが preimage が見つからない
docker compose logs oracle
# 期待: "No preimage found for this query"
```

**Deno テストとして:**
```typescript
// oracle-preimage-persistence.test.ts（新規）
test("preimage store is lost on oracle restart (documents current limitation)", () => {
  const store = createPreimageStore();
  const entry = store.create();

  // 新しいストアインスタンス（= 再起動後の状態）
  const newStore = createPreimageStore();

  // 再起動後は preimage が存在しない
  expect(newStore.getPreimage(entry.hash)).toBeNull();

  // これは既知の制限 — 永続化が必要
});
```

**爆風半径:**
- 再起動前に `/hash` を発行済みの全クエリが影響を受ける
- HTLC の locktime が有効な間は Requester への自動返金で資金は回収可能
- locktime 切れ後に Requester が refund 手続きをしなければ sats が宙ぶらりんになる

**ロールバック:** `docker compose start oracle`

**成功基準（現状）:**
- Oracle がエラーログを出力すること（静かに失敗しないこと）
- HTLC タイムアウト後に Requester が refund できること

---

### 実験 CE-008: HTLC タイムアウト競合（証明提出ぎりぎり）

**カテゴリ:** タイミング・レース条件
**対象コンポーネント:** Cashu Mint, Oracle
**優先度:** 最高

**仮説:**
Worker が HTLC タイムアウト直前に preimage を受け取った場合、Cashu Mint への swap（redeem）がタイムアウト後に到達しても Mint は拒否しない（NUT-14 の preimage パスはロックタイム無関係）。

**コード根拠:** `e2e/regtest-htlc-attacks.test.ts:334` — "Worker redeems with expired locktime — succeeds (locktime only affects refund path)"

**注入方法:**
```bash
# タイムアウト間際のシミュレーション
# 短い locktime（70秒）でクエリを作成
CASHU_MINT_URL=http://localhost:3338 \
NOSTR_RELAYS=ws://localhost:7777 \
deno run --allow-all scripts/create-query-short-locktime.ts

# 65秒待機（タイムアウト5秒前）
sleep 65

# Worker が preimage を受け取って swap を試みる
# → Mint は locktime 経過後も preimage パスで受け入れるか検証
```

**観測ポイント:**
- Mint が `locktime` 経過後の preimage swap を受け入れること
- Requester の refund と Worker の redeem が同時に起きた場合の動作
- Cashu Mint の spent tracking が double-spend を防ぐこと

**成功基準:**
- 先に swap を完了した側が受理される
- 後から来たほうは "proofs already spent" で拒否される
- 資金が二重に出ない

---

### 実験 CE-009: Nostr Relay による種別 4 DM 検閲

**カテゴリ:** Byzantine 障害
**対象コンポーネント:** Nostr Relay
**優先度:** 高

**仮説:**
Relay が kind 4 DM イベントを検閲すると、Oracle の preimage が Worker に届かない。Worker は待機し続け、最終的に HTLC がタイムアウトする。

**注入方法（カスタム Relay 設定）:**
```bash
# nostr-rs-relay の設定ファイルを書き換えて kind 4 をブロック
cat > relay-config-no-dm.toml << EOF
[limits]
allowed_kinds = [5300, 6300, 7000]  # kind 4 を除外
EOF

docker compose stop relay
docker run -v ./relay-config-no-dm.toml:/usr/src/app/config.toml \
  -p 7777:8080 scsibug/nostr-rs-relay:latest &
```

**Deno テスト（モックで確認）:**
```typescript
// src/infrastructure/oracle/oracle-nostr-service.test.ts に追加
test("preimage delivery fails gracefully when relay blocks kind 4 DMs", async () => {
  const mockPublish = async () => ({ successes: [], failures: ["relay blocked kind 4"] });
  _setPublishEventForTest(mockPublish);

  const service = createOracleNostrService({ identity: testIdentity });
  // verifyAndDeliver は DM 配信失敗後も false を返すこと（クラッシュしないこと）
  const result = await service.verifyAndDeliver(queryId, query, result, workerPubkey);
  // Worker への通知が失敗しても内部状態は壊れていない
  // （ただし現在の実装では DM 送信失敗をログのみで処理）
});
```

**観測ポイント:**
- Oracle ログ: DM 送信失敗のエラー出力
- Worker ログ: preimage 待機のタイムアウト
- HTLC タイムアウト後: Requester が refund できること

---

### 実験 CE-010: Oracle の HTTP 経由 preimage 二重取得

**カテゴリ:** プロトコル整合性
**対象コンポーネント:** Oracle HTTP サーバー
**優先度:** 中

**仮説:**
`oracle-server.ts` の `/preimage` エンドポイントは `verifiedQueries.get(query_id)` で済み確認をするが、配信後に `preimageStore.delete()` を呼ばない。同じ `query_id` で2回 `/preimage` を叩くと2回 preimage を取得できる。

**注入方法:**
```bash
# 1. /hash でハッシュ取得
curl -X POST http://localhost:4000/hash \
  -H "Authorization: Bearer test-key" \
  -d '{"query_id": "test-q-1"}'

# 2. /verify で検証 pass させる
curl -X POST http://localhost:4000/verify \
  -H "Authorization: Bearer test-key" \
  -d '{"query": {...}, "result": {...}}'

# 3. /preimage を2回叩く
curl -X POST http://localhost:4000/preimage \
  -H "Authorization: Bearer test-key" \
  -d '{"query_id": "test-q-1"}'

curl -X POST http://localhost:4000/preimage \
  -H "Authorization: Bearer test-key" \
  -d '{"query_id": "test-q-1"}'
# → 2回目も同じ preimage が返るはず（バグ）
```

**Deno テストとして:**
```typescript
// src/infrastructure/oracle/oracle-server.test.ts に追加
test("preimage endpoint returns 404 on second request (idempotency check)", async () => {
  const app = buildOracleApp({ oracleId: "test", apiKey: "secret" });

  // セットアップ: hash 生成と検証通過
  await app.fetch(makeHashRequest("q1"));
  await app.fetch(makeVerifyRequest("q1", { passed: true }));

  // 1回目: 成功
  const first = await app.fetch(makePreimageRequest("q1"));
  expect(first.status).toBe(200);

  // 2回目: 404（preimage が削除されているべき）
  const second = await app.fetch(makePreimageRequest("q1"));
  expect(second.status).toBe(404);  // 現状は 200 → バグ
});
```

**成功基準（現状はバグ）:**
- 2回目の `/preimage` は 404 を返すべき

---

### 実験 CE-011: 複数 Worker による同一クエリへの並行 quote

**カテゴリ:** レース条件
**対象コンポーネント:** QueryService, Nostr Relay
**優先度:** 中

**仮説:**
複数の Worker が同じクエリに quote を送った場合、Requester が選択するまでは `quotes` リストに蓄積される。選択されなかった Worker は kind 7000 selection event を受信後に `onRejected()` を呼ぶ。

**Deno テストとして（既存テストの拡張）:**
```typescript
// src/application/query-service.test.ts に追加
test("multiple workers can quote, only selected worker proceeds", async () => {
  const service = createQueryService();
  const escrowInfo = makeEscrowInfo(preimageStore).escrowInfo;

  const query = service.createQuery({ description: "multi-quote" }, { escrow: escrowInfo });

  // 5人の Worker が同時に quote を送る
  for (let i = 0; i < 5; i++) {
    service.recordQuote(query.id, {
      worker_pubkey: `worker_${i}`,
      quote_event_id: `e_${i}`,
      received_at: Date.now(),
    });
  }

  // Requester が worker_2 を選択
  await service.selectWorker(query.id, "worker_2", makeFakeToken(100));

  const updated = service.getQuery(query.id)!;
  expect(updated.htlc!.worker_pubkey).toBe("worker_2");
  expect(updated.status).toBe("processing");
  expect(updated.quotes!.length).toBe(5);  // 全 quote は記録される

  // 選択されなかった Worker が送る result は拒否される
  const outcome = await service.submitEscrowResult(query.id, { attachments: [] }, "worker_0", "test-oracle");
  expect(outcome.ok).toBe(false);
  expect(outcome.message).toContain("does not match");
});
```

---

### 実験 CE-012: MPC-TLS セッション途中切断シミュレーション

**カテゴリ:** アプリケーション障害
**対象コンポーネント:** TLSNotary Server
**優先度:** 高

**仮説:**
TLSNotary Docker コンテナが MPC handshake 中に落ちた場合、`runVerifierBinary()` は非ゼロ exit code で終了し、`signatureValid: false` を返す。検証は明示的に失敗する。

**注入方法:**
```bash
# MPC-TLS セッション中にコンテナを強制終了
docker compose kill tlsn-verifier

# ログ確認
docker compose logs
```

**E2E テストとして:**
```bash
CASHU_MINT_URL=http://localhost:3338 \
NOSTR_RELAYS=ws://localhost:7777 \
BLOSSOM_SERVERS=http://localhost:3333 \
deno test --allow-all e2e/tlsn.test.ts
```

**観測ポイント:**
- `runVerifierBinary()` が error を含む `{ signatureValid: false, error: "..." }` を返すこと
- エラーメッセージが stderr から正しく取得されること（最大 200 文字）
- Worker がリトライできる状態であること（新規セッションが必要）

---

### 実験 CE-013: Cashu Mint の NUT-14 非強制問題の検証

**カテゴリ:** プロトコル整合性（セキュリティ）
**対象コンポーネント:** Cashu Mint, アプリ側 HTLC 検証
**優先度:** 最高

**仮説:**
Nutshell 0.19.2 は NUT-14 HTLC 条件を /v1/swap で強制しない。アプリ側の `redeemHtlcToken()` が `verifyHtlcSpendAuth()` で事前検証しているため、HTLC 条件は client-side で強制される。

**既存テスト（実行可能）:**
```bash
docker compose up -d
sleep 30
./scripts/init-regtest.sh
docker compose restart cashu-mint

CASHU_MINT_URL=http://localhost:3338 \
NOSTR_RELAYS=ws://localhost:7777 \
BLOSSOM_SERVERS=http://localhost:3333 \
deno test --allow-all e2e/regtest-htlc-trustless.test.ts
```

**追加検証（Mint への直接リクエスト）:**
```bash
# アプリの cashu-ts client を経由せず直接 /v1/swap を叩く
# preimage なし + 正しい Worker key のみで swap を試みる
curl -X POST http://localhost:3338/v1/swap \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": [{"amount": 64, "id": "...", "secret": "...", "C": "..."}],
    "outputs": [...]
  }'
# → 200 が返ってきた場合、Mint は NUT-14 を強制していないことを確認
```

---

### 実験 CE-014: クエリ有効期限とステートマシン整合性

**カテゴリ:** タイミング障害
**対象コンポーネント:** QueryService
**優先度:** 中

**仮説:**
`expireQueries()` が実行されると `processing` 状態のクエリも `expired` に遷移する。その後 Worker が result を submit しても拒否される。

**既存テスト（確認）:**
```bash
deno test --allow-all src/protocol-attacks.test.ts \
  --filter "submit result to expired query fails"
```

**追加テスト（実際の時間経過）:**
```typescript
// src/domain/query-aggregate.test.ts に追加
test("query expires during verifying state — leaves HTLC unresolved", () => {
  // EXPIRABLE_STATUSES に "verifying" が含まれていないことを確認
  // → verifying 中の query は expire されない（設計確認）
  expect(isExpirable("verifying")).toBe(false);

  // processing 中は expire 可能
  expect(isExpirable("processing")).toBe(true);
});
```

---

### 実験 CE-015: マルチ Oracle クォーラム分割（1/3 パス）

**カテゴリ:** Oracle 障害
**対象コンポーネント:** Oracle Registry, QueryService
**優先度:** 中

**既存テスト（確認）:**
```bash
deno test --allow-all src/protocol-attacks.test.ts \
  --filter "quorum split: 1 pass \+ 2 fail"
```

**追加シナリオ（1 Oracle 応答なし）:**
```typescript
test("quorum: 1 oracle timeout, 2 pass — still approved if min_approvals=2", async () => {
  const slowOracle = {
    info: { id: "slow-oracle" },
    verify: async () => {
      await new Promise(r => setTimeout(r, 10000)); // 10秒タイムアウト
      return { passed: true, checks: [], failures: [] };
    }
  };
  // resolveMultiple が slow-oracle を含む 3 Oracle を返す設定
  // min_approvals: 2 で 2 つが pass すれば承認されるべき
  // → 現在の実装では全 Oracle を await するため slow-oracle がボトルネックに
});
```

---

## 5. プロトコル固有のエッジケース

### 5.1 HTLC タイムアウトレース（Worker が locktime ぎりぎりで preimage を受け取る）

**発生シナリオ:**
1. Worker が証明を提出（kind 6300 発行）
2. Oracle が C2PA 検証中（外部バイナリ起動で時間がかかる）
3. HTLC locktime が切れる
4. Requester が refund を実行
5. Oracle が検証完了し preimage を DM で配信
6. Worker が preimage を受け取り swap を試みる

**現在の動作:**
- Cashu の NUT-14 の preimage パスは locktime 後も有効（`regtest-htlc-attacks.test.ts:334` で確認済み）
- Requester の refund と Worker の swap が競合した場合、先に Mint に到達した方が勝つ
- `verifyHtlcProofs()` はタイムスタンプをチェックしない（hashlock + P2PK のみ）

**リスク:**
- 競合ウィンドウ（locktime 切れ後、Worker の swap 前）で Requester が refund 成功した場合、Worker は無報酬
- Oracle が意図的に検証を遅らせることで Requester 有利の競合を作れる

**推奨テスト:**
```bash
# locktime = 現在時刻 + 90秒 で作成し、
# Oracle 検証を 80秒遅延させた上で Worker が swap を試みる
```

### 5.2 Nostr DM 重複受信（preimage が2回届く）

**発生シナリオ:**
- Oracle が DM を発行後にリレー接続が切れ、再接続時に同じ DM が再度配信される
- Worker の `subscribeToDMs()` の `onevent` ハンドラが2回呼ばれる

**現在の動作:**
- `waitForPreimage()` の `onPreimage` コールバックは複数回呼ばれる可能性がある
- `redeemHtlcToken()` を2回呼んでも2回目は spent proofs として Mint が拒否する（安全）
- ただし、アプリ層で「preimage 受信済み」のフラグを持たないため、ループに入る可能性

**推奨テスト:**
```typescript
test("duplicate preimage DM does not cause double redemption attempt", async () => {
  let redeemCount = 0;
  const mockRedeem = async (proofs: Proof[], preimage: string, privkey: string) => {
    redeemCount++;
    if (redeemCount > 1) return null; // 2回目は spent
    return { token: "valid", proofs: [], amountSats: 100 };
  };

  // onPreimage が2回呼ばれても redeemCount が 1 であること
});
```

### 5.3 Blossom Blob の可用性消失（Worker 発行後）

**発生シナリオ:**
- Worker が Blossom にアップロード成功、kind 6300 を発行
- Blossom server がディスク満杯または管理者によって削除
- Oracle が blob を取得しようとするが失敗

**現在の動作:**
- `downloadFromBlossom()` は全 server を試みるが全失敗で `null`
- Oracle は "C2PA: could not retrieve attachment for verification" で失敗判定
- Worker は無報酬（作業コストは既に払っている）

**保護策の不在:**
- Worker は blob の永続性を保証できない
- Oracle はリトライをしない
- 複数の Blossom server への冗長アップロードが唯一の軽減策（現在サポート済み）

### 5.4 Oracle の preimage 保持拒否

**発生シナリオ:**
- Oracle が C2PA 検証を `passed: false` と判定（不正 or バグ）
- Worker は `rejection` DM を受け取り、HTLC タイムアウトまで待機
- Requester は HTLC タイムアウト後に refund

**現在の動作:**
- `verifiedQueries.set(query.id, true)` は `/verify` で `passed: true` の場合のみ設定
- `/preimage` は `verifiedQueries.get(query.id)` が `false/undefined` の場合 403 を返す
- Nostr フローでは `oracle-nostr-service.ts:113` で `detail.passed` の場合のみ preimage を送信

**保護されていない場合:**
- Oracle が `passed: true` を内部に設定した後にプロセスがクラッシュした場合、`verifiedQueries` も消える
- 再起動後の Oracle は "Verification has not passed" を返す → Worker は preimage を取得できない

### 5.5 NIP-44 DM の復号失敗（鍵不整合）

**発生シナリオ:**
- Oracle が誤った Worker 公開鍵で preimage DM を暗号化
- または Worker がエフェメラル鍵を再生成した（`generateEphemeralIdentity()`）

**現在の動作:**
- `parseOracleDM()` は `decryptNip44()` を呼び、失敗は例外をスローする
- `worker-service.ts:waitForPreimage()` の `catch { }` でエラーを飲み込む
- Worker は "Cannot decrypt, not for us" として無視する

**問題:**
- 正当な DM が復号失敗した場合と別 Worker 宛ての DM が届いた場合を区別できない
- Worker は永遠に待機し続け（HTLC タイムアウトまで）

### 5.6 クエリ状態の `verifying` 中の expiry 不可問題

**現在の動作:**
- `EXPIRABLE_STATUSES = ["pending", "awaiting_quotes", "worker_selected", "processing"]`
- `"verifying"` は expirable に含まれていない（`query-transitions.ts:22`）

**影響:**
- Oracle が検証を完了しないまま（バグ、クラッシュ、意図的な拒否）放置すると、クエリが `verifying` 状態に永遠にとどまる
- Requester も Worker も HTLC を解決できない（refund も redemption もできない状態）
- Cashu Mint 側の HTLC タイムアウトは機能するが、アプリの query state は stale のまま

---

## 6. レジリエンス改善勧告

### R-001: Nostr イベント発行のリトライロジック追加

**対象:** `src/application/query-service.ts:publishQueryToRelay()`
**重要度:** 中
**工数目安:** 1日

**現状:**
```typescript
// 発行失敗をログ出力するだけ
const result = await publishEvent(event);
if (result.successes.length > 0) {
  console.error(`[relay] Query ${query.id} published ...`);
}
// 失敗時の再試行なし
```

**推奨実装:**
```typescript
async function publishQueryToRelayWithRetry(query: Query, maxRetries = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await publishEvent(event);
    if (result.successes.length > 0) return;

    if (attempt < maxRetries) {
      const delayMs = attempt * 2000; // 指数バックオフ
      console.error(`[relay] Retry ${attempt}/${maxRetries} in ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  console.error(`[relay] Failed to publish query after ${maxRetries} attempts`);
}
```

---

### R-002: PreimageStore の永続化

**対象:** `src/infrastructure/cashu/preimage-store.ts`
**重要度:** 最高（資金リスク）
**工数目安:** 2日

**現状:** インメモリ `Map` → Oracle 再起動で全データ消失

**推奨実装:**
```typescript
// SQLite ベース永続ストア（既存の jobs.db を活用）
import Database from "npm:better-sqlite3";

export function createPersistentPreimageStore(dbPath = "./oracle-preimage.db"): PreimageStore {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS preimages (
    hash TEXT PRIMARY KEY,
    preimage TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  return {
    create() {
      const { hash, preimage } = createHTLCHash();
      db.prepare("INSERT INTO preimages VALUES (?, ?, ?)")
        .run(hash, preimage, Date.now());
      return { hash, preimage, created_at: Date.now() };
    },
    getPreimage(hash) {
      return (db.prepare("SELECT preimage FROM preimages WHERE hash = ?")
        .get(hash) as any)?.preimage ?? null;
    },
    delete(hash) {
      db.prepare("DELETE FROM preimages WHERE hash = ?").run(hash);
    },
    // ...
  };
}
```

**テスト方法:**
```bash
# oracle-server を起動してハッシュを発行
curl -X POST http://localhost:4000/hash -d '{"query_id": "persist-test"}'

# Oracle プロセスを再起動
docker compose restart oracle  # または kill & start

# 再起動後もハッシュが取得できること
curl -X GET http://localhost:4000/hash/persist-test
# → 200 が返ることを確認
```

---

### R-003: Blossom ダウンロード時のリトライ（Oracle 側）

**対象:** `src/infrastructure/oracle/oracle-nostr-service.ts:handleResponseEvent()`
**重要度:** 高
**工数目安:** 1日

**現状:** Oracle は kind 6300 受信時に1回だけ blob をダウンロード試行する。失敗すると rejection DM を送信。

**推奨実装:**
```typescript
async function downloadWithRetry(
  hash: string,
  encryptKey: string,
  encryptIv: string,
  servers: string[],
  maxRetries = 3,
  delayMs = 5000,
): Promise<Uint8Array | null> {
  for (let i = 0; i < maxRetries; i++) {
    const data = await downloadFromBlossom(hash, encryptKey, encryptIv, servers);
    if (data) return data;

    if (i < maxRetries - 1) {
      console.error(`[oracle] Blossom download failed (attempt ${i+1}/${maxRetries}), retrying in ${delayMs}ms`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return null;
}
```

---

### R-004: Oracle HTTP `/preimage` のべき等性修正

**対象:** `src/infrastructure/oracle/oracle-server.ts:app.post("/preimage")`
**重要度:** 中（セキュリティ）
**工数目安:** 0.5日

**現状のバグ:** preimage 配信後にストアから削除しない

**修正:**
```typescript
app.post("/preimage", authMiddleware, async (c) => {
  // ... 既存の検証ロジック ...

  const preimage = preimageStore.getPreimage(hash);
  if (!preimage) {
    return c.json({ error: "No preimage found for this query" }, 404);
  }

  // 配信後に削除（べき等性の確保）
  preimageStore.delete(hash);
  queryHashMap.delete(body.query_id);
  verifiedQueries.delete(body.query_id); // これも削除

  return c.json({ query_id: body.query_id, preimage });
});
```

**テスト:**
```typescript
// CE-010 の実験で確認
test("preimage is deleted after delivery via HTTP", async () => {
  const app = buildOracleApp({ oracleId: "test" });
  // セットアップ後
  const first = await app.fetch(preimageRequest);
  expect(first.status).toBe(200);

  const second = await app.fetch(preimageRequest);
  expect(second.status).toBe(404);  // 削除済み
});
```

---

### R-005: `verifying` 状態のタイムアウト強制

**対象:** `src/domain/query-transitions.ts`
**重要度:** 高
**工数目安:** 1日

**現状:** `EXPIRABLE_STATUSES` に `"verifying"` が含まれない → Oracle が応答しないとクエリが永遠に `verifying` にとどまる

**推奨修正:**
```typescript
// query-transitions.ts
const EXPIRABLE_STATUSES: QueryStatus[] = [
  "pending", "awaiting_quotes", "worker_selected", "processing",
  "verifying",  // Oracle 応答待ちのタイムアウトを追加
];
```

**追加の保護:** Oracle が処理を開始した場合は `verifying` のタイムアウトを延長する仕組みが必要（Oracle のハートビート）

---

### R-006: Cashu swap のタイムアウト設定

**対象:** `src/infrastructure/cashu/escrow-helpers.ts:loadAndSend()`
**重要度:** 中
**工数目安:** 0.5日

**現状:** `wallet.ops.send().run()` にタイムアウトがなく、Mint が応答しない場合無限待機

**推奨実装:**
```typescript
export async function loadAndSend(
  wallet: ...,
  amountSats: number,
  proofs: Proof[],
  p2pkOptions?: P2PKOptions,
  privkey?: string,
  timeoutMs = 30_000,  // デフォルト 30秒
): Promise<Proof[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await wallet.loadMint();
    let builder = wallet.ops.send(amountSats, proofs);
    // ... builder 設定 ...
    const { send } = await Promise.race([
      builder.run(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error("Cashu mint operation timed out"))
        );
      }),
    ]);
    return send;
  } finally {
    clearTimeout(timeout);
  }
}
```

---

### R-007: k-of-n Oracle の並行検証とタイムアウト

**対象:** `src/application/query-service-methods.ts`（`doSubmitEscrowResult`）
**重要度:** 高
**工数目安:** 3日

**現状:** `resolveMultiple()` で複数 Oracle を取得するが、順次処理になっている可能性がある

**推奨実装:**
```typescript
// Oracle を並行で呼び出し、タイムアウトを設定
async function verifyWithQuorum(
  oracles: Oracle[],
  query: Query,
  result: QueryResult,
  minApprovals: number,
  timeoutMs = 30_000,
): Promise<{ passed: boolean; attestations: OracleAttestationRecord[] }> {
  const results = await Promise.allSettled(
    oracles.map(oracle =>
      Promise.race([
        oracle.verify(query, result),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Oracle timeout")), timeoutMs)
        ),
      ])
    )
  );

  const attestations: OracleAttestationRecord[] = [];
  let passCount = 0;

  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled" && r.value.passed) {
      passCount++;
      attestations.push({ oracle_id: oracles[i].info.id, passed: true, ... });
    } else {
      // タイムアウトまたは失敗
      attestations.push({ oracle_id: oracles[i].info.id, passed: false, ... });
    }
  }

  return { passed: passCount >= minApprovals, attestations };
}
```

---

### R-008: 複数 Relay への冗長発行

**対象:** `src/infrastructure/nostr/client.ts`
**重要度:** 高（検閲耐性）
**工数目安:** 1日

**現状:** `NOSTR_RELAYS` 環境変数で複数 Relay を設定できるが、一部が失敗しても警告のみ

**強化:** 発行成功数の最小値チェックと、種別ごとの優先 Relay を設定できるようにする

```typescript
export async function publishEvent(
  event: VerifiedEvent,
  relayUrls?: string[],
  options?: { minSuccesses?: number },
): Promise<{ successes: string[]; failures: string[] }> {
  // ... 既存の実装 ...

  const minRequired = options?.minSuccesses ?? 1;
  if (successes.length < minRequired) {
    throw new Error(
      `Published to only ${successes.length}/${urls.length} relays (required: ${minRequired})`
    );
  }

  return { successes, failures };
}
```

---

## 7. 実験実行チェックリスト

### 実験前チェックリスト

```
[ ] Docker Compose スタックが全サービス起動済み
    docker compose ps で全サービスが "Up" 状態

[ ] Regtest 初期化済み
    ./scripts/init-regtest.sh 実行済み

[ ] 定常状態の確認
    curl http://localhost:3338/v1/info  → 200
    curl http://localhost:3333/         → 200
    wscat -c ws://localhost:7777       → 接続成功
    curl http://localhost:4000/health  → {"ok":true}

[ ] ベースライン E2E テスト通過
    CASHU_MINT_URL=http://localhost:3338 \
    NOSTR_RELAYS=ws://localhost:7777 \
    BLOSSOM_SERVERS=http://localhost:3333 \
    deno test --allow-all e2e/regtest-htlc-trustless.test.ts

[ ] ロールバック手順の確認
    各実験で 30 秒以内に復旧できること

[ ] 監視ツール起動
    docker compose logs -f 2>&1 | tee /tmp/chaos-$(date +%s).log
```

### 実験後チェックリスト

```
[ ] 全 Docker サービスが再起動・正常稼働していること
[ ] E2E テストが再度通過すること
[ ] ログに未解決のエラーが残っていないこと
[ ] HTLC が宙ぶらりんになっていないこと（refund または redeem 済み）
[ ] 発見した障害モードが GitHub Issues に記録されていること
[ ] 改善勧告が backlog に追加されていること
```

---

## 8. ゲームデイ計画

### ゲームデイ #1: 基本フローの障害耐性（推奨所要時間: 3時間）

**目的:** HTLC の完全フローが単一コンポーネント障害下でも最終的に安全な状態（refund or redeem）に到達することを確認する。

**シナリオ:**

| 時刻 | 操作 | 期待する動作 |
|------|------|-------------|
| T+0 | regtest セットアップ | 全サービス起動 |
| T+5 | E2E テスト全通過確認 | ベースライン確立 |
| T+10 | CE-001: Relay 停止 | クエリ作成 API は 200、Relay 警告ログ |
| T+15 | Relay 再起動 | 30 秒以内に復旧 |
| T+20 | CE-004: Blossom 停止 | Worker upload null、HTLC 保留 |
| T+25 | Blossom 再起動 | 再試行でアップロード成功 |
| T+30 | CE-007: Oracle 再起動 | preimage 消失ログ、タイムアウトで refund |
| T+60 | 全サービス正常確認 | E2E テスト再通過 |
| T+90 | ポストモーテム | 発見事項の記録 |

**観察役の配置:**
- インフラ担当: Docker サービス状態監視
- プロトコル担当: HTLC 状態遷移追跡
- ログ担当: エラーログ収集・分析

---

### ゲームデイ #2: セキュリティ境界の検証（推奨所要時間: 4時間）

**目的:** 悪意のある参加者がプロトコルの信頼境界を突破できないことを確認する。

**シナリオ:**

| 時刻 | 攻撃シナリオ | 期待する結果 |
|------|------------|-------------|
| T+0 | CE-013: NUT-14 非強制問題の検証 | アプリ側検証が補完していること |
| T+30 | CE-010: preimage 二重取得 | バグ確認（R-004 で修正要） |
| T+60 | `protocol-attacks.test.ts` 全実行 | 全テスト通過 |
| T+90 | `regtest-htlc-attacks.test.ts` 実行 | 全攻撃が Mint に拒否されること |
| T+120 | CE-008: HTLC タイムアウト競合 | 先着優先で1回のみ決済 |
| T+180 | 発見したバグのトリアージ | P0/P1/P2 分類 |

---

### ゲームデイ #3: カスケード障害（推奨所要時間: 2時間）

**目的:** 複数コンポーネントの同時障害がシステムを危険な状態にしないことを確認する。

**シナリオ:**
```bash
# Relay + Blossom の同時停止
docker compose stop relay blossom

# HTLC フロー途中の Worker を観測
# → Worker は Blossom アップロードも kind 6300 発行もできない
# → HTLC は処理待ちのまま

# 片方だけ復旧
docker compose start blossom

# Blossom が復旧したが Relay が停止中
# → Worker は blob をアップロードできるが kind 6300 を発行できない

# Relay を復旧
docker compose start relay
sleep 5

# Worker が kind 6300 を発行 → Oracle が検証 → preimage 配信
```

---

## 補足: 実験スクリプトのテンプレート

```typescript
// e2e/helpers/chaos.ts（新規作成推奨）

/** Docker サービスを一時停止する（実験用）*/
export async function stopService(name: string): Promise<void> {
  const { code } = await new Deno.Command("docker", {
    args: ["compose", "stop", name],
  }).output();
  if (code !== 0) throw new Error(`Failed to stop ${name}`);
}

/** Docker サービスを再起動する */
export async function startService(name: string): Promise<void> {
  const { code } = await new Deno.Command("docker", {
    args: ["compose", "start", name],
  }).output();
  if (code !== 0) throw new Error(`Failed to start ${name}`);
}

/** 定常状態の確認 */
export async function checkSteadyState(mintUrl: string): Promise<boolean> {
  try {
    const [mintRes, blossomRes] = await Promise.all([
      fetch(`${mintUrl}/v1/info`),
      fetch("http://localhost:3333/"),
    ]);
    return mintRes.ok && blossomRes.ok;
  } catch {
    return false;
  }
}

/** カオス実験のラッパー */
export async function withChaos<T>(
  description: string,
  experiment: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  console.error(`[chaos] Starting: ${description}`);
  try {
    const result = await experiment();
    console.error(`[chaos] Completed: ${description}`);
    return result;
  } finally {
    await cleanup();
    console.error(`[chaos] Cleaned up: ${description}`);
  }
}
```

---

**文書の管理:**
このレポートは `docs/archive/chaos-engineering-report-2026-04-06.md` として保管する。現在のレジリエンスレビューは `docs/resilience-checklist.md` を入口にすること。
