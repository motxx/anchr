import { getRuntimeConfig } from "./config";
import { setupServerLogCapture } from "./log-stream";
import { createPreimageStore } from "./cashu/preimage-store";
import { createQueryService } from "../application/query-service";
import { buildWorkerApiApp, prepareWorkerApiAssets } from "./worker-api";
import { serveStatic } from "hono/deno";
import { normalizeQueryResult } from "./attachments";
import { publishQueryToRelay } from "./nostr/relay-publish";
import { createOracleRegistry } from "./oracle/registry";

export async function startReferenceApp() {
  setupServerLogCapture();
  await prepareWorkerApiAssets();

  const preimageStore = createPreimageStore();
  const oracleRegistry = createOracleRegistry();

  const queryService = createQueryService({
    preimageStore,
    oracleRegistry,
    normalizeResult: normalizeQueryResult,
    hooks: { onCreated: publishQueryToRelay },
  });

  const app = buildWorkerApiApp({ queryService, preimageStore });
  const port = getRuntimeConfig().referenceAppPort;

  // Static UI routes — must be registered after API routes in Hono,
  // but API routes are prefix-matched so these exact paths won't conflict.
  app.get("/assets/*", serveStatic({ root: "./dist/ui/" }));
  // Each UI entrypoint has its own main.js + generated.css bundle.
  // Serve per-page assets so ./main.js resolves correctly from each path.
  app.get("/requester/main.js", serveStatic({ path: "./dist/ui/requester/main.js" }));
  app.get("/requester/main.js.map", serveStatic({ path: "./dist/ui/requester/main.js.map" }));
  app.get("/requester/generated.css", serveStatic({ path: "./dist/ui/requester/generated.css" }));
  app.get("/requester/", serveStatic({ path: "./dist/ui/requester/index.html" }));
  app.get("/requester", (c) => c.redirect("/requester/"));
  app.get("/dashboard/main.js", serveStatic({ path: "./dist/ui/dashboard/main.js" }));
  app.get("/dashboard/main.js.map", serveStatic({ path: "./dist/ui/dashboard/main.js.map" }));
  app.get("/dashboard/generated.css", serveStatic({ path: "./dist/ui/dashboard/generated.css" }));
  app.get("/dashboard/", serveStatic({ path: "./dist/ui/dashboard/index.html" }));
  app.get("/dashboard", (c) => c.redirect("/dashboard/"));
  app.get("/main.js", serveStatic({ path: "./dist/ui/main.js" }));
  app.get("/main.js.map", serveStatic({ path: "./dist/ui/main.js.map" }));
  app.get("/generated.css", serveStatic({ path: "./dist/ui/generated.css" }));
  app.get("/", serveStatic({ path: "./dist/ui/index.html" }));

  Deno.serve({ port }, app.fetch);

  console.error(`[reference-app] Worker    → http://localhost:${port}`);
  console.error(`[reference-app] Requester → http://localhost:${port}/requester`);
  console.error(`[reference-app] Dashboard → http://localhost:${port}/dashboard`);
}
