import { getRuntimeConfig } from "./config";
import { buildWorkerApiApp, prepareWorkerApiAssets } from "./worker-api";
// @ts-ignore — Bun HTML import
import uiHtml from "./ui/index.html";

export async function startReferenceApp() {
  await prepareWorkerApiAssets();

  const app = buildWorkerApiApp();
  const port = getRuntimeConfig().referenceAppPort;

  Bun.serve({
    port,
    routes: {
      "/": uiHtml,
    },
    fetch: app.fetch,
  });

  console.error(`[reference-app] Dashboard → http://localhost:${port}`);
}
