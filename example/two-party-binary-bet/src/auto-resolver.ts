/**
 * Auto-resolver — background scheduler that resolves two-party binary bets
 * once their `resolution_deadline` has passed.
 *
 * For each due market it:
 *   1. Fetches `market.resolution_url` (today: plain HTTPS GET; PR-C
 *      replaces this with a real TLSNotary verification path).
 *   2. Evaluates the stored `resolution_condition` against the response
 *      body to derive a yes/no outcome.
 *   3. Calls `settleMarket(state, marketId, outcome, { verifiedBody })`
 *      which drives the same FROST / HTLC settlement path the manual
 *      `POST /markets/:id/resolve` HTTP handler uses.
 *
 * Operational properties:
 *   - Idempotent per-market: `settleMarket` rejects already-resolved
 *     markets, so re-attempts are safe.
 *   - Failures are logged and retried on the next poll. A flaky truth
 *     source delays resolution but doesn't permanently mark the market.
 *   - The poll cadence is bounded by `pollIntervalMs` (default 30s).
 */

import type { MarketState } from "./server-routes.ts";
import { evaluateCondition, OracleError } from "./market-oracle.ts";
import { settleMarket } from "./market-settlement.ts";
import { validateTruthSourceUrl } from "./url-guard.ts";

/** Hard ceiling on the truth-source response body. Anything bigger is dropped. */
const MAX_TRUTH_BODY_BYTES = 1_048_576; // 1 MiB
/** Per-fetch timeout. */
const TRUTH_FETCH_TIMEOUT_MS = 10_000;

export interface AutoResolverOpts {
  /** Poll cadence in milliseconds. Default 30 000 (30 s). */
  pollIntervalMs?: number;
  /** Inject a fetcher for tests / future TLSN integration. */
  fetchTruthSource?: (url: string) => Promise<string>;
  /** Override `Date.now()` for tests. */
  now?: () => number;
  /** Override the logger. Defaults to console. */
  log?: (level: "info" | "warn" | "error", msg: string) => void;
  /**
   * Run a resolution pass immediately on start. Default true so a
   * server restart catches up on already-due markets without waiting a
   * full poll interval. Tests set this to false to drive ticks
   * deterministically via `handle.tick()`.
   */
  runImmediately?: boolean;
}

export interface AutoResolverHandle {
  /** Stop the scheduler. Pending iterations finish. */
  stop: () => void;
  /** Run one resolution pass on demand (used by tests). */
  tick: () => Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;

const defaultLog = (level: "info" | "warn" | "error", msg: string) => {
  if (level === "info") console.log(`[auto-resolver] ${msg}`);
  else if (level === "warn") console.warn(`[auto-resolver] ${msg}`);
  else console.error(`[auto-resolver] ${msg}`);
};

/**
 * Default truth-source fetcher. Hardened against SSRF — re-validates the URL
 * even though server-routes already gates it at market creation (defense in
 * depth in case a market was loaded from disk / migrated from an older state),
 * disables redirect-following so a 302 to localhost can't bypass the host
 * check, caps body size, and times out the request.
 *
 * PR-C will replace this with a TLSNotary-verifying fetcher; the same controls
 * carry over to that path.
 */
const defaultFetcher = async (url: string): Promise<string> => {
  const validationError = validateTruthSourceUrl(url);
  if (validationError) {
    throw new Error(`refusing to fetch unsafe URL: ${validationError}`);
  }

  const res = await fetch(url, {
    headers: { "accept": "application/json, text/plain;q=0.9, */*;q=0.5" },
    redirect: "manual",
    signal: AbortSignal.timeout(TRUTH_FETCH_TIMEOUT_MS),
  });
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    throw new Error(
      `HTTP redirect ${res.status} not followed (truth source must be a direct response)`,
    );
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  // Size-bounded read so a malicious / misconfigured server can't OOM the resolver.
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_TRUTH_BODY_BYTES) {
        await reader.cancel();
        throw new Error(
          `truth-source body exceeded ${MAX_TRUTH_BODY_BYTES} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
};

/**
 * Start the background auto-resolver. Returns a handle the caller can
 * stop on shutdown.
 */
export function startAutoResolver(
  state: MarketState,
  opts?: AutoResolverOpts,
): AutoResolverHandle {
  const pollIntervalMs = opts?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const fetchTruth = opts?.fetchTruthSource ?? defaultFetcher;
  const now = opts?.now ?? (() => Date.now());
  const log = opts?.log ?? defaultLog;

  let stopped = false;
  let timer: number | undefined;

  async function resolveOne(marketId: string): Promise<void> {
    const market = state.markets.get(marketId);
    if (!market) return;
    if (market.status !== "open" && market.status !== "closed") return;

    const nowSecs = Math.floor(now() / 1000);
    if (market.resolution_deadline > nowSecs) return;

    log(
      "info",
      `market ${marketId} past deadline; fetching ${market.resolution_url}`,
    );

    let body: string;
    try {
      body = await fetchTruth(market.resolution_url);
    } catch (err) {
      log(
        "warn",
        `market ${marketId} fetch failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    let outcome: "yes" | "no";
    try {
      outcome = evaluateCondition(market.resolution_condition, body)
        ? "yes"
        : "no";
    } catch (err) {
      const reason = err instanceof OracleError ? err.message : String(err);
      log("warn", `market ${marketId} condition evaluation failed: ${reason}`);
      return;
    }

    const result = await settleMarket(state, marketId, outcome, {
      verifiedBody: body,
    });
    if (!result.ok) {
      log("warn", `market ${marketId} settlement failed: ${result.error}`);
      return;
    }
    log(
      "info",
      `market ${marketId} settled ${outcome} (mode=${result.mode}, settled_pairs=${result.settled_pairs.length})`,
    );
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    const due: string[] = [];
    const nowSecs = Math.floor(now() / 1000);
    for (const market of state.markets.values()) {
      if (market.status !== "open" && market.status !== "closed") continue;
      if (market.resolution_deadline > nowSecs) continue;
      due.push(market.id);
    }
    // Run concurrently — a slow truth source for one market shouldn't
    // block resolution of unrelated markets in the same tick.
    await Promise.allSettled(
      due.map(async (id) => {
        try {
          await resolveOne(id);
        } catch (err) {
          log(
            "error",
            `unexpected error resolving ${id}: ${
              err instanceof Error ? err.stack ?? err.message : String(err)
            }`,
          );
        }
      }),
    );
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(async () => {
      await tick();
      schedule();
    }, pollIntervalMs);
  }

  if (opts?.runImmediately ?? true) {
    Promise.resolve()
      .then(() => tick())
      .then(() => schedule())
      .catch((err) => log("error", `initial tick failed: ${err}`));
  } else {
    schedule();
  }

  return {
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
    tick,
  };
}
