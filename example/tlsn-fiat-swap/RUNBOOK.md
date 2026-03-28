# TLSNotary Fiat Swap — Runbook

Stripe テスト決済を TLSNotary で証明し、Anchr 経由で BTC と trustless に交換する E2E 手順。

---

## 0. 準備: Chrome for Testing + TLSNotary Extension セットアップ

TLSNotary proof の生成には Playwright の Chrome for Testing と TLSNotary Extension が必要。

### 0-1. Extension をダウンロード

```bash
# 最新リリースをダウンロード (v0.1.0.1403)
curl -L -o /tmp/tlsn-extension.zip \
  https://github.com/tlsnotary/tlsn-extension/releases/download/0.1.0.1403/extension-0.1.0.1403.zip

# 展開
mkdir -p /tmp/tlsn-extension
unzip -o /tmp/tlsn-extension.zip -d /tmp/tlsn-extension
```

### 0-2. Playwright の Chrome for Testing をインストール

```bash
npx playwright install chromium
```

### 0-3. Extension 付きで Chrome for Testing を起動

Playwright の `launchPersistentContext` を使うと Extension を確実にロードできる。

```typescript
// scripts/launch-chrome-tlsn.ts
import { chromium } from "playwright";

const context = await chromium.launchPersistentContext("/tmp/chrome-tlsn-profile", {
  headless: false,
  args: [
    "--disable-extensions-except=/private/tmp/tlsn-extension",
    "--load-extension=/private/tmp/tlsn-extension",
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

// Extension ID を取得
const sw = context.serviceWorkers().find(s => s.url().includes("background.bundle.js"));
const extId = sw ? new URL(sw.url()).hostname : "unknown";
console.log("Extension ID:", extId);

// DevConsole を開く (プラグインコード実行用)
const page = await context.newPage();
await page.goto(`chrome-extension://${extId}/devConsole.html`);

await new Promise(() => {}); // ブラウザを開いたまま維持
```

```bash
bun run scripts/launch-chrome-tlsn.ts
```

`chrome://extensions` で **TLSNotary** が有効になっていることを確認。

### 0-4. Extension の Verifier 設定

Extension の DevConsole (`chrome-extension://<id>/devConsole.html`) でプラグインコードを実行する際に、Verifier URL をコード内で指定する:

```javascript
const VERIFIER_URL = 'ws://localhost:7047';
```

Docker の TLSNotary Verifier Server に接続する。

> **Note**: docker-compose.yml で port 7048 も公開する必要がある:
> ```yaml
> tlsn-verifier:
>   ports:
>     - "7047:7047"
>     - "7048:7048"  # WS verifier + proxy for browser extension
> ```

---

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

---

## 3. Stripe Payment Link の準備

### Stripe テストモードのアカウント作成 (初回のみ)

1. https://dashboard.stripe.com/register でアカウント作成 (メールだけで OK)
2. 左上のトグルが **「テストモード」** になっていることを確認

### Payment Link 作成

1. Stripe Dashboard → **Payment Links** → **+ Create payment link**
2. **「顧客が支払い金額を選択する」** (Pay What You Want) を選択
3. Create → **URL をコピー** (例: `https://buy.stripe.com/test_xxxxx`)

テスト用カード情報 (テストモードでのみ有効):
- カード番号: `4242 4242 4242 4242`
- 有効期限: 任意の未来日 (例: `12/30`)
- CVC: 任意の3桁 (例: `123`)

---

## 4. E2E テスト実行

### 4-1. Seller: オーダー作成

`seller.ts` の `PAYMENT_LINK` を自分の URL に書き換えて実行:

```bash
bun run example/tlsn-fiat-swap/seller.ts
```

期待される出力:
```
=== TLSNotary Fiat Swap — Seller ===
Server: http://localhost:3000

Stripe Payment Link: https://buy.stripe.com/test_xxxxx

--- Order Created ---
Query ID: query_xxxxx
Escrowed: 100,000 sats in Cashu HTLC
Timeout:  1 hour

Waiting for buyer to:
  1. Pay via Stripe Payment Link
  2. Generate TLSNotary proof of the Stripe receipt
  3. Submit proof to Anchr

Monitoring order status...
  Status: pending (5s elapsed)
```

