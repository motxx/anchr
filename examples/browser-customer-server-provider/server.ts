import { parseQueryRequestEvent } from "@anchr/protocol/events";
import {
  type Event as NostrEvent,
  findTagValue,
  generateKeypair,
  KIND_QUERY_FEEDBACK,
  KIND_QUERY_REQUEST,
} from "@anchr/protocol/nostr";
import type {
  ActorStateStore,
  Filter,
  PublishResult,
  RelayClient,
  Subscription,
} from "@anchr/sdk/adapters";
import { createCashuClient } from "@anchr/sdk/adapters/cashu";
import {
  createOracleNostrService,
  createRelayClient,
  generateEphemeralIdentity,
  type NostrIdentity,
} from "@anchr/sdk/adapters/nostr";
import { createProvider } from "@anchr/sdk/provider";
import { isTlsnVerifierAvailable } from "@anchr/sdk/proofs";
import { ProofSchema, type SchemaUri } from "@anchr/sdk/schema";
import { type Proof, Wallet } from "@cashu/cashu-ts";
import { fromFileUrl } from "jsr:@std/path@^1";

interface ExampleServerOptions {
  hostname?: string;
  port?: number;
  bundle?: boolean;
}

export interface StartedExampleServer {
  url: string;
  providerPubkey: string;
  oraclePubkey: string;
  shutdown(): Promise<void>;
}

interface RuntimeStatus {
  requestCount: number;
  offerCount: number;
  oracleVerificationPassCount: number;
  oracleVerificationFailCount: number;
  providerRedeemCount: number;
  latestError?: string;
}

interface RequestContext {
  bridgeRelayClient: RelayClient;
  directMintUrl: string;
  mintProxyUrl: string;
  oraclePubkey: string;
  providerPubkey: string;
  providerStatus: RuntimeStatus;
  faucet: FundingFaucet;
}

const EXAMPLE_DIR = new URL("./", import.meta.url);
const ROOT = new URL("../../", import.meta.url);
const PROVER_BIN = new URL(
  "crates/tlsn-prover/target/debug/tlsn-prove",
  ROOT,
);
const TARGET_URL = "https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY";
const TARGET_SERVER = "api.bitflyer.com";
const RESULT_MESSAGE = "browser customer paid server provider";
const PROVIDER_AMOUNT_SATS = 16;
const CUSTOMER_FUNDING_SATS = 64;
const PROVER_ATTEMPTS = 3;
const PROVER_TIMEOUT_MS = 120_000;

