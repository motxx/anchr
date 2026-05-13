/**
 * Continuous market-maker bot runner.
 *
 * Seeds Polymarket-style markets if the server is empty, funds a fleet of
 * bots, then loops them through `runOneRound` at a configurable interval.
 *
 * Funding source is selected automatically:
 *   - if CASHU_MINT_URL is set explicitly, use it.
 *   - otherwise, query <server>/markets/wallet/config and use whatever
 *     mint that endpoint advertises.
 *   FUNDING=fakewallet skips Lightning entirely (testnut.cashu.space mode).
 *   FUNDING=regtest pays via lncli inside docker compose (default).
 *
 * The runner does NOT publish to Nostr relays of its own choosing —
 * matchmaker traffic is HTTP-only against the configured server. NIP-60
 * persistence is only active in the UI; bots hold proofs in-process.
 *
 * Usage (regtest, default):
 *   ANCHR_SERVER=http://localhost:3001 \
 *   CASHU_MINT_URL=http://localhost:3338 \
 *   deno run --allow-all scripts/bot-fleet/run.ts
 *
 * Usage (production, anchr-market.fly.dev with testnut fakewallet):
 *   ANCHR_SERVER=https://anchr-market.fly.dev \
 *   FUNDING=fakewallet \
 *   YES_BOTS=4 NO_BOTS=4 FUNDING_SATS=10000 BET_SIZE_FACTOR=0.05 \
 *   FLEET_INTERVAL_MS=30000 \
 *     deno run --allow-all scripts/bot-fleet/run.ts
 *
 * Stop with Ctrl-C.
 */

import {
  fundFleet,
  runOneRound,
  type SeededMarket,
  seedMarkets,
} from "./fleet.ts";
import { POLYMARKET_SEED_MARKETS } from "./markets.ts";

const SERVER = (Deno.env.get("ANCHR_SERVER") ?? "http://localhost:3001")
  .replace(/\/$/, "");
const FUNDING_STRATEGY = (Deno.env.get("FUNDING") ?? "regtest") as
  | "regtest"
  | "fakewallet";
const INTERVAL_MS = Number(Deno.env.get("FLEET_INTERVAL_MS") ?? 15_000);
const YES_BOTS = Number(Deno.env.get("YES_BOTS") ?? 4);
const NO_BOTS = Number(Deno.env.get("NO_BOTS") ?? 4);
const FUNDING_SATS = Number(Deno.env.get("FUNDING_SATS") ?? 131_072);
const BET_SIZE_FACTOR = Number(Deno.env.get("BET_SIZE_FACTOR") ?? 0.05);

// Discover the mint URL the server advertises if the operator didn't pin
// one explicitly — keeps the runner aligned with whatever the deployed
// market is actually using.
async function resolveMintUrl(): Promise<string> {
  const env = Deno.env.get("CASHU_MINT_URL");
  if (env) return env;
  const config = await fetch(`${SERVER}/markets/wallet/config`).then((r) =>
    r.json()
  ) as {
    mint_url: string | null;
  };
  if (!config.mint_url) {
    throw new Error(`server at ${SERVER} has no mint_url configured`);
  }
  return config.mint_url;
}
const MINT = await resolveMintUrl();

console.log(
  `[fleet-run] server=${SERVER} mint=${MINT} funding=${FUNDING_STRATEGY}`,
);
console.log(
  `[fleet-run] interval=${INTERVAL_MS}ms bots=${YES_BOTS}+${NO_BOTS} funding=${FUNDING_SATS}sats factor=${BET_SIZE_FACTOR}`,
);

// --- Seed markets (idempotent: skip if server already has open markets) ---
async function ensureSeed(): Promise<SeededMarket[]> {
  const existing = await fetch(`${SERVER}/markets`).then((r) =>
    r.json()
  ) as Array<{
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
  console.log(
    `[fleet-run] seeding ${POLYMARKET_SEED_MARKETS.length} Polymarket-aligned markets…`,
  );
  return seedMarkets(SERVER, POLYMARKET_SEED_MARKETS);
}

const markets = await ensureSeed();
console.log(`[fleet-run] active markets: ${markets.length}`);

// --- Fund bots once ---
console.log(
  `[fleet-run] funding ${YES_BOTS + NO_BOTS} bots via ${FUNDING_STRATEGY}…`,
);
const profiles = await fundFleet({
  serverUrl: SERVER,
  mintUrl: MINT,
  yesLeaningBots: YES_BOTS,
  noLeaningBots: NO_BOTS,
  fundingSatsPerBot: FUNDING_SATS,
  funding: FUNDING_STRATEGY,
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
    console.warn(
      `[fleet-run] round=${round} threw: ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
  if (stop) break;
  await new Promise<void>((resolve) => setTimeout(resolve, INTERVAL_MS));
}

console.log(`[fleet-run] stopped after ${round} rounds`);
Deno.exit(0);
