# 巫(Kannagi)

> *Kannagi* (神和ぎ) — "spirit-pacifying"; in folk religion, the medium who consults the oracle and pacifies the verdict. Here: a Bitcoin-native two-party bet settled by oracle attestation.

**Two-party binary bet, settled by oracle attestation.** Built on Anchr's Oracle + TLSNotary verification + Cashu HTLC (or FROST P2PK) atomic settlement.

> **Status: Testnet.** Live deployment at <https://anchr-market.fly.dev>; testnut ecash, not real BTC.

> **Uses:** `@anchr/cashu-conditional-swap` + `@anchr/frost-oracle` + `@anchr/core-cashu` (direct imports, no SDK).
> **Pattern:** two-party bet (two counterparties cross-lock; Oracle reveals outcome).

> **What this is**
> - Two-party binary bet with non-custodial settlement
> - Oracle releases a single secret (HTLC preimage or FROST signature share);
>   funds never enter the Oracle's wallet
>
> **What this is not**
> - Not a Polymarket / Kalshi replacement — no CLOB, no continuous pricing
> - Not tradable — once matched, positions are terminal until resolution
>   or locktime refund
> - Not multi-outcome — binary YES / NO only
> - Not for subjective questions — only deterministic HTTPS conditions
>
> **Status: experimental.** Whether this primitive fits real
> two-party betting, niche prediction questions, or conditional contracts is open.
> See [What you can build](#what-you-can-build-with-this-primitive) for the
> use cases the current primitive supports.

> **Live testnet deploy:** <https://anchr-market.fly.dev>
> Funds are testnut ecash — *not real BTC*. Do not bridge mainnet sats in.
> Backed by FROST 2-of-3 threshold signing on Fly.io (region `sin`),
> the public testnut Cashu mint (<https://testnut.cashu.space>), the
> Anchr Nostr relay, and the Anchr TLSN verifier. No accounts, no KYC.

> **Operator runbook:** [`DEPLOYMENT.md`](../../DEPLOYMENT.md)
> covers regtest setup, FROST DKG bootstrap, trustless TLSNotary
> resolution, and the public-testnet deploy checklist. Screenshots of
> the running UI live in [`screenshots/`](../../screenshots/).

## What you can build with this primitive

If a question can be decided by a single HTTPS GET, two parties can
wager sats on it with no custodian holding the funds. Kannagi supports
`jsonpath_gt`, `jsonpath_lt`, `jsonpath_equals`, and `contains_text` —
anything that fits that shape works. Concrete examples:

| Use case | Source | Condition | Example bet |
|---|---|---|---|
| Sports score | ESPN / sports-data JSON | `jsonpath_equals` / `contains_text` | "Team A wins the final" — resolve from box-score |
| Project ship date | GitHub release API | `jsonpath_equals` | "Project X ships v1.0 before 2026-12-31" — resolve from `/releases/latest` |
| Price cross | CoinGecko / exchange API | `jsonpath_gt` | "BTC > 15,000,000 JPY at 2026-12-31 12:00 UTC" — resolve from `/simple/price` |
| Parametric insurance | Weather / flight-status API | `jsonpath_*` | "Flight ABC123 delayed > 60 min" — resolve from carrier JSON |

For what the primitive does **not** support, see
[Limitations](#limitations-of-the-current-primitive).

## Settlement model — funds are *not* held by the Oracle

Funds stay between the bettors at all times via a **bilateral
cross-lock** at the Cashu Mint — each bettor's tokens are locked under
the *counterparty's* pubkey and the *opposite outcome's* hash. The
Oracle's role is to release a single secret (preimage or signature
share) that lets the *winner* unlock the *loser's* counterparty token.
No money ever flows into an Oracle wallet.

There are two settlement modes, both audited end-to-end against a real
Cashu mint on regtest. They differ only in what kind of secret the
Oracle emits.

### HTLC mode (`packages/cashu-conditional-swap/src/cross-htlc.ts`)

```
Bettor A's proofs:  hashlock(hash_b) + P2PK(B) + refund(A) + locktime
Bettor B's proofs:  hashlock(hash_a) + P2PK(A) + refund(B) + locktime
```

- Each bettor's sats are locked **to the counterparty's pubkey + the
  counterparty's outcome hash**. They never enter an Oracle wallet.
- Oracle reveals `preimage_a` if YES wins (or `preimage_b` if NO).
- Winner uses `preimage + their own signature` to redeem the loser's
  cross-locked token.
- If the Oracle never reveals: locktime expires → each bettor refunds
  their own original proofs to themselves.

### FROST P2PK mode (`packages/cashu-conditional-swap/src/frost-conditional-swap.ts`)

```
Bettor A's proofs:  P2PK([group_pubkey_b, B_pubkey], n_sigs=2) + refund(A) + locktime
Bettor B's proofs:  P2PK([group_pubkey_a, A_pubkey], n_sigs=2) + refund(B) + locktime
```

- Each bettor's sats are locked under a **2-of-2 multisig: the FROST
  group key for the *opposite* outcome AND the counterparty's personal
  key**. Funds never enter the Oracle's wallet either.
- To redeem the counterparty's token, the winner needs both signatures.
- If the Oracle never produces a FROST signature: locktime expires →
  refund.

## Trust model

| Behaviour | Outcome |
|---|---|
| Oracle signs / reveals correctly | Winner redeems the loser's token; loser refunds nothing. |
| Oracle never responds | Both bettors refund their own original proofs after `locktime`. No theft. |
| Oracle (HTLC) reveals the *wrong* preimage | The wrong bettor wins. The HTLC's second factor (counterparty signature, see `cross-htlc.ts:33-71`) doesn't prevent this — revealing the *opposite* preimage routes redemption to the counterparty whose pubkey is on the wrong-side lock, who has every incentive to sign. Use **FROST mode** when stakes warrant a t-of-n trust assumption that is geometrically bound to the outcome key. |
| Oracle (FROST) signs the *wrong* outcome's key | Loser-as-redeemer still needs the loser's own personal sig (which is on the wrong side of the lock). The Oracle's lone share doesn't unlock anything. |
| t-of-n FROST nodes collude on *both* keys | Each bettor can redeem the counterparty's token. Net wash — no theft, just bilateral payout. |
| Single-sig (demo) DualKeyStore reveals both | Same wash result; loser side's secret key is permanently deleted on first sign (`packages/cashu-conditional-swap/src/frost-conditional-swap.ts`). |

The mint is still a trust point (it executes the swap), but it can't
unilaterally pick the winner — it only enforces the P2PK signatures the
oracle and bettor provide.

## How tests verify this

The lock structure and oracle-isolation are exercised end-to-end at three
layers:

| Layer | File | What it proves |
|---|---|---|
| Unit (no infra) | `packages/cashu-conditional-swap/src/cross-htlc.test.ts` | `buildCrossHtlcForPartyA/B` produce HTLC P2PK options with the **counterparty's** hash and pubkey. 4 tests. |
| Unit (no infra) | `packages/cashu-conditional-swap/src/frost-conditional-swap.test.ts` | `buildFrostSwapForPartyA/B` produce **2-of-2** P2PK options containing the FROST group pubkey **and** the counterparty pubkey; `DualKeyStore.sign` deletes the losing key on first sign and refuses to sign twice. 22 tests. |
| E2E on regtest | `e2e/conditional-swap.test.ts` | Mints real Cashu proofs via Lightning, executes a YES/NO match, asserts each proof's HTLC secret carries `hash_a` / `hash_b` (not Oracle pubkey), oracle reveals `preimage_a`, **YES bettor** redeems NO's locked tokens with `preimage + YES private key`. 11 steps. Run via `deno task test:regtest`. |
| E2E on regtest | `e2e/frost-p2pk-cashu.test.ts` | Locks Alice's proofs to `[group_pubkey_no, bob]` 2-of-2 and Bob's to `[group_pubkey_yes, alice]`; verifies that **only `[oracle_yes_sk, alice_sk]` together** can redeem Bob's proofs, and that Bob alone, the wrong group key, or a random third party each fail (only 1 of 2 required signatures). 9 lifecycle steps + 3 structural tests. |

Run the unit subset locally without Docker:

```bash
deno test packages/cashu-conditional-swap/src/cross-htlc.test.ts \
          packages/cashu-conditional-swap/src/frost-conditional-swap.test.ts \
          --allow-all
# 26 passed | 0 failed
```

The full regtest suite runs in CI's Phase 3 (Cashu + Lightning Docker
stack).

## Resolution flow

```
1. Market created → Oracle generates dual preimages (HTLC) or DKG group keys (FROST)
2. Bettors mint Cashu proofs from their Lightning balance
3. Order book matches YES / NO orders → MatchProposal
4. Match executor cross-locks each bettor's proofs (counterparty pubkey +
   counterparty's outcome hash / FROST group key)
5. Oracle fetches resolution URL via TLSNotary, verifies server name +
   timestamp + condition (jsonpath_gt / lt / equals / contains_text)
6. Oracle reveals winning preimage or FROST signature; loser secret is
   permanently deleted
7. Winner redeems counterparty's locked proofs at the mint
8. If Oracle is silent: locktime expires → both bettors refund
```

## Resolution conditions

| Type | Description | Example |
|---|---|---|
| `jsonpath_gt` | JSON value > threshold | BTC/JPY > 15,000,000 |
| `jsonpath_lt` | JSON value < threshold | ETH gas < 10 gwei |
| `contains_text` | Response contains text | "winner: Team A" |
| `jsonpath_equals` | JSON value = expected | `status` == "completed" |

## Limitations of the current primitive

| Item | Status |
|---|---|
| 1:1 matched orders only (no CLOB / arbitrary probability pricing) | Not implemented |
| Secondary market — exit a position before resolution | Not implemented; once matched, the cross-lock binds redemption to specific pubkeys, so positions are terminal until resolution or locktime refund |
| Multi-outcome markets (>2 outcomes) | Not implemented; binary YES / NO only |
| Subjective resolution (UMA-style human dispute) | Not in scope; only deterministic HTTPS conditions |
| Bookmaker-style 1:N matching | Not supported; current order book is FIFO 1:1 |

## Persistence

The order book is in-memory by default — fine for tests and demos, but
**open orders are lost on server restart**. For any deployment that
matters, point the server at a Postgres database via `DATABASE_URL`:

```bash
# 1. Create the schema (idempotent)
psql "$DATABASE_URL" -f example/two-party-binary-bet/migrations/001_create_orders.sql

# 2. Start the server with persistence on
DATABASE_URL=postgres://user:pass@host:5432/anchr_market \
  deno run --allow-all example/two-party-binary-bet/server.ts
```

When `DATABASE_URL` is unset, the server falls back to the in-memory book
and logs a warning. When set, FIFO matching runs inside a single Postgres
transaction with `SELECT ... FOR UPDATE` locks on the open orders, which
serializes concurrent matchers correctly.

| Env var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | unset | Postgres connection string. If unset, in-memory. |
| `DATABASE_POOL_SIZE` | `10` | Max Postgres connections in the pool. |

For local dev the `postgres` service in `docker-compose.yml` provisions a
ready-to-use database (`postgres://anchr:anchr@localhost:5432/anchr_market`)
and auto-applies the migration on first start. CI runs the regtest test
suite with `DATABASE_URL` pointed at it, so both
`two-party-binary-bet-orderbook-pg.test.ts` (direct PG order-book coverage:
CRUD, FIFO, partial matches, concurrent `FOR UPDATE` matchers) and
`two-party-binary-bet-lifecycle.test.ts` (full Cashu lifecycle on Postgres)
exercise the production code path.

## Running

```bash
# Demo (mock data)
deno run --allow-all example/two-party-binary-bet/src/demo.ts

# Server
deno run --allow-all example/two-party-binary-bet/server.ts

# All example tests (no Docker required)
deno test --allow-all example/two-party-binary-bet/

# Real Cashu mint E2E (requires `docker compose up -d` + init-regtest.sh)
deno task test:regtest

# FROST 2-of-3 cluster (after building crates/frost-signer)
example/two-party-binary-bet/scripts/frost-dkg-bootstrap.ts --threshold 2 --total 3
example/two-party-binary-bet/scripts/frost-oracle-cluster.ts
```

## Files

```
src/
  server-routes.ts          — Market HTTP API (order book, matching, resolution)
  market-types.ts           — Type definitions
  market-oracle.ts          — Condition evaluation, payout calculation
  order-book.ts             — FIFO matching interface + in-memory impl
  order-book-postgres.ts    — Postgres-backed impl (used when DATABASE_URL set)
  resolution.ts             — DualPreimageStore (HTLC) / DualKeyStore (FROST) resolution
  match-coordinator.ts      — Cross-HTLC match execution via @anchr/cashu-conditional-swap
  market-api-routes.ts      — REST endpoints
  market-signer-endpoints.ts — FROST signing-coordinator HTTP endpoints
  nostr-market.ts           — Nostr event builder (kind 30078)
  attack-scenarios.test.ts  — Attack vector tests (6 scenarios)
ui/
  wallet.ts                 — Browser Cashu wallet (localStorage)
  keypair.ts                — Nostr keypair management
  api.ts                    — API client
  MarketApp.tsx             — React UI
```

## Known attack vectors (tested)

| Attack | Status | Test |
|---|---|---|
| Locktime refund race | Mitigated | `attack-scenarios.test.ts` Attack 1 |
| Oracle double-signing both outcomes | Wash, no theft | `frost-conditional-swap.test.ts` (DualKeyStore deletes losing key on first sign) + `attack-scenarios.test.ts` Attack 2 |
| Oracle signature must match proof secret | Enforced | `attack-scenarios.test.ts` Attack 3 |
| Loser cannot redeem with winner's signature | Rejected by mint | `attack-scenarios.test.ts` Attack 4 |
| Cross-market replay | Safe (per-proof signing) | `attack-scenarios.test.ts` Attack 5 |
| Insufficient signatures without Oracle | Rejected by mint | `attack-scenarios.test.ts` Attack 6 + `frost-p2pk-cashu.test.ts` step 7 |
| Matchmaker DoS | Mitigated by Nostr redundancy | (manual; multiple matchmakers + Nostr publish) |