Seller はポーリングで Buyer の提出を待ちます。**このターミナルは開いたまま**にする。

### 4-2. Buyer: オーダー発見

別ターミナルで:

```bash
bun run example/tlsn-fiat-swap/buyer.ts
```

クエリの条件が表示される。

### 4-3. Buyer: Stripe で支払い

1. **Step 0 でセットアップした Chrome** で Payment Link を開く
2. 金額を入力 (例: `100` = ¥100)
3. テストカード情報を入力
4. **「支払う」** をクリック
5. **「お支払いありがとうございます」** ページが表示されたら成功

**この receipt ページを開いたまま** 次のステップへ。

### 4-4. Buyer: TLSNotary proof 生成

1. receipt ページ (`checkout.stripe.com/...`) を表示した状態で
2. ツールバーの **TLSN Extension アイコン** をクリック
3. **「Notarize this page」** (またはプラグインコードを実行)
4. MPC-TLS セッションが開始される (数秒〜数十秒)
5. 完了すると `.presentation.tlsn` ファイルがダウンロードされる

### 4-5. Buyer: proof を Anchr に提出

**方法 A: Worker UI から提出**

1. http://localhost:3000 を開く
2. Web Proof クエリカードを展開
3. **「Manual upload (.presentation.tlsn)」** セクションで `.presentation.tlsn` をアップロード
4. **Submit Proof** をクリック

**方法 B: CLI から提出**

```bash
# Base64 エンコードして submit
QUERY_ID="query_xxxxx"  # seller.ts の出力から
PROOF_FILE="path/to/stripe-receipt.presentation.tlsn"

curl -X POST http://localhost:3000/queries/${QUERY_ID}/submit \
  -H "Content-Type: application/json" \
  -d "{\"tlsn_presentation\": \"$(base64 < ${PROOF_FILE})\"}"
```

### 4-6. 検証結果の確認

**Seller 側 (Terminal 1)**:
```
Order completed!
  Status: approved
  Payment verified — BTC released to buyer
  Verification checks:
    ✓ cryptographically verified from checkout.stripe.com
    ✓ server name matches target_url
    ✓ "succeeded" condition satisfied
```

**Requester UI** (http://localhost:3000/requester):
- ステータス: **承認** (緑)
- 検証OK: TLSNotary 署名検証、ドメイン一致、条件一致

---

## 5. クリーンアップ

```bash
# Anchr サーバー停止: Ctrl+C

# デバッグ Chrome を閉じる

# Docker サービス停止
docker compose down

# 一時ファイル削除
rm -rf /tmp/chrome-tlsn-profile /tmp/tlsn-extension /tmp/tlsn-extension.zip
```

---

## トラブルシューティング

| 問題 | 対処 |
|------|------|
| Stripe で「金額を入力してください」エラー | Payment Link が Pay What You Want の場合、金額欄に 0 以外を入力する |
| Extension が Verifier に接続できない | Extension の Settings で Notary URL が `ws://localhost:7047` か確認 |
| `Blossom upload failed` | `docker compose ps` で blossom が Up か確認 |
| `cashu-mint` が起動しない | `docker compose restart cashu-mint` (LND の起動待ち) |
| `port 3000 in use` | `lsof -ti:3000 \| xargs kill -9` |
| Buyer が "No open on-ramp orders" | Seller を先に実行してオーダーを作成する |
| `anchr-sdk` module not found | `packages/sdk/` が存在することを確認 |
| TLSNotary proof 生成が遅い/失敗 | Verifier ログを確認: `docker compose logs tlsn-verifier` |
| receipt ページが「処理は完了です」のみ | 支払い後すぐにページが遷移する場合あり。Chrome の履歴から `checkout.stripe.com` の URL を開き直す |
