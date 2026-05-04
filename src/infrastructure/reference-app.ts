import { join } from "node:path";
import { spawn, fileExists, fileLastModified, moduleDir } from "@anchr/core-runtime/mod";
import { getRuntimeConfig } from "./config.ts";
import { setupServerLogCapture } from "./log-stream.ts";
import type { PreimageStore } from "@anchr/core-cashu/preimage-store";
import type { QueryService } from "../application/query-service.ts";
import { buildWorkerApiApp } from "./worker-api.ts";
import { serveStatic } from "hono/deno";
import type { OracleRegistry } from "./oracle/registry.ts";

import { getLogger } from "@anchr/core-runtime/logger";
const log = getLogger(["anchr", "reference-app"]);

export interface ReferenceAppDeps {
  queryService: QueryService;
  preimageStore: PreimageStore;
  oracleRegistry: OracleRegistry;
}

async function buildCssIfNeeded(cssIn: string, cssOut: string, label: string) {
  if (await fileExists(cssOut)) {
    const outStat = await fileLastModified(cssOut);
    const inStat = await fileLastModified(cssIn);
    if (outStat >= inStat) return;
  }
  const proc = spawn(["npx", "tailwindcss", "-i", cssIn, "-o", cssOut], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    log.error(`[css-build:${label}] Failed:`, await new Response(proc.stderr).text());
  }
}

async function prepareReferenceAppAssets() {
  // reference-app.ts lives at src/infrastructure/; the UI lives at
  // example/reference-app/ui/. Compute the project root and resolve
  // CSS source/output paths there.
  const projectRoot = join(moduleDir(import.meta), "../..");
  const uiRoot = join(projectRoot, "example/reference-app/ui");
  await Promise.all([
    buildCssIfNeeded(join(uiRoot, "globals.css"), join(uiRoot, "generated.css"), "worker"),
    buildCssIfNeeded(join(uiRoot, "requester/globals.css"), join(uiRoot, "requester/generated.css"), "requester"),
    buildCssIfNeeded(join(uiRoot, "dashboard/globals.css"), join(uiRoot, "dashboard/generated.css"), "dashboard"),
  ]);
}

export async function startReferenceApp(deps: ReferenceAppDeps) {
  setupServerLogCapture();
  await prepareReferenceAppAssets();

  const { queryService, preimageStore, oracleRegistry } = deps;
  const app = buildWorkerApiApp({ queryService, preimageStore, oracleRegistry });
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

  log.error(`Worker    → http://localhost:${port}`);
  log.error(`Requester → http://localhost:${port}/requester`);
  log.error(`Dashboard → http://localhost:${port}/dashboard`);
}
