# Example Runbook

`example/` ディレクトリの各ユースケースをローカルで動作確認する手順。

## 前提条件

- [Bun](https://bun.sh/) がインストールされていること
- Docker & Docker Compose が動作すること
- (C2PA テストの場合) `c2patool` がインストールされていること（[install guide](https://github.com/contentauth/c2patool)）

## 1. インフラ起動

```bash
# Docker サービス起動 (Blossom, Nostr Relay, TLSNotary Verifier, etc.)
docker compose up -d

# Cashu Mint は LND の起動を待つ必要がある。起動に失敗していたら:
docker compose restart cashu-mint

# 全サービスの確認
docker compose ps
# → blossom, relay, tlsn-verifier, bitcoind, lnd-mint, lnd-user, cashu-mint が Up
```

## 2. Anchr サーバー起動

```bash
BLOSSOM_SERVERS=http://localhost:3333 \
NOSTR_RELAYS=ws://localhost:7777 \
CASHU_MINT_URL=http://localhost:3338 \
bun run dev
```

ヘルスチェック:
```bash
curl http://localhost:3000/health
# → {"ok":true}
```

Web UI:
- Worker UI: http://localhost:3000
- Requester UI: http://localhost:3000/requester

---

## 3. C2PA Media Verification

### 3a. Requester (ニュースデスク) — SDK でクエリ作成

```bash
bun run example/c2pa-media-verification/requester.ts
```

出力:
```
=== C2PA Media Verification — Requester (News Desk) ===
Server: http://localhost:3000
```

SDK がクエリを作成し、Worker の提出を待ってポーリングします。
別ターミナルで Worker を実行してください。

### 3b. Worker (記者) — HTTP API で写真提出

**テスト用写真で実行** (C2PA なし → 検証 NG になる):

```bash
# テスト画像を作成
bun -e '
import sharp from "sharp";
const img = await sharp({
  create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } }
}).jpeg().toBuffer();
await Bun.write("/tmp/test-photo.jpg", img);
console.log("Created:", img.length, "bytes");
'

# Worker 実行
bun run example/c2pa-media-verification/worker.ts /tmp/test-photo.jpg
```

期待される出力:
```
Step 1: Finding open photo queries...
Found query: query_xxxxx
  Description: Current situation at the protest location
  Location: Shibuya, Tokyo
  Expected GPS: 35.6595°N, 139.7004°E (±0.5km)
  Bounty: 100 sats

Step 2: Uploading C2PA-signed photo...
Uploaded: <sha256 hash>
  URI: http://localhost:3333/<hash>

Step 3: Submitting for verification...
Submitted: failed
  Message: Verification failed: GPS coordinates missing..., C2PA: no Content Credentials...

--- Verification Result ---
Passed: false
Checks passed:
  ✓ attachment present
  ✓ EXIF: no metadata (stripped by worker for privacy)
Checks failed:
  ✗ GPS coordinates missing from submission body
  ✗ C2PA: no Content Credentials found — use a C2PA-enabled camera
```

**C2PA 署名付き写真で実行** (検証が通る想定):

```bash
# c2patool で署名付き画像を作成
c2patool /tmp/test-photo.jpg -m manifest.json -o /tmp/signed-photo.jpg

# Worker 実行
bun run example/c2pa-media-verification/worker.ts /tmp/signed-photo.jpg
```

### 3c. Web UI で確認

1. http://localhost:3000/requester を開く
2. `+ Create Query` → **Photo** タブ
3. Description, GPS, Bounty を入力 → **Create**
4. http://localhost:3000 を開く (Worker UI)
5. Photo クエリカードをクリック → 写真をドラッグ＆ドロップ → **Submit**
6. Requester UI に戻ってダッシュボードで結果確認

---

## 4. zkP2P On-ramp

### 4a. Seller (BTC 売り手) — SDK でオーダー作成

```bash
bun run example/zkp2p-onramp/seller.ts
```

出力:
```
=== zkP2P On-ramp — Seller ===
--- Order Created ---
Query ID: query_xxxxx
Escrowed: 100,000 sats in Cashu HTLC
Timeout:  1 hour

Waiting for buyer to:
  1. Send $70.00 to seller@example.com on PayPal
  2. Generate TLSNotary proof of the transaction
  3. Submit proof to Anchr

Monitoring order status...
  Status: pending (5s elapsed)
```

### 4b. Buyer (BTC 買い手) — SDK でオーダー発見

別ターミナルで:

```bash
bun run example/zkp2p-onramp/buyer.ts
```

出力:
```
Step 1: Finding open on-ramp orders...
Found order: query_xxxxx
  Description: Prove PayPal payment of $70.00 to seller@example.com
  Bounty: 100000 sats
  Target URL: https://www.paypal.com/activity/payment/{transaction_id}
  Conditions:
    - [contains] "Completed" — Payment status must be completed
    - [contains] "$70.00" — Payment amount must be $70.00
    - [contains] "seller@example.com" — Recipient must be seller@example.com
  Max attestation age: 600s

--- Step 2: Send Fiat Payment ---
Send $70.00 to seller@example.com via PayPal.
...
```

### 4c. Web UI で確認

1. http://localhost:3000/requester → `+ Create Query` → **Web Proof** タブ
2. 以下を入力:
   - Description: `Prove PayPal payment of $70.00 to seller@example.com`
   - Target URL: `https://www.paypal.com/activity/payment/{transaction_id}`
   - Condition: **Contains** → `Completed`
   - Bounty: `100000`
3. **Create** をクリック
4. http://localhost:3000 (Worker UI) で "Web Proof" バッジ付きクエリを確認
5. クエリを展開 → TLSNotary Extension 用のプラグインコードが表示される

---

## 5. クリーンアップ

```bash
# サーバー停止 (Ctrl+C)

# Docker サービス停止
docker compose down
```

## トラブルシューティング

| 問題 | 対処 |
|------|------|
| `Blossom upload failed` | Docker が起動しているか確認: `docker compose ps` → blossom が Up |
| `cashu-mint` が起動しない | LND の起動待ち: `docker compose restart cashu-mint` |
| `port 3000 in use` | `lsof -ti:3000 \| xargs kill -9` |
| Worker が "No open photo queries" | Requester を先に実行してクエリを作成する |
| `anchr-sdk` module not found | example は相対パスで SDK を参照。`packages/sdk/` が存在することを確認 |
