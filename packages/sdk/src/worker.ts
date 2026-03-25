/**
 * Anchr Auto-Worker — automatically fulfills TLSNotary queries.
 *
 * Polls for open queries, runs tlsn-prove against target URLs,
 * and submits cryptographic presentations to the Anchr server.
 *
 * @example
 * ```typescript
 * import { AnchrWorker } from "anchr-sdk/worker";
 *
 * const worker = new AnchrWorker({
 *   serverUrl: "http://localhost:3000",
 *   verifierHost: "localhost:7047",
 *   proverBin: "./crates/tlsn-prover/target/debug/tlsn-prove",
 * });
 *
 * worker.on("fulfilled", (queryId, result) => {
 *   console.log(`Query ${queryId}: ${result.ok ? "approved" : "rejected"}`);
 * });
 *
 * await worker.start();
 * ```
 */

import { Anchr, type QueryCondition } from "./index";

// --- Types ---

export interface AnchrWorkerConfig {
  /** Anchr server URL */
  serverUrl: string;
  /** Verifier server host:port for TCP mode, or ws:// URL for WS mode */
  verifierHost: string;
  /** Path to tlsn-prove binary */
  proverBin?: string;
  /** API key for Anchr server */
  apiKey?: string;
  /** Polling interval in ms (default: 5000) */
  pollIntervalMs?: number;
  /** Max concurrent proofs (default: 1) */
  maxConcurrent?: number;
  /** Minimum bounty in sats to accept (default: 0) */
  minBountySats?: number;
  /** Filter: only accept queries for these domains (empty = all) */
  allowedDomains?: string[];
}

export interface FulfilledEvent {
  queryId: string;
  ok: boolean;
  message: string;
  targetUrl: string;
  durationMs: number;
}

type EventHandler = {
  fulfilled: (event: FulfilledEvent) => void;
  error: (queryId: string, error: Error) => void;
  polling: (openCount: number) => void;
};

// --- Worker ---

export class AnchrWorker {
  private config: Required<AnchrWorkerConfig>;
  private anchr: Anchr;
  private running = false;
  private activeCount = 0;
  private processedIds = new Set<string>();
  private handlers: Partial<{ [K in keyof EventHandler]: EventHandler[K][] }> = {};

  constructor(config: AnchrWorkerConfig) {
    this.config = {
      serverUrl: config.serverUrl,
      verifierHost: config.verifierHost,
      proverBin: config.proverBin ?? this.findProverBin(),
      apiKey: config.apiKey ?? "",
      pollIntervalMs: config.pollIntervalMs ?? 5000,
      maxConcurrent: config.maxConcurrent ?? 1,
      minBountySats: config.minBountySats ?? 0,
      allowedDomains: config.allowedDomains ?? [],
    };

    this.anchr = new Anchr({
      serverUrl: this.config.serverUrl,
      apiKey: this.config.apiKey,
    });
  }

  /** Register an event handler */
  on<K extends keyof EventHandler>(event: K, handler: EventHandler[K]): this {
    if (!this.handlers[event]) this.handlers[event] = [];
    (this.handlers[event] as EventHandler[K][]).push(handler);
    return this;
  }

  private emit<K extends keyof EventHandler>(event: K, ...args: Parameters<EventHandler[K]>): void {
    for (const handler of (this.handlers[event] ?? []) as EventHandler[K][]) {
      (handler as Function)(...args);
    }
  }

  /** Start the auto-worker loop */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.error(`[anchr-worker] Started (server: ${this.config.serverUrl}, verifier: ${this.config.verifierHost})`);