export async function startBrowserCustomerServerProviderExample(
  options: ExampleServerOptions = {},
): Promise<StartedExampleServer> {
  if (options.bundle ?? false) {
    await bundleBrowserEntry();
  }

  const relayUrl = firstEnvUrl("NOSTR_RELAYS", "ws://127.0.0.1:7777");
  const directMintUrl = envUrl("CASHU_MINT_URL", "http://127.0.0.1:3338");
  const tlsnVerifierHost = Deno.env.get("TLSN_VERIFIER_HOST") ??
    "127.0.0.1:7046";

  await assertRealStackReady({
    relayUrl,
    directMintUrl,
    tlsnVerifierHost,
  });

  const hostname = options.hostname ?? "127.0.0.1";
  const runtimeStatus: RuntimeStatus = {
    requestCount: 0,
    offerCount: 0,
    oracleVerificationPassCount: 0,
    oracleVerificationFailCount: 0,
    providerRedeemCount: 0,
  };
  const providerState = new ObservableStateStore();

  const oracleIdentity = generateEphemeralIdentity();
  const providerKey = generateKeypair();
  const oracleRelayClient = createRelayClient([relayUrl]);
  const providerRelayClient = createRelayClient([relayUrl]);
  const bridgeRelayClient = createRelayClient([relayUrl]);

  let ctx: RequestContext | null = null;
  const server = Deno.serve({
    hostname,
    port: options.port ?? 0,
    onListen: () => {},
  }, (request) => {
    if (ctx === null) {
      return new Response("server not initialized", { status: 503 });
    }
    return handleRequest(request, ctx);
  });

  const url = `http://${hostname}:${server.addr.port}/`;
  const mintProxyUrl = new URL("mint", url).href.replace(/\/$/, "");
  const faucet = new FundingFaucet(directMintUrl);
  const providerCashu = wrapProviderCashu(
    createCashuClient({ mintUrl: mintProxyUrl }),
    runtimeStatus,
  );

  const oracleService = createOracleNostrService({
    identity: oracleIdentity,
    relayClient: oracleRelayClient,
    onOffer: () => {
      runtimeStatus.offerCount += 1;
    },
    onVerification: (_requestId, passed) => {
      if (passed) {
        runtimeStatus.oracleVerificationPassCount += 1;
      } else {
        runtimeStatus.oracleVerificationFailCount += 1;
      }
    },
  });
  const oracleSubscriptions = watchRelayRequestsForOracle(
    oracleRelayClient,
    oracleService,
    oracleIdentity,
    runtimeStatus,
  );

  const provider = createProvider({
    oracles: [oracleIdentity.publicKey],
    relays: [relayUrl],
    mint: mintProxyUrl,
    privKey: bytesToHex(providerKey.secretKey),
    cashuClient: providerCashu,
    relayClient: providerRelayClient,
    stateStore: providerState,
    selectionTimeoutMs: 30_000,
    hashTimeoutMs: 30_000,
    preimageTimeoutMs: 120_000,
  });
  const servePromise = provider.serve((request) => {
    if (request.spec.schema !== ProofSchema.TlsnV1) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      amountSats: PROVIDER_AMOUNT_SATS,
      produce: async () => {
        const presentation = await generatePresentation(
          TARGET_URL,
          tlsnVerifierHost,
        );
        return {
          data: {
            message: RESULT_MESSAGE,
            target: TARGET_URL,
            server: TARGET_SERVER,
            schema: ProofSchema.TlsnV1,
          },
          proof: presentation,
        };
      },
    });
  });

  ctx = {
    bridgeRelayClient,
    directMintUrl,
    mintProxyUrl,
    oraclePubkey: oracleIdentity.publicKey,
    providerPubkey: provider.pubkey,
    providerStatus: runtimeStatus,
    faucet,
  };

  return {
    url,
    providerPubkey: provider.pubkey,
    oraclePubkey: oracleIdentity.publicKey,
    async shutdown() {
      await server.shutdown();
      await provider.stop();
      await servePromise;
      oracleService.stop();
      for (const subscription of oracleSubscriptions) subscription.close();
      oracleRelayClient.close();
      providerRelayClient.close();
      bridgeRelayClient.close();
    },
  };
}

function watchRelayRequestsForOracle(
  relayClient: RelayClient,
  oracleService: ReturnType<typeof createOracleNostrService>,
  oracleIdentity: NostrIdentity,
  status: RuntimeStatus,
): Subscription[] {
  const requestByEvent = new Map<
    string,
    { queryId: string; customerPubkey: string }
  >();

  const requestSub = relayClient.subscribe(
    { kinds: [KIND_QUERY_REQUEST] },
    (event) => {
      const payload = parseQueryRequestEvent(event);
      if (payload === null) return;
      if (payload.oracle_pubkey !== oracleIdentity.publicKey) return;
      if (payload.schema !== ProofSchema.TlsnV1) return;

      status.requestCount += 1;
      requestByEvent.set(event.id, {
        queryId: payload.query_id,
        customerPubkey: payload.customer_pubkey,
      });
      oracleService.watchRequest(
        {
          id: payload.query_id,
          schema: payload.schema as SchemaUri,
          status: "awaiting_offers" as const,
          description: "Verify the bitFlyer BTC/JPY ticker over TLSNotary",
          verification_requirements: ["tlsn"] as const,
          created_at: Date.now(),
          expires_at: payload.expires_at,
          payment_status: "none" as const,
          payment_lock: { amount_sats: PROVIDER_AMOUNT_SATS },
          nostr_event_id: event.id,
          visibility: "customer_only" as const,
          schema_requirement: {
            target_url: TARGET_URL,
            max_attestation_age_seconds: 300,
            conditions: [{
              type: "jsonpath",
              expression: "product_code",
              expected: "BTC_JPY",
              description: "BTC_JPY product code is revealed",
            }],
          },
        },
        event.id,
        payload.customer_pubkey,
      );
    },
  );

  const selectionSub = relayClient.subscribe(
    { kinds: [KIND_QUERY_FEEDBACK] },
    (event) => {
      if (findTagValue(event, "status") !== "processing") return;
      const requestEventId = findTagValue(event, "e");
      const selectedProvider = findTagValue(event, "p");
      if (requestEventId === null || selectedProvider === null) {
        return;
      }
      const request = requestByEvent.get(requestEventId);
      if (request === undefined || request.customerPubkey !== event.pubkey) {
        return;
      }
      oracleService.recordSelectedProvider(
        request.queryId,
        selectedProvider,
      );
    },
  );

  return [requestSub, selectionSub];
}

