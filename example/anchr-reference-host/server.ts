/**
 * Anchr reference host — minimal deployment example.
 *
 * `startReferenceRuntime()` from `@anchr/bounty` wires the standard
 * QueryService + worker-api (HTTP) + scheduler + log capture, then serves on
 * `HTTP_API_PORT` (default 3000).
 *
 * Operators that need extra HTTP routes should call `composeHost({
 * extraRoutes })` instead — see `example/data-marketplace/`. MCP stdio lives
 * in `example/anchr-mcp/`.
 */

import { startReferenceRuntime } from "@anchr/bounty";

await startReferenceRuntime();
