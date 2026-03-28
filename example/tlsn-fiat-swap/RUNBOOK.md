# TLSNotary Fiat Swap — Runbook

## 前提条件

- [Bun](https://bun.sh/)
- Docker & Docker Compose
- (フル E2E の場合) [TLSNotary Browser Extension](https://github.com/tlsnotary/tlsn-extension)

## 1. インフラ起動

```bash
# プロジェクトルートで実行
docker compose up -d

# Cashu Mint が起動に失敗していたら (LND の起動待ち):
docker compose restart cashu-mint

# 確認
docker compose ps
# → blossom, relay, tlsn-verifier, cashu-mint 等が Up
```

## 2. Anchr サーバー起動

```bash
BLOSSOM_SERVERS=http://localhost:3333 \
NOSTR_RELAYS=ws://localhost:7777 \
CASHU_MINT_URL=http://localhost:3338 \
bun run dev
```

```bash
curl http://localhost:3000/health
# → {"ok":true}
```

## 3. CLI で動作確認

### Terminal 1: Seller (BTC 売り手)

```bash
bun run example/tlsn-fiat-swap/seller.ts
```

期待される出力:
```
=== TLSNotary Fiat Swap — Seller ===
Server: http://localhost:3000

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

Seller はオーダーを作成し、Buyer の証明提出をポーリングで待ちます。

### Terminal 2: Buyer (BTC 買い手)

```bash
bun run example/tlsn-fiat-swap/buyer.ts
```

期待される出力:
```
=== TLSNotary Fiat Swap — Buyer ===
Server: http://localhost:3000

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
Keep the transaction page open — you'll need it for the proof.

--- Step 3: Generate TLSNotary Proof ---
Use the TLSNotary browser extension to generate a proof:
  1. Open the PayPal transaction page in your browser
  2. Click the TLSN extension icon
  3. Start a notarization session
  4. The extension generates a .presentation.tlsn file

--- Step 4: Submit Proof ---
Example submission code:
  const proof = Bun.file("transaction.presentation.tlsn");
  const proofBase64 = Buffer.from(await proof.arrayBuffer()).toString("base64");
  const result = await anchr.submitPresentation("query_xxxxx", proofBase64);
```

Buyer はオーダーを発見し、proof 提出手順を表示します。
実際の TLSNotary proof 生成には PayPal アカウント + TLSNotary Extension が必要です。

## 4. Web UI で動作確認

### Requester 側 (= Seller)

1. http://localhost:3000/requester を開く
2. **+ Create Query** をクリック
3. **Web Proof** タブを選択 (デフォルト)
4. 以下を入力:
   - Description: `Prove PayPal payment of $70.00 to seller@example.com`
   - Target URL: `https://www.paypal.com/activity/payment/{transaction_id}`
   - Condition: ドロップダウンで **Contains** を選択 → `Completed`
   - Bounty: `100000`
5. **Create** をクリック → ダッシュボードに「受付中」+ **100000 sats** のクエリが表示される

### Worker 側 (= Buyer)

6. http://localhost:3000 を開く
7. **Web Proof** バッジ付きのクエリカードが表示される (ドメイン `www.paypal.com` + `100000 sats`)
8. カードをクリックして展開
9. 以下が表示される:
   - **ターゲット URL**: `https://www.paypal.com/activity/payment/{transaction_id}`
   - **TLSNotary Extension プラグインコード**: ブラウザ拡張で実行するための JS コード
   - **Submit Proof** ボタン: `.presentation.tlsn` ファイルをアップロードする UI

### TLSNotary Proof を提出する場合 (フル E2E)

10. PayPal で実際に送金する
11. PayPal の取引ページを開いた状態で TLSNotary Extension を使って notarize
12. 生成された `.presentation.tlsn` ファイルを Worker UI から Submit
13. Requester UI で検証結果を確認:
    - 成功: **承認** — TLSNotary 検証通過、条件一致
    - 失敗: **却下** — ドメイン不一致、条件未達、attestation 期限切れ等

## 5. クリーンアップ

```bash
# サーバー停止: Ctrl+C
docker compose down
```

## トラブルシューティング

| 問題 | 対処 |
|------|------|
| `Blossom upload failed` | `docker compose ps` で blossom が Up か確認 |
| `cashu-mint` が起動しない | `docker compose restart cashu-mint` (LND の起動待ち) |
| `port 3000 in use` | `lsof -ti:3000 \| xargs kill -9` |
| Buyer が "No open on-ramp orders" | Seller を先に実行してオーダーを作成する |
| `anchr-sdk` module not found | `packages/sdk/` が存在することを確認 |
| TLSNotary Verifier に接続できない | `docker compose ps` で tlsn-verifier が Up か確認 |