async function handleRequest(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  try {
    return await handleRequestUnsafe(request, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.providerStatus.latestError = message;
    return jsonResponse({ error: message }, 500);
  }
}

async function handleRequestUnsafe(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/mint" || url.pathname.startsWith("/mint/")) {
    return proxyMintRequest(request, url, ctx.directMintUrl);
  }
  if (request.method === "GET" && url.pathname === "/config") {
    return jsonResponse({
      relay_url: "browser-relay-bridge",
      mint_url: ctx.mintProxyUrl,
      oracle_pubkey: ctx.oraclePubkey,
      provider_pubkey: ctx.providerPubkey,
      target_url: TARGET_URL,
      provider_amount_sats: PROVIDER_AMOUNT_SATS,
      funding_amount_sats: CUSTOMER_FUNDING_SATS,
    });
  }
  if (request.method === "GET" && url.pathname === "/status") {
    return jsonResponse({
      request_count: ctx.providerStatus.requestCount,
      offer_count: ctx.providerStatus.offerCount,
      oracle_verification_pass_count:
        ctx.providerStatus.oracleVerificationPassCount,
      oracle_verification_fail_count:
        ctx.providerStatus.oracleVerificationFailCount,
      provider_redeem_count: ctx.providerStatus.providerRedeemCount,
      provider_pubkey_prefix: ctx.providerPubkey.slice(0, 12),
      latest_error: ctx.providerStatus.latestError,
    });
  }
  if (request.method === "GET" && url.pathname === "/funding-proofs") {
    const amount = Number(url.searchParams.get("amount"));
    if (!Number.isInteger(amount) || amount <= 0 || amount > 10_000) {
      return jsonResponse(
        { error: "amount must be an integer up to 10000" },
        400,
      );
    }
    const proofs = await ctx.faucet.mintProofs(amount);
    return jsonResponse({ proofs });
  }
  if (request.method === "POST" && url.pathname === "/relay/publish") {
    const event = await parseRelayPublishEvent(request);
    if (event instanceof Response) return event;
    return jsonResponse(await ctx.bridgeRelayClient.publish(event));
  }
  if (request.method === "GET" && url.pathname === "/relay/subscribe") {
    return serveRelaySubscription(request, ctx.bridgeRelayClient);
  }

  const staticResponse = await serveStatic(url.pathname);
  return staticResponse ?? new Response("not found", { status: 404 });
}

function serveRelaySubscription(
  request: Request,
  relayClient: RelayClient,
): Response {
  const url = new URL(request.url);
  const filterText = url.searchParams.get("filter");
  const parsedFilter = parseRelayFilter(filterText);
  if (parsedFilter instanceof Response) return parsedFilter;
  const filter = parsedFilter;
  const encoder = new TextEncoder();
  let subscription: Subscription | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      subscription = relayClient.subscribe(filter, (event) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      }, () => {
        controller.enqueue(encoder.encode("event: eose\ndata: {}\n\n"));
      });
      controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));
    },
    cancel() {
      subscription?.close();
      subscription = null;
    },
  });
  request.signal.addEventListener("abort", () => subscription?.close(), {
    once: true,
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/event-stream",
    },
  });
}

