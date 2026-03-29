import { createBountyToken, isCashuEnabled } from "./cashu/wallet";
import { createWalletStore } from "./cashu/wallet-store";
import { getRuntimeConfig } from "./config";
import { setupServerLogCapture } from "./log-stream";
import { createPreimageStore } from "./oracle/preimage-store";
import { createQueryService } from "./query-service";
import { buildWorkerApiApp, prepareWorkerApiAssets } from "./worker-api";
// @ts-ignore — Bun HTML import
import uiHtml from "./ui/index.html";
// @ts-ignore — Bun HTML import
import requesterHtml from "./ui/requester/index.html";

const REQUESTER_DEMO_PUBKEY = "requester_demo";

export async function startReferenceApp() {
  setupServerLogCapture();
  await prepareWorkerApiAssets();

  const preimageStore = createPreimageStore();
  const walletStore = createWalletStore();

  const queryService = createQueryService({
    preimageStore,
    walletStore,
  });

  const app = buildWorkerApiApp({ queryService, preimageStore, walletStore });
  const port = getRuntimeConfig().referenceAppPort;

  Bun.serve({
    port,
    routes: {
      "/": uiHtml,
      "/requester": requesterHtml,
    },
    fetch: app.fetch,
  });

  console.error(`[reference-app] Worker    → http://localhost:${port}`);
  console.error(`[reference-app] Requester → http://localhost:${port}/requester`);

  // Seed requester wallet with initial proofs (async, non-blocking)
  if (isCashuEnabled()) {
    const initialSats = parseInt(process.env.REQUESTER_INITIAL_BALANCE_SATS ?? "1000", 10);
    createBountyToken(initialSats).then((result) => {
      if (result) {
        walletStore.addProofs("requester", REQUESTER_DEMO_PUBKEY, result.proofs);
        console.error(`[wallet] Requester seeded with ${initialSats} sats (${result.proofs.length} proofs)`);
      } else {
        console.error("[wallet] Could not mint initial requester proofs (Cashu mint unreachable?)");
      }
    }).catch((err) => {
      console.error("[wallet] Failed to seed requester wallet:", err);
    });
  }
}
