# C2PA Media Verification — Runbook

## 前提条件

- [Bun](https://bun.sh/)
- Docker & Docker Compose
- (任意) [c2patool](https://github.com/contentauth/c2patool) — C2PA 署名付き画像を作成する場合

## 1. インフラ起動

```bash
# プロジェクトルートで実行
docker compose up -d

# Cashu Mint が起動に失敗していたら (LND の起動待ち):
docker compose restart cashu-mint

# 確認
docker compose ps
# → blossom, relay, tlsn-verifier 等が Up
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

### Terminal 1: Requester (ニュースデスク)

```bash
bun run example/c2pa-media-verification/requester.ts
```

SDK が photo クエリを作成し、Worker の提出をポーリングで待ちます。

期待される出力:
```
=== C2PA Media Verification — Requester (News Desk) ===
Server: http://localhost:3000
```
(Worker が提出するまでブロック)

### Terminal 2: Worker (記者)

**テスト画像 (C2PA なし) で実行:**

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

C2PA なし・GPS なしのテスト画像なので **検証 NG は正常動作**。

**C2PA 署名付き画像で実行:**

```bash
# c2patool で署名
c2patool /tmp/test-photo.jpg -m manifest.json -o /tmp/signed-photo.jpg

# Worker 実行
bun run example/c2pa-media-verification/worker.ts /tmp/signed-photo.jpg
```

## 4. Web UI で動作確認

### Requester 側

1. http://localhost:3000/requester を開く
2. **+ Create Query** をクリック
3. **Photo** タブを選択
4. 以下を入力:
   - Description: `Current situation at the protest location`
   - Location hint: `Shibuya, Tokyo`
   - Lat: `35.6595` / Lon: `139.7004`
   - Bounty: `100`
5. **Create** をクリック → ダッシュボードに「受付中」のクエリが表示される

### Worker 側

6. http://localhost:3000 を開く
7. **Photo** バッジ付きのクエリカードが表示される
8. カードをクリックして展開
9. 写真をドラッグ＆ドロップ (または「Click to select photo or video」をクリック)
10. **Submit →** をクリック

### 結果確認

11. Requester UI (http://localhost:3000/requester) に戻る
12. ダッシュボードでクエリのステータスが更新されている:
    - テスト画像の場合: **却下** (FAILED: 1) → カード展開で「検証NG」の詳細
    - C2PA 署名付きの場合: **承認** (VERIFIED: 1)

## 5. クリーンアップ

```bash
# サーバー停止: Ctrl+C
docker compose down
```

## トラブルシューティング

| 問題 | 対処 |
|------|------|
| `Blossom upload failed` | `docker compose ps` で blossom が Up か確認 |
| `port 3000 in use` | `lsof -ti:3000 \| xargs kill -9` |
| Worker が "No open photo queries" | Requester を先に実行してクエリを作成する |
| `anchr-sdk` module not found | `packages/sdk/` が存在することを確認 |