function parseRelayFilter(filterText: string | null): Filter | Response {
  if (filterText === null) {
    return jsonResponse({ error: "filter query parameter is required" }, 400);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(filterText);
  } catch {
    return jsonResponse({ error: "filter must be valid JSON" }, 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return jsonResponse({ error: "filter must be a JSON object" }, 400);
  }
  if (!isRelayFilter(parsed)) {
    return jsonResponse({ error: "filter has unsupported fields" }, 400);
  }
  return parsed;
}

async function parseRelayPublishEvent(
  request: Request,
): Promise<NostrEvent | Response> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonResponse({ error: "event must be valid JSON" }, 400);
  }
  if (!isNostrEvent(parsed)) {
    return jsonResponse({ error: "event must be a Nostr event object" }, 400);
  }
  return parsed;
}

function isRelayFilter(value: unknown): value is Filter {
  if (!isPlainRecord(value)) return false;
  for (const [key, filterValue] of Object.entries(value)) {
    if (key.startsWith("#")) {
      if (!isStringArray(filterValue)) return false;
      continue;
    }
    if (
      key !== "kinds" &&
      key !== "authors" &&
      key !== "ids" &&
      key !== "since" &&
      key !== "until" &&
      key !== "limit"
    ) {
      return false;
    }
  }
  return isOptionalNumberArray(value.kinds) &&
    isOptionalStringArray(value.authors) &&
    isOptionalStringArray(value.ids) &&
    isOptionalNumber(value.since) &&
    isOptionalNumber(value.until) &&
    isOptionalNumber(value.limit);
}

function isNostrEvent(value: unknown): value is NostrEvent {
  return isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.pubkey === "string" &&
    typeof value.created_at === "number" &&
    typeof value.kind === "number" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) =>
      Array.isArray(tag) && tag.every((item) => typeof item === "string")
    ) &&
    typeof value.content === "string" &&
    typeof value.sig === "string";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined || isStringArray(value);
}

function isOptionalNumberArray(value: unknown): boolean {
  return value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === "number"));
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string");
}

async function proxyMintRequest(
  request: Request,
  url: URL,
  directMintUrl: string,
): Promise<Response> {
  const target = new URL(directMintUrl);
  const suffix = url.pathname === "/mint" ? "/" : url.pathname.slice(5);
  target.pathname = joinUrlPath(target.pathname, suffix);
  target.search = url.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const response = await fetch(target, init);
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

async function serveStatic(pathname: string): Promise<Response | null> {
  const route = pathname === "/" ? "/index.html" : pathname;
  const file = routeToFile(route);
  if (file === null) return null;
  try {
    return new Response(await Deno.readFile(file.url), {
      headers: { "content-type": file.contentType },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

function routeToFile(
  route: string,
): { url: URL; contentType: string } | null {
  if (route === "/index.html") {
    return {
      url: new URL("index.html", EXAMPLE_DIR),
      contentType: "text/html",
    };
  }
  if (route === "/styles.css") {
    return { url: new URL("styles.css", EXAMPLE_DIR), contentType: "text/css" };
  }
  if (route === "/dist/app.js") {
    return {
      url: new URL("dist/app.js", EXAMPLE_DIR),
      contentType: "text/javascript",
    };
  }
  return null;
}

class FundingFaucet {
  #walletPromise: Promise<Wallet> | null = null;
  #lastMintOpTime = 0;

  constructor(readonly mintUrl: string) {}

  async mintProofs(amountSats: number): Promise<Proof[]> {
    await this.#throttle();
    return await this.#retryOnRateLimit(async () => {
      const wallet = await this.#wallet();
      const quote = await wallet.createMintQuote(amountSats);
      await payInvoiceViaLndUser(quote.request);
      await delay(2_000);
      return await wallet.mintProofs(amountSats, quote.quote);
    });
  }

  async #wallet(): Promise<Wallet> {
    this.#walletPromise ??= (async () => {
      const wallet = new Wallet(this.mintUrl, { unit: "sat" });
      await wallet.loadMint();
      return wallet;
    })();
    return await this.#walletPromise;
  }

  async #throttle(): Promise<void> {
    const elapsed = Date.now() - this.#lastMintOpTime;
    if (elapsed < 500) await delay(500 - elapsed);
    this.#lastMintOpTime = Date.now();
  }

  async #retryOnRateLimit<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("Rate limit") || attempt === 3) break;
        await delay(2_000 * 2 ** attempt);
      }
    }
    throw lastError;
  }
}