    while (this.running) {
      try {
        await this.poll();
      } catch (e) {
        console.error("[anchr-worker] Poll error:", (e as Error).message);
      }
      await sleep(this.config.pollIntervalMs);
    }
  }

  /** Stop the auto-worker */
  stop(): void {
    this.running = false;
    console.error("[anchr-worker] Stopped");
  }

  /** Run once: poll, fulfill one query, return */
  async runOnce(): Promise<FulfilledEvent | null> {
    const queries = await this.fetchEligibleQueries();
    if (queries.length === 0 || !queries[0]) return null;
    return this.fulfillQuery(queries[0]);
  }

  // --- Internal ---

  private async poll(): Promise<void> {
    if (this.activeCount >= this.config.maxConcurrent) return;

    const queries = await this.fetchEligibleQueries();
    this.emit("polling", queries.length);

    for (const query of queries) {
      if (this.activeCount >= this.config.maxConcurrent) break;
      if (this.processedIds.has(query.id)) continue;

      this.processedIds.add(query.id);
      this.activeCount++;

      // Fire and forget (don't block the poll loop)
      this.fulfillQuery(query)
        .catch((e) => this.emit("error", query.id, e as Error))
        .finally(() => {
          this.activeCount--;
          // Clean up old IDs to prevent memory leak
          if (this.processedIds.size > 10000) {
            const ids = Array.from(this.processedIds);
            this.processedIds = new Set(ids.slice(-5000));
          }
        });
    }
  }

  private async fetchEligibleQueries(): Promise<QueryInfo[]> {
    const queries = await this.anchr.listOpenQueries();

    return queries.filter((q) => {
      // Only TLSNotary queries
      if (!Array.isArray(q.verification_requirements) || !q.verification_requirements.includes("tlsn")) return false;
      if (!q.tlsn_requirements?.target_url) return false;

      // Bounty filter
      const bounty = q.bounty?.amount_sats ?? 0;
      if (bounty < this.config.minBountySats) return false;

      // Domain filter
      if (this.config.allowedDomains.length > 0) {
        try {
          const domain = new URL(q.tlsn_requirements.target_url).hostname;
          if (!this.config.allowedDomains.includes(domain)) return false;
        } catch {
          return false;
        }
      }

      // Not already processed
      if (this.processedIds.has(q.id)) return false;

      return true;
    }) as QueryInfo[];
  }

  private async fulfillQuery(query: QueryInfo): Promise<FulfilledEvent> {
    const targetUrl = query.tlsn_requirements!.target_url;
    const start = Date.now();

    console.error(`[anchr-worker] Fulfilling ${query.id}: ${targetUrl}`);

    // 1. Run tlsn-prove to generate presentation
    const presentationB64 = await this.generateProof(targetUrl);

    // 2. Submit to Anchr
    const result = await this.anchr.submitPresentation(query.id, presentationB64);

    const event: FulfilledEvent = {
      queryId: query.id,
      ok: result.ok,
      message: result.message,
      targetUrl,
      durationMs: Date.now() - start,
    };

    console.error(
      `[anchr-worker] ${query.id}: ${result.ok ? "APPROVED" : "REJECTED"} (${event.durationMs}ms)`,
    );

    this.emit("fulfilled", event);
    return event;
  }

  private async generateProof(targetUrl: string): Promise<string> {
    const tmpFile = `/tmp/anchr-worker-${Date.now()}.presentation.tlsn`;

    const proc = Bun.spawn([
      this.config.proverBin,
      "--verifier", this.config.verifierHost,
      targetUrl,
      "-o", tmpFile,
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`tlsn-prove failed (exit ${proc.exitCode}): ${stderr.slice(0, 1000)}`);
    }

    // stdout contains base64 presentation
    const stdout = await new Response(proc.stdout).text();
    const b64 = stdout.trim();

    // Clean up temp file
    try { await Bun.write(tmpFile, ""); } catch { /* ignore */ }

    if (!b64 || b64.length < 100) {
      throw new Error("tlsn-prove produced empty or invalid output");
    }

    return b64;
  }

  private findProverBin(): string {
    // Try common locations
    const candidates = [
      "./crates/tlsn-prover/target/release/tlsn-prove",
      "./crates/tlsn-prover/target/debug/tlsn-prove",
    ];
    for (const path of candidates) {
      try {
        const stat = require("node:fs").statSync(path);
        if (stat.isFile()) return path;
      } catch { /* not found */ }
    }
    // Fallback to PATH
    return "tlsn-prove";
  }
}

// --- Helper types ---

interface QueryInfo {
  id: string;
  status: string;
  description: string;
  bounty?: { amount_sats: number };
  verification_requirements?: string[];
  tlsn_requirements?: { target_url: string; conditions?: QueryCondition[] };
  [key: string]: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export default AnchrWorker;
