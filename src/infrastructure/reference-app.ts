import { getRuntimeConfig } from "./config";
import { setupServerLogCapture } from "./log-stream";
import { createPreimageStore } from "./cashu/preimage-store";
import { createQueryService } from "../application/query-service";
import { buildWorkerApiApp, prepareWorkerApiAssets } from "./worker-api";
import { serveStatic } from "hono/deno";

export async function startReferenceApp() {
  setupServerLogCapture();
  await prepareWorkerApiAssets();

  const preimageStore = createPreimageStore();

  const queryService = createQueryService({
    preimageStore,
  });

  const app = buildWorkerApiApp({ queryService, preimageStore });
  const port = getRuntimeConfig().referenceAppPort;

  // Static UI routes — must be registered after API routes in Hono,
  // but API routes are prefix-matched so these exact paths won't conflict.
  app.get("/assets/*", serveStatic({ root: "./dist/ui/" }));
  app.get("/requester", serveStatic({ path: "./dist/ui/requester/index.html" }));
  app.get("/dashboard", serveStatic({ path: "./dist/ui/dashboard/index.html" }));
  app.get("/", serveStatic({ path: "./dist/ui/index.html" }));

  Deno.serve({ port }, app.fetch);

  console.error(`[reference-app] Worker    → http://localhost:${port}`);
  console.error(`[reference-app] Requester → http://localhost:${port}/requester`);
  console.error(`[reference-app] Dashboard → http://localhost:${port}/dashboard`);
}
