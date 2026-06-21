import type {
  CashuProof,
  PublishResult,
  RelayClient,
} from "@anchr/sdk/adapters";
import { createBrowserCashuClient } from "@anchr/sdk/adapters/cashu-browser";
import { createCustomer } from "@anchr/sdk/customer";
import { ProofSchema } from "@anchr/sdk/schema";

interface ExampleConfig {
  relay_url: string;
  mint_url: string;
  oracle_pubkey: string;
  provider_pubkey: string;
  target_url: string;
  provider_amount_sats: number;
  funding_amount_sats: number;
}

interface ServerStatus {
  request_count: number;
  offer_count: number;
  oracle_verification_pass_count: number;
  oracle_verification_fail_count: number;
  provider_redeem_count: number;
  provider_pubkey_prefix: string;
  latest_error?: string;
}

const FETCH_TIMEOUT_MS = 10_000;
const FUNDING_FETCH_TIMEOUT_MS = 120_000;

interface FundingResponse {
  proofs: CashuProof[];
}

interface BrowserServerProviderResult {
  status: "pass";
  customer_runtime: "browser";
  provider_runtime: "deno-server";
  relay_runtime: "docker-nostr-rs-relay";
  mint_runtime: "docker-cashu-regtest";
  oracle_runtime: "sdk-nostr-oracle";
  proof_runtime: "tlsnotary";
  amount_sats: number;
  request_count: number;
  offer_count: number;
  oracle_verification_pass_count: number;
  provider_redeem_count: number;
  provider_pubkey_prefix: string;
  payment_lock_token_prefix: string;
  payment_lock_proof_count: number;
  proof_bytes: number;
  schema: string;
  data: BrowserServerProviderData;
}

interface BrowserServerProviderData {
  message: string;
  target: string;
  server: string;
  schema: string;
}

const RESULT_MESSAGE = "browser customer paid server provider";

async function runExample(): Promise<BrowserServerProviderResult> {
  const baseUrl = new URL("/", location.href);
  const config = await getJson<ExampleConfig>(new URL("config", baseUrl));
  const relayClient = createHttpRelayClient(baseUrl);
  const cashuClient = createBrowserCashuClient({ mintUrl: config.mint_url });
  const funding = await getJson<FundingResponse>(
    new URL(`funding-proofs?amount=${config.funding_amount_sats}`, baseUrl),
    { timeoutMs: FUNDING_FETCH_TIMEOUT_MS },
  );
  const settlementBaseline = await getJson<ServerStatus>(
    new URL("status", baseUrl),
  );
  const customer = createCustomer({
    oracles: [{ pubkey: config.oracle_pubkey }],
    relays: [config.relay_url],
    mint: config.mint_url,
    cashuClient,
    relayClient,
    offerWindowMs: 3_000,
    resultTimeoutMs: 120_000,
  });

  try {
    const result = await customer.request({
      spec: {
        schema: ProofSchema.TlsnV1,
        predicate: { target: config.target_url },
        description: "Verify the bitFlyer BTC/JPY ticker over TLSNotary",
      },
      payment: { maxAmount: config.provider_amount_sats },
      fundingProofs: funding.proofs,
      provider: config.provider_pubkey,
    });
    const status = await waitForServerSettlement(baseUrl, settlementBaseline);

    if (typeof result.proof !== "string") {
      throw new Error("expected base64 TLSNotary presentation proof");
    }
    if (!isBrowserServerProviderData(result.data, config.target_url)) {
      throw new Error("unexpected provider result data");
    }
    if (typeof result.paymentLockToken !== "string") {
      throw new Error("missing payment lock token");
    }
    if (!Array.isArray(result.paymentLockProofs)) {
      throw new Error("missing Payment Lock proofs");
    }

    return {
      status: "pass",
      customer_runtime: "browser",
      provider_runtime: "deno-server",
      relay_runtime: "docker-nostr-rs-relay",
      mint_runtime: "docker-cashu-regtest",
      oracle_runtime: "sdk-nostr-oracle",
      proof_runtime: "tlsnotary",
      amount_sats: config.provider_amount_sats,
      request_count: status.request_count,
      offer_count: status.offer_count,
      oracle_verification_pass_count: status.oracle_verification_pass_count,
      provider_redeem_count: status.provider_redeem_count,
      provider_pubkey_prefix: status.provider_pubkey_prefix,
      payment_lock_token_prefix: result.paymentLockToken.slice(0, 24),
      payment_lock_proof_count: result.paymentLockProofs.length,
      proof_bytes: decodedBase64ByteLength(result.proof),
      schema: result.schema,
      data: result.data,
    };
  } finally {
    await customer.close();
  }
}

