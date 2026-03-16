import { getRuntimeConfig } from "./config";
import { buildWorkerApiApp, prepareWorkerApiAssets } from "./worker-api";
// @ts-ignore — Bun HTML import
import uiHtml from "./ui/index.html";
// @ts-ignore — Bun HTML import
import requesterHtml from "./ui/requester/index.html";

export async function startReferenceApp() {
  await prepareWorkerApiAssets();

  const app = buildWorkerApiApp();
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
}
