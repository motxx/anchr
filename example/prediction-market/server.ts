/**
 * Standalone Prediction Market server.
 *
 * Runs the prediction market as an independent application,
 * separate from the Anchr protocol server.
 *
 * Usage:
 *   deno run --allow-all example/prediction-market/server.ts
 *
 * With FROST threshold Oracle:
 *   FROST_MARKET_CONFIG_PATH=.frost-market/signer-1.json \
 *   CASHU_MINT_URL=http://localhost:3338 \
 *   deno run --allow-all example/prediction-market/server.ts
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/deno";
import type { MiddlewareHandler } from "hono";
import { registerMarketRoutes } from "./src/server-routes.ts";

const app = new Hono();
app.use("*", cors());

// No auth for demo — production should add API key middleware
const noopMiddleware: MiddlewareHandler = async (_c, next) => await next();

registerMarketRoutes(app, {
  writeAuth: noopMiddleware,
  rateLimit: noopMiddleware,
});

// Serve UI static files
app.get("/", serveStatic({ path: "./example/prediction-market/ui/index.html" }));
app.get("/generated.css", serveStatic({ path: "./example/prediction-market/ui/generated.css" }));
app.get("/main.js", serveStatic({ path: "./example/prediction-market/ui/main.js" }));
app.get("/main.js.map", serveStatic({ path: "./example/prediction-market/ui/main.js.map" }));

const port = Number(Deno.env.get("MARKET_PORT")) || 3001;
console.log(`Prediction Market server on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
