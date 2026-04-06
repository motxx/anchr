# Trust Minimization Roadmap — Prediction Market

検討余地のある実装計画。現時点では未実装。

## 現状の信頼モデル

```
Bettor → [Cashu Mint (custodial)] → HTLC(preimage) → Oracle reveals → Redeem
```

| 信頼先 | リスク | 現在の緩和策 |
|--------|--------|-------------|
| Cashu Mint | rug pull、HTLC条件の不履行 | 「reputable mint を使え」（弱い） |
| Oracle | preimage の恣意的公開/非公開、フロントランニング、解決拒否 | TLSNotary でデータ改竄は不可。だが解決自体を拒否可能 |
| TLSNotary | データソース自体が嘘をつく場合 | なし。データソースの信頼性に依存 |

---

## Level 1: TLSNotary proof の公開（評価の裁量を排除）

**目的**: Oracle がデータを改竄したり、条件を満たしているのに「NO」と嘘をつくことを不可能にする。

**現在**:
```
Oracle が TLSNotary proof を取得 → 自分で評価 → 結果だけ公開
```

**改善後**:
```
Oracle が TLSNotary proof を Nostr に公開 → 誰でも条件を評価・検証できる
```

### 実装方針

プロトコル層（mechanism）とアプリ層（policy）を分離する:

```typescript
// Protocol: 公開の「手段」を提供
interface ProofDelivery {
  deliverPrivate(proof: TlsnProof, to: string): Promise<void>;
  publishPublic(proof: TlsnProof, tags: string[][]): Promise<NostrEvent>;
}

// Prediction Market アプリ: 「常に公開」を選択
// Data Marketplace アプリ: 「Requester にだけ渡す」を選択
```

proof 生成時に visibility を必須パラメータにする（デフォルトなし）:

```typescript
interface ProofRequest {
  target_url: string;
  visibility: "public" | "requester_only";  // required, no default
}
```

### 安全チェック

publishPublic() に組み込む:

- **Request header redaction**: Authorization, Cookie, X-API-Key 等を自動 redact
- **Response field allowlist**: 条件評価に必要なフィールドのみ開示（selective disclosure）
- **公開前バリデーション**: 認証情報の検出 → ブロック

### 工数: 2-3日

---

## Level 1.5: k-of-n Oracle（配達・裁量の信頼を分散）

**目的**: 単一 Oracle の解決拒否/遅延リスクを分散する。

```
k-of-n Oracle が独立に TLSNotary proof を取得・評価。
1 つでも proof が Nostr に公開されれば、誰でも結果を検証可能。
全員が期限内に proof を出さなければ、locktime で全額返金。
```

### 工数: 5-8日

---

## Level 2: Preimage の裁量排除（検討中・設計課題あり）

**目的**: Oracle が preimage を恣意的に公開/非公開にする裁量を排除する。

### 設計上の矛盾

当初案 `preimage = hash(tlsn_proof || market_id)` には時間的矛盾がある:

```
時点A: マーケット作成 → hash(preimage) を公開 ← preimage が必要
時点C: Deadline → TLSNotary proof を取得     ← proof はここで初めて存在
```

preimage を proof から導出するなら、時点Aで hash を公開できない。
HTLC のロック自体が成立しない。

### 代替案

| 方式 | 概要 | 複雑度 | 懸念 |
|------|------|--------|------|
| Shamir Secret Sharing | preimage を k-of-n 分割、各 Oracle が share を配布。YES なら share 公開、k 個揃えば復元 | 高 | share 配布の信頼チャネル |
| 暗号化 preimage | encrypted_preimage を事前公開、proof が復号鍵になる設計 | 高 | 鍵導出の安全性証明が必要 |
| DLC adaptor signature | preimage ではなく Schnorr adaptor sig で決済 | 最高 | アーキテクチャ全面変更（後述） |

### 結論

Level 2 は研究課題として保留。Level 1 + 1.5 で実用的に十分な trust minimization を達成する。

---

## Mint 層の Trust Minimization

| 選択肢 | Trust level | Anchr との相性 | 実装コスト |
|--------|------------|---------------|-----------|
| Cashu（現状） | 単一 Mint 信頼 | 高（既存実装） | 0 |
| Fedimint | 連合 Mint（threshold 署名） | 高（API 差し替えで移行可能） | ~25人日 |
| DLC | Mint 不要（2-of-2 multisig） | 低（プール型ベッティングと相性悪い） | ~50人日 |

### Fedimint 移行の推奨手順

1. **EcashProvider interface を定義**（3日）
   - `createEscrow()`, `redeemWithPreimage()`, `verifyToken()`, `refundAfterLocktime()`
2. **現行 Cashu をこの interface に合わせる**（5日）
   - Application/Domain → EcashProvider のみ参照
3. **Fedimint 実装を同じ interface で作る**（10日）
   - CashuProvider と FedimintProvider を切り替え可能に

Cashu を壊さずに Fedimint を並行開発でき、テストも共通化できる。

### DLC の位置づけ

DLC は最も trust-minimized だが、Anchr の強みとの相性に課題がある:

- **プール型 → ペアマッチ**: 多対多のベッティングプールが2者間契約になる
- **事前 outcome 列挙**: DLC Oracle は結果を事前に列挙する必要がある。Anchr の「任意 URL で自由にマーケット作成」の柔軟性が制限される
- **Oracle blindness**: Oracle が市場の存在を知らない（プライバシー向上）が、TLSNotary proof → DLC attestation 変換は新規研究レベル

将来的に「高額マーケット向けオプション」として DLC を追加する方が自然。

---

## Proof 公開のリスク分析

proof 公開機能をプロトコルに導入した場合、他ユースケースへの波及リスク:

| リスク | 深刻度 | 発生条件 | 対策 |
|--------|--------|---------|------|
| 誤公開（Nostr は削除不能） | 高 | 開発者の設定ミス | visibility を必須パラメータ化、デフォルトなし |
| メタデータ相関 | 中 | 同一 Oracle が公開/非公開を両方処理 | 予測市場用とデータMP用で Oracle 鍵を分離 |
| Tor 匿名性破壊 | 中 | 同一ノードで Tor 通信 + Nostr 公開 | ノード分離 or Tor 経由で Nostr relay に投稿 |
| デフォルト変更圧力 | 中 | 将来のプロトコル更新 | visibility にデフォルト値を永久に持たせない |
| クエリ内容推測 | 低 | Oracle の専門領域が公開 proof から判明 | Oracle 分離 |

### 設計原則

1. `visibility` は必須パラメータ（デフォルトなし） — 開発者が必ず選択する
2. public proof と private proof で Oracle 鍵の分離を推奨
3. `publishPublic()` に auth header 検出・ブロックの安全チェックを組み込む
4. Nostr 公開は不可逆であることを API レベルで明示する

---

## 推奨実装順序

```
Phase 1: Level 1（proof 公開）+ 安全チェック        工数: 3-5日
         → Oracle の評価裁量を排除
         → visibility 必須パラメータ + header redaction

Phase 2: EcashProvider interface 導入              工数: 8日
         → Cashu を interface で抽象化
         → 将来の Fedimint 移行準備

Phase 3: Level 1.5（k-of-n Oracle）                工数: 5-8日
         → Oracle の配達・解決拒否リスクを分散

Phase 4: Fedimint 実装                             工数: 10日
         → EcashProvider の FedimintProvider 実装
         → Mint の trust を分散

Phase 5: Level 2 研究                              工数: TBD
         → preimage 裁量排除の暗号設計
         → DLC ハイブリッドの検討
```
