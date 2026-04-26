/**
 * Centralised logger for the Anchr host server.
 *
 * Built on @logtape/logtape so log output is structured, levelable, and
 * routable to multiple sinks (stderr by default, plus future file / OTLP
 * sinks once configured by the host operator).
 *
 * Usage:
 *
 *   import { getLogger } from "@/infrastructure/logger";
 *   const log = getLogger(["anchr", "verifier"]);
 *   log.info("verification passed", { queryId, oracleId });
 *
 * Categories follow a `[product, module, sub]` convention so operators can
 * filter at runtime (e.g. only see `[anchr, frost, *]`).
 */

import { configure, getConsoleSink, getLogger as ltGetLogger } from "@logtape/logtape";

let configured = false;

/**
 * One-time configuration. Idempotent — safe to call from multiple modules.
 *
 * The default level is read from `ANCHR_LOG_LEVEL` (or `LOG_LEVEL` as
 * fallback) and defaults to "info". Setting it to "debug" reveals the
 * subsystem chatter; "warning" silences info/debug.
 */
export async function configureLogger(): Promise<void> {
  if (configured) return;
  const level = (Deno.env.get("ANCHR_LOG_LEVEL") ?? Deno.env.get("LOG_LEVEL") ?? "info").toLowerCase();
  await configure({
    sinks: { console: getConsoleSink() },
    loggers: [
      { category: ["anchr"], lowestLevel: level as "debug" | "info" | "warning" | "error" | "fatal", sinks: ["console"] },
      // logtape's own meta logger — keep at warning to avoid noise
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
    ],
  });
  configured = true;
}

/**
 * Convenience accessor. Auto-configures on first use so callers don't need
 * to remember to call `configureLogger()` themselves.
 */
export function getLogger(category: string | readonly string[]) {
  if (!configured) {
    // Synchronously trigger configuration; the `configure` call resolves on
    // the next microtask but we accept that the very first log line in a
    // process may be queued behind that promise.
    void configureLogger();
  }
  return ltGetLogger(category);
}

/** Pre-built logger for the top-level "anchr" namespace. */
export const log = ltGetLogger(["anchr"]);
