import { getRuntimeConfig } from "./config";
import { setupServerLogCapture } from "./log-stream";
import { createPreimageStore } from "../oracle/preimage-store";
import { createQueryService } from "../application/query-service";
import { buildWorkerApiApp, prepareWorkerApiAssets } from "./worker-api";
// @ts-ignore — Bun HTML import
import uiHtml from "../ui/index.html";
// @ts-ignore — Bun HTML import
import requesterHtml from "../ui/requester/index.html";
// @ts-ignore — Bun HTML import
import dashboardHtml from "../ui/dashboard/index.html";

export async function startReferenceApp() {
  setupServerLogCapture();
  await prepareWorkerApiAssets();

  const preimageStore = createPreimageStore();

  const queryService = createQueryService({
    preimageStore,
  });

  const app = buildWorkerApiApp({ queryService, preimageStore });
  const port = getRuntimeConfig().referenceAppPort;

  Bun.serve({
    port,
    routes: {
      "/": uiHtml,
      "/requester": requesterHtml,
      "/dashboard": dashboardHtml,
    },
    fetch: app.fetch,
  });

  console.error(`[reference-app] Worker    → http://localhost:${port}`);
  console.error(`[reference-app] Requester → http://localhost:${port}/requester`);
  console.error(`[reference-app] Dashboard → http://localhost:${port}/dashboard`);
}
