/**
 * Console-compatible logger backed by @logtape/logtape.
 *
 * Shared across all @anchr packages so logging stays uniform without each
 * package reimplementing the variadic console-style facade. On first use the
 * SDK registers a console sink whose lowest level comes from
 * `ANCHR_LOG_LEVEL` (fallback `LOG_LEVEL`, default `info`). A host that wants
 * to own the pipeline configures logTape itself with `reset: true` — the
 * SDK's best-effort configuration never overrides an existing one.
 */

import {
  configureSync,
  getConsoleSink,
  getLogger as ltGetLogger,
  type LogLevel,
  type Sink,
} from "@logtape/logtape";
import { getLoggingConfig, type LoggingRuntimeConfig } from "./config.ts";

const LEVEL_ALIASES: Record<string, LogLevel> = {
  trace: "trace",
  debug: "debug",
  info: "info",
  warn: "warning",
  warning: "warning",
  error: "error",
  fatal: "fatal",
};

function configuredLogLevel(config: LoggingRuntimeConfig): LogLevel {
  const raw = config.logLevel?.trim().toLowerCase();
  return (raw !== undefined ? LEVEL_ALIASES[raw] : undefined) ?? "info";
}

export interface AnchrLoggingOptions {
  /** Sink receiving every record (default: logTape console sink). */
  sink?: Sink;
  /** Replace an existing logTape configuration instead of yielding to it. */
  reset?: boolean;
  /** Host-supplied logging config. Defaults to the server config adapter. */
  config?: LoggingRuntimeConfig;
}

let configured = false;

/**
 * Register the SDK logging pipeline. Reads the lowest level from
 * `ANCHR_LOG_LEVEL` / `LOG_LEVEL` at call time. Safe to call once from the
 * host with a custom sink; the implicit first-`getLogger` call uses the
 * defaults and yields when logTape is already configured.
 */
export function configureAnchrLogging(
  options: AnchrLoggingOptions = {},
): void {
  configured = true;
  try {
    const config = options.config ?? getLoggingConfig();
    configureSync({
      reset: options.reset ?? false,
      sinks: { anchr: options.sink ?? getConsoleSink() },
      loggers: [
        {
          category: [],
          sinks: ["anchr"],
          lowestLevel: configuredLogLevel(config),
        },
        {
          category: ["logtape", "meta"],
          sinks: ["anchr"],
          lowestLevel: "warning",
        },
      ],
    });
  } catch {
    // logTape is already configured by the host — its pipeline wins.
  }
}

function ensureConfigured(): void {
  if (configured) return;
  configureAnchrLogging();
}

function formatArg(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function joinArgs(args: unknown[]): string {
  return args.map(formatArg).join(" ");
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  fatal(...args: unknown[]): void;
}

export function getLogger(category: string | readonly string[]): Logger {
  ensureConfigured();
  const lt = ltGetLogger(category);
  return {
    debug: (...a) => lt.debug(joinArgs(a)),
    info: (...a) => lt.info(joinArgs(a)),
    warn: (...a) => lt.warn(joinArgs(a)),
    error: (...a) => lt.error(joinArgs(a)),
    fatal: (...a) => lt.fatal(joinArgs(a)),
  };
}