class ObservableStateStore implements ActorStateStore {
  #records = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.#records.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.#records.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.#records.delete(key);
    return Promise.resolve();
  }
}

function wrapProviderCashu(
  cashuClient: ReturnType<typeof createCashuClient>,
  status: RuntimeStatus,
): ReturnType<typeof createCashuClient> {
  return {
    ...cashuClient,
    async verifyProviderPaymentLock(params) {
      try {
        return await cashuClient.verifyProviderPaymentLock(params);
      } catch (error) {
        status.latestError = error instanceof Error
          ? `provider Payment Lock verification failed: ${error.message}`
          : String(error);
        throw error;
      }
    },
    async redeemHtlc(params) {
      try {
        const result = await cashuClient.redeemHtlc(params);
        status.providerRedeemCount += 1;
        return result;
      } catch (error) {
        status.latestError = error instanceof Error
          ? `provider HTLC redemption failed: ${error.message}`
          : String(error);
        throw error;
      }
    },
  };
}

async function generatePresentation(
  targetUrl: string,
  verifierHost: string,
): Promise<string> {
  let lastError: Error | undefined;
  const presentationPath = await Deno.makeTempFile({
    prefix: "anchr-browser-example-",
    suffix: ".presentation.tlsn",
  });

  try {
    for (let attempt = 1; attempt <= PROVER_ATTEMPTS; attempt++) {
      try {
        return await runProverOnce(targetUrl, verifierHost, presentationPath);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await removeFileIfExists(presentationPath);
        if (
          attempt === PROVER_ATTEMPTS ||
          !isRetryableProverFailure(lastError.message)
        ) {
          throw lastError;
        }
        await delay(500 * attempt);
      }
    }

    throw lastError ?? new Error("TLSN prover failed without an error");
  } finally {
    await removeFileIfExists(presentationPath);
  }
}

async function runProverOnce(
  targetUrl: string,
  verifierHost: string,
  presentationPath: string,
): Promise<string> {
  const command = new Deno.Command(fromFileUrl(PROVER_BIN), {
    args: [
      "--verifier",
      verifierHost,
      targetUrl,
      "-o",
      presentationPath,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may have exited between the timeout firing and kill.
    }
  }, PROVER_TIMEOUT_MS);
  let output: Deno.CommandOutput;
  try {
    output = await child.output();
  } finally {
    clearTimeout(timeout);
  }
  if (timedOut) {
    throw new Error(`TLSN prover timed out after ${PROVER_TIMEOUT_MS}ms`);
  }
  if (output.code !== 0) {
    throw new Error(`TLSN prover failed: ${decode(output.stderr)}`);
  }
  return decode(output.stdout).trim();
}

async function removeFileIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

async function assertRealStackReady(config: {
  relayUrl: string;
  directMintUrl: string;
  tlsnVerifierHost: string;
}): Promise<void> {
  const failures: string[] = [];

  if (!await isTcpReachable(config.relayUrl)) {
    failures.push(`Nostr relay is not reachable at ${config.relayUrl}`);
  }
  if (!await isCashuMintReachable(config.directMintUrl)) {
    failures.push(`Cashu mint is not reachable at ${config.directMintUrl}`);
  }
  if (!await isLndUserReachable()) {
    failures.push("lnd-user is not reachable via docker compose");
  }
  if (!await isTcpHostReachable(config.tlsnVerifierHost)) {
    failures.push(
      `TLSN verifier server is not reachable at ${config.tlsnVerifierHost}`,
    );
  }
  if (!await isFile(fromFileUrl(PROVER_BIN))) {
    failures.push(
      `TLSN prover binary is missing at ${fromFileUrl(PROVER_BIN)}`,
    );
  }
  if (!isTlsnVerifierAvailable()) {
    failures.push("TLSN verifier binary is missing from crates/tlsn-verifier");
  }

  if (failures.length > 0) {
    throw new Error(
      [
        "Real browser example stack is not ready:",
        ...failures.map((failure) => `- ${failure}`),
        "",
        "Run:",
        "  deno task -c examples/browser-customer-server-provider/deno.json stack:up",
        "  deno task -c examples/browser-customer-server-provider/deno.json stack:init",
        "  cargo build --manifest-path crates/tlsn-prover/Cargo.toml",
        "  cargo build --release --manifest-path crates/tlsn-verifier/Cargo.toml",
      ].join("\n"),
    );
  }
}

