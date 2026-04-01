/**
 * Real-time log streaming infrastructure.
 * Captures server console output and provides a subscriber interface
 * for SSE endpoints to stream logs to browsers.
 */

export interface LogEntry {
  service: string;
  message: string;
  ts: number;
}

type LogListener = (entry: LogEntry) => void;

const listeners = new Set<LogListener>();
const buffer: LogEntry[] = [];
const MAX_BUFFER = 300;

export function emitLog(service: string, message: string): void {
  const entry: LogEntry = { service, message, ts: Date.now() };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
  for (const fn of listeners) {
    try { fn(entry); } catch {}
  }
}

export function subscribeLog(fn: LogListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getRecentLogs(n = 50): LogEntry[] {
  return buffer.slice(-n);
}

let captured = false;

/** Intercept console.error / console.log to emit as "anchr" service logs. */
export function setupServerLogCapture(): void {
  if (captured) return;
  captured = true;

  const origError = console.error;
  const origLog = console.log;

  function format(args: unknown[]): string {
    return args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  }

  console.error = (...args: unknown[]) => {
    origError.apply(console, args);
    emitLog("anchr", format(args));
  };

  console.log = (...args: unknown[]) => {
    origLog.apply(console, args);
    emitLog("anchr", format(args));
  };
}