function createHttpRelayClient(baseUrl: URL): RelayClient {
  return {
    publish(event) {
      return postJson<PublishResult>(new URL("relay/publish", baseUrl), event);
    },
    subscribe(filter, onEvent, onEose) {
      const url = new URL("relay/subscribe", baseUrl);
      url.searchParams.set("filter", JSON.stringify(filter));
      const source = new EventSource(url);
      source.addEventListener("eose", () => onEose?.());
      source.onmessage = (message) => {
        const event = JSON.parse(message.data);
        onEvent(event);
      };
      return {
        close() {
          source.close();
        },
      };
    },
    close() {
      // Each browser subscription owns its EventSource; there is no shared pool.
    },
  };
}

function decodedBase64ByteLength(value: string): number {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded).length;
}

async function waitForServerSettlement(
  baseUrl: URL,
  baseline: ServerStatus,
): Promise<ServerStatus> {
  const startedAt = Date.now();
  let latest: ServerStatus | null = null;
  while (Date.now() - startedAt <= 120_000) {
    latest = await getJson<ServerStatus>(new URL("status", baseUrl));
    if (
      latest.oracle_verification_pass_count >
        baseline.oracle_verification_pass_count &&
      latest.provider_redeem_count > baseline.provider_redeem_count
    ) {
      return latest;
    }
    if (
      latest.oracle_verification_fail_count >
        baseline.oracle_verification_fail_count
    ) {
      throw new Error(
        latest.latest_error ?? "Oracle rejected the TLSNotary presentation",
      );
    }
    await delay(250);
  }
  throw new Error(
    latest?.latest_error ??
      "server Provider did not redeem the real Cashu HTLC",
  );
}

function renderResult(result: BrowserServerProviderResult): void {
  const nodes = readDocumentNodes();
  document.documentElement.dataset.anchrStatus = result.status;
  nodes.status.dataset.status = result.status;
  nodes.status.textContent = result.status;
  nodes.amount.textContent = `${result.amount_sats} sats`;
  nodes.provider.textContent = result.provider_pubkey_prefix;
  nodes.customerRuntime.textContent = result.customer_runtime;
  nodes.providerRuntime.textContent = result.provider_runtime;
  nodes.oracle.textContent = result.oracle_runtime;
  nodes.redemption.textContent = String(result.provider_redeem_count);
  nodes.result.textContent = JSON.stringify(result, null, 2);
}

function renderError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  document.documentElement.dataset.anchrStatus = "fail";
  const status = document.querySelector<HTMLElement>("[data-status]");
  const result = document.querySelector<HTMLElement>("[data-result]");
  if (status !== null) {
    status.dataset.status = "fail";
    status.textContent = "fail";
  }
  if (result !== null) {
    result.textContent = message;
  }
}

try {
  runExample().then(renderResult, renderError);
} catch (error) {
  renderError(error);
}

function readDocumentNodes(): {
  status: HTMLElement;
  amount: HTMLElement;
  provider: HTMLElement;
  customerRuntime: HTMLElement;
  providerRuntime: HTMLElement;
  oracle: HTMLElement;
  redemption: HTMLElement;
  result: HTMLElement;
} {
  const status = document.querySelector<HTMLElement>("[data-status]");
  const amount = document.querySelector<HTMLElement>("[data-amount]");
  const provider = document.querySelector<HTMLElement>("[data-provider]");
  const customerRuntime = document.querySelector<HTMLElement>(
    "[data-customer-runtime]",
  );
  const providerRuntime = document.querySelector<HTMLElement>(
    "[data-provider-runtime]",
  );
  const oracle = document.querySelector<HTMLElement>("[data-oracle]");
  const redemption = document.querySelector<HTMLElement>("[data-redemption]");
  const result = document.querySelector<HTMLElement>("[data-result]");

  if (
    status === null ||
    amount === null ||
    provider === null ||
    customerRuntime === null ||
    providerRuntime === null ||
    oracle === null ||
    redemption === null ||
    result === null
  ) {
    throw new Error("browser example document is missing required nodes");
  }

  return {
    status,
    amount,
    provider,
    customerRuntime,
    providerRuntime,
    oracle,
    redemption,
    result,
  };
}

async function getJson<T>(
  url: URL,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const response = await fetchWithTimeout(url, {}, options.timeoutMs);
  if (!response.ok) {
    throw new Error(`${url.pathname} failed with HTTP ${response.status}`);
  }
  return await response.json() as T;
}

async function postJson<T>(
  url: URL,
  body: unknown,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, options.timeoutMs);
  if (!response.ok) {
    throw new Error(`${url.pathname} failed with HTTP ${response.status}`);
  }
  return await response.json() as T;
}

async function fetchWithTimeout(
  url: URL,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isBrowserServerProviderData(
  value: unknown,
  targetUrl: string,
): value is BrowserServerProviderData {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.message === RESULT_MESSAGE &&
    record.target === targetUrl &&
    record.server === "api.bitflyer.com" &&
    record.schema === ProofSchema.TlsnV1;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
