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

import { configure, getConsoleSink } from "@logtape/logtape";
import {
  getLogger as sharedGetLogger,
  type Logger,
} from "@anchr/core-runtime/logger";

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
  const level =
    (Deno.env.get("ANCHR_LOG_LEVEL") ?? Deno.env.get("LOG_LEVEL") ?? "info")
      .toLowerCase();
  await configure({
    sinks: { console: getConsoleSink() },
    loggers: [
      {
        category: ["anchr"],
        lowestLevel: level as "debug" | "info" | "warning" | "error" | "fatal",
        sinks: ["console"],
      },
      {
        category: ["logtape", "meta"],
        lowestLevel: "warning",
        sinks: ["console"],
      },
    ],
  });
  configured = true;
}

export type { Logger };

/**
 * Convenience accessor. Auto-configures on first use so callers don't need
 * to remember to call `configureLogger()` themselves. Returns a console-
 * compatible facade so existing variadic call sites work unchanged.
 */
export function getLogger(category: string | readonly string[]): Logger {
  if (!configured) {
    void configureLogger();
  }
  return sharedGetLogger(category);
}

/** Pre-built logger for the top-level "anchr" namespace. */
export const log: Logger = getLogger(["anchr"]);
