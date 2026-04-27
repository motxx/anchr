/**
 * Continuous market-maker bot runner.
 *
 * Seeds Polymarket-style markets if the server is empty, funds a fleet of
 * bots from the regtest Lightning faucet (one-time), then loops them
 * through `runOneRound` at a configurable interval. Bots top up from the
 * faucet when their balance dips below a refund threshold.
 *
 * Usage (defaults shown):
 *   ANCHR_SERVER=http://localhost:3001 \
 *   CASHU_MINT_URL=http://localhost:3338 \
 *   FLEET_INTERVAL_MS=15000 \
 *   YES_BOTS=4 NO_BOTS=4 FUNDING_SATS=131072 \
 *     deno run --allow-all scripts/bot-fleet/run.ts
 *
 * Stop with Ctrl-C. Each iteration logs totals so you can watch pool
 * ratios converge toward each market's `yes_bias`.
 */

import {
  fundFleet,
  runOneRound,
  seedMarkets,
  type SeededMarket,
} from "./fleet.ts";
import { POLYMARKET_SEED_MARKETS } from "./markets.ts";

const SERVER = (Deno.env.get("ANCHR_SERVER") ?? "http://localhost:3001").replace(/\/$/, "");
const MINT = Deno.env.get("CASHU_MINT_URL") ?? "http://localhost:3338";
const INTERVAL_MS = Number(Deno.env.get("FLEET_INTERVAL_MS") ?? 15_000);
const YES_BOTS = Number(Deno.env.get("YES_BOTS") ?? 4);
const NO_BOTS = Number(Deno.env.get("NO_BOTS") ?? 4);
const FUNDING_SATS = Number(Deno.env.get("FUNDING_SATS") ?? 131_072);
const BET_SIZE_FACTOR = Number(Deno.env.get("BET_SIZE_FACTOR") ?? 0.05);

console.log(`[fleet-run] server=${SERVER} mint=${MINT}`);
console.log(`[fleet-run] interval=${INTERVAL_MS}ms bots=${YES_BOTS}+${NO_BOTS} funding=${FUNDING_SATS}sats factor=${BET_SIZE_FACTOR}`);

// --- Seed markets (idempotent: skip if server already has open markets) ---
async function ensureSeed(): Promise<SeededMarket[]> {
  const existing = await fetch(`${SERVER}/markets`).then((r) => r.json()) as Array<{
    id: string;
    title: string;
    category: string;
    status: string;
  }>;
  const open = existing.filter((m) => m.status === "open");
  if (open.length >= POLYMARKET_SEED_MARKETS.length) {
    console.log(`[fleet-run] using ${open.length} existing open markets`);
    // Reconstruct SeededMarket entries by matching titles.
    return POLYMARKET_SEED_MARKETS.flatMap((seed) => {
      const m = open.find((o) => o.title === seed.title);
      return m ? [{ id: m.id, seed }] : [];
    });
  }
  console.log(`[fleet-run] seeding ${POLYMARKET_SEED_MARKETS.length} Polymarket-aligned markets…`);
  return seedMarkets(SERVER, POLYMARKET_SEED_MARKETS);
}

const markets = await ensureSeed();
console.log(`[fleet-run] active markets: ${markets.length}`);

// --- Fund bots once ---
console.log(`[fleet-run] funding ${YES_BOTS + NO_BOTS} bots from regtest Lightning…`);
const profiles = await fundFleet({
  serverUrl: SERVER,
  mintUrl: MINT,
  yesLeaningBots: YES_BOTS,
  noLeaningBots: NO_BOTS,
  fundingSatsPerBot: FUNDING_SATS,
});
console.log(`[fleet-run] fleet ready (${profiles.length} bots)`);

// --- Run continuously ---
let stop = false;
Deno.addSignalListener("SIGINT", () => {
  console.log("\n[fleet-run] Ctrl-C received — exiting after current round");
  stop = true;
});

let round = 0;
while (!stop) {
  round++;
  const start = Date.now();
  try {
    const result = await runOneRound(profiles, markets, {
      rngSeed: Date.now() & 0xffffffff,
      betSizeFactor: BET_SIZE_FACTOR,
    });
    const elapsed = Date.now() - start;
    const totalBalance = profiles.reduce((s, p) => s + p.bot.balanceSats(), 0);
    console.log(
      `[fleet-run] round=${round} bets=${result.totalBets} ` +
      `committed=${result.totalCommittedSats}sats locked=${result.pairsLocked} ` +
      `elapsed=${elapsed}ms fleetBalance=${totalBalance}sats`,
    );
  } catch (err) {
    console.warn(`[fleet-run] round=${round} threw: ${err instanceof Error ? err.message : err}`);
  }
  if (stop) break;
  await new Promise<void>((resolve) => setTimeout(resolve, INTERVAL_MS));
}

console.log(`[fleet-run] stopped after ${round} rounds`);
Deno.exit(0);
