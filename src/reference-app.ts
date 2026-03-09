import { mkdirSync } from "node:fs";
import { getRuntimeConfig } from "./config";
import { UPLOADS_DIR } from "./attachments";
import { buildWorkerApiApp, prepareWorkerApiAssets } from "./worker-api";
// @ts-ignore — Bun HTML import
import uiHtml from "./ui/index.html";

export async function startReferenceApp() {
  await prepareWorkerApiAssets();
  mkdirSync(UPLOADS_DIR, { recursive: true });

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