async function isCashuMintReachable(mintUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${mintUrl}/v1/info`, {
      signal: AbortSignal.timeout(3_000),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

async function isLndUserReachable(): Promise<boolean> {
  const output = await new Deno.Command("docker", {
    args: [
      "compose",
      "exec",
      "-T",
      "lnd-user",
      "lncli",
      "--network",
      "regtest",
      "--rpcserver",
      "lnd-user:10009",
      "getinfo",
    ],
    cwd: fromFileUrl(ROOT),
    stdout: "null",
    stderr: "null",
  }).output();
  return output.code === 0;
}

async function payInvoiceViaLndUser(bolt11: string): Promise<void> {
  const output = await new Deno.Command("docker", {
    args: [
      "compose",
      "exec",
      "-T",
      "lnd-user",
      "lncli",
      "--network",
      "regtest",
      "--rpcserver",
      "lnd-user:10009",
      "payinvoice",
      "--force",
      bolt11,
    ],
    cwd: fromFileUrl(ROOT),
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (output.code !== 0) {
    throw new Error(`lnd-user failed to pay invoice: ${decode(output.stderr)}`);
  }
}

async function isTcpReachable(urlText: string): Promise<boolean> {
  try {
    const url = new URL(urlText);
    const port = url.port
      ? Number(url.port)
      : (url.protocol === "wss:" || url.protocol === "https:" ? 443 : 80);
    return await isTcpPortReachable(url.hostname, port);
  } catch {
    return false;
  }
}

async function isTcpHostReachable(hostPort: string): Promise<boolean> {
  const [host, portText] = hostPort.split(":");
  const port = Number(portText);
  if (host === undefined || !Number.isInteger(port)) return false;
  return await isTcpPortReachable(host, port);
}

async function isTcpPortReachable(
  hostname: string,
  port: number,
): Promise<boolean> {
  try {
    const conn = await Deno.connect({ hostname, port });
    conn.close();
    return true;
  } catch {
    return false;
  }
}

async function bundleBrowserEntry(): Promise<void> {
  await Deno.mkdir(new URL("dist/", EXAMPLE_DIR), { recursive: true });
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "bundle",
      "--platform",
      "browser",
      "--config",
      fromFileUrl(new URL("deno.json", ROOT)),
      fromFileUrl(new URL("app.ts", EXAMPLE_DIR)),
      "-o",
      fromFileUrl(new URL("dist/app.js", EXAMPLE_DIR)),
    ],
    cwd: fromFileUrl(ROOT),
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  if (output.code !== 0) {
    throw new Error(
      `browser bundle failed\n${decode(output.stdout)}${decode(output.stderr)}`,
    );
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function envUrl(name: string, fallback: string): string {
  return Deno.env.get(name)?.trim() || fallback;
}

function firstEnvUrl(name: string, fallback: string): string {
  return envUrl(name, fallback).split(",")[0]!.trim();
}

function joinUrlPath(basePath: string, suffix: string): string {
  const left = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const right = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${left}${right}`;
}

function isRetryableProverFailure(stderr: string): boolean {
  return [
    "failed to lookup address information",
    "temporary failure in name resolution",
    "could not resolve",
    "network is unreachable",
    "connection reset",
    "connection refused",
    "timed out",
  ].some((marker) => stderr.toLowerCase().includes(marker));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

if (import.meta.main) {
  const port = Number(Deno.env.get("PORT") ?? "48232");
  const server = await startBrowserCustomerServerProviderExample({
    port,
    bundle: true,
  });
  console.log(`browser customer/server provider example: ${server.url}`);
  await new Promise(() => {});
}
