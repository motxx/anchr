/**
 * Console-compatible logger backed by @logtape/logtape.
 *
 * Shared across all @anchr packages so logging stays uniform without each
 * package reimplementing the variadic console-style facade. The host server
 * (src/infrastructure/logger.ts) configures the underlying logTape pipeline;
 * packages just call `getLogger([...])` and emit.
 */

import { getLogger as ltGetLogger } from "@logtape/logtape";

function formatArg(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
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
  const lt = ltGetLogger(category);
  return {
    debug: (...a) => lt.debug(joinArgs(a)),
    info: (...a) => lt.info(joinArgs(a)),
    warn: (...a) => lt.warn(joinArgs(a)),
    error: (...a) => lt.error(joinArgs(a)),
    fatal: (...a) => lt.fatal(joinArgs(a)),
  };
}
