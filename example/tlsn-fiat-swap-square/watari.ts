import type { CashuProof, Spec } from "anchr-sdk";

export const WATARI_SCHEMA = "io.anchr.tlsn-https.v1";
export const WATARI_QUERY_TAG = "Watari Testnet Square payment";
export const SQUARE_SANDBOX_HOST = "connect.squareupsandbox.com";

const DEFAULT_RELAYS = "ws://localhost:7777";
const DEFAULT_MINT_URL = "http://localhost:3338";

export interface SharedWatariConfig {
  relays: string[];
  mintUrl: string;
  oraclePubkey: string;
  paymentLink?: string;
  paymentId?: string;
  amountSats: number;
  fiatAmountMinor: number;
  fiatCurrency: string;
  squareLocationId?: string;
  maxAttestationAgeSeconds: number;
  locktimeSeconds: number;
}

export interface SellerConfig extends SharedWatariConfig {
  oracleEndpoint: string;
  oracleApiKey?: string;
  sourceProofs: CashuProof[];
  providerPubkey?: string;
  quoteWindowMs: number;
  resultTimeoutMs: number;
}

export interface BuyerConfig extends SharedWatariConfig {
  providerPrivKey: string;
  proofFile?: string;
  proofBase64?: string;
  selectionTimeoutMs: number;
  preimageTimeoutMs: number;
  notaryUrl?: string;
}

export interface WatariJsonPathCondition {
  type: "jsonpath";
  expression: string;
  expected: string;
  description: string;
}

export interface WatariPredicate {
  target_url: string;
  domain_hint: typeof SQUARE_SANDBOX_HOST;
  conditions: WatariJsonPathCondition[];
  max_attestation_age_seconds: number;
  watari: {
    tag: typeof WATARI_QUERY_TAG;
    amount_sats: number;
    fiat_amount_minor: number;
    fiat_currency: string;
    payment_link?: string;
    payment_id?: string;
    square_location_id?: string;
  };
}

export interface WatariResultData {
  schema: typeof WATARI_SCHEMA;
  target_url: string;
  domain: typeof SQUARE_SANDBOX_HOST;
  payment_id: string;
  expected: {
    status: "COMPLETED";
    amount_money: { amount: number; currency: string };
    location_id?: string;
  };
}

export class WatariConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatariConfigError";
  }
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new WatariConfigError(`${name} is required`);
  return value;
}

function optional(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function positiveInt(env: Env, name: string, defaultValue: number): number {
  const raw = optional(env, name);
  if (!raw) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new WatariConfigError(`${name} must be a positive integer`);
  }
  return value;
}

function list(env: Env, name: string, defaultValue?: string): string[] {
  const raw = optional(env, name) ?? defaultValue;
  if (!raw) throw new WatariConfigError(`${name} is required`);
  const values = raw.split(",").map((v) => v.trim()).filter(Boolean);
  if (values.length === 0) throw new WatariConfigError(`${name} is empty`);
  return values;
}

function assertHttpUrl(value: string, name: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("bad protocol");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new WatariConfigError(`${name} must be an http(s) URL`);
  }
}

function assertRelayUrl(value: string, name: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      throw new Error("bad protocol");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new WatariConfigError(`${name} entries must be ws(s) URLs`);
  }
}

function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new WatariConfigError(
      "WATARI_FIAT_CURRENCY must be a 3-letter ISO currency code",
    );
  }
  return currency;
}

function parseSourceProofs(env: Env): CashuProof[] {
  const raw = required(env, "WATARI_SOURCE_PROOFS_JSON");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WatariConfigError(
      "WATARI_SOURCE_PROOFS_JSON must be a JSON array of Cashu proofs",
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new WatariConfigError(
      "WATARI_SOURCE_PROOFS_JSON must contain at least one Cashu proof",
    );
  }
  return parsed;
}

function sharedConfig(env: Env): SharedWatariConfig {
  const relays = list(env, "NOSTR_RELAYS", DEFAULT_RELAYS).map((relay) =>
    assertRelayUrl(relay, "NOSTR_RELAYS")
  );
  return {
    relays,
    mintUrl: assertHttpUrl(
      optional(env, "CASHU_MINT_URL") ?? DEFAULT_MINT_URL,
      "CASHU_MINT_URL",
    ),
    oraclePubkey: required(env, "WATARI_ORACLE_PUBKEY"),
    paymentLink: optional(env, "SQUARE_PAYMENT_LINK"),
    paymentId: optional(env, "WATARI_PAYMENT_ID"),
    amountSats: positiveInt(env, "WATARI_AMOUNT_SATS", 1_000),
    fiatAmountMinor: positiveInt(env, "WATARI_FIAT_AMOUNT_MINOR", 100),
    fiatCurrency: normalizeCurrency(env.WATARI_FIAT_CURRENCY ?? "JPY"),
    squareLocationId: optional(env, "WATARI_SQUARE_LOCATION_ID"),
    maxAttestationAgeSeconds: positiveInt(
      env,
      "WATARI_MAX_ATTESTATION_AGE_SECONDS",
      600,
    ),
    locktimeSeconds: positiveInt(env, "WATARI_LOCKTIME_SECONDS", 3_600),
  };
}

export function loadSellerConfig(env: Env = Deno.env.toObject()): SellerConfig {
  const shared = sharedConfig(env);
  if (!shared.paymentLink) {
    throw new WatariConfigError("SQUARE_PAYMENT_LINK is required");
  }
  return {
    ...shared,
    oracleEndpoint: assertHttpUrl(
      required(env, "WATARI_ORACLE_ENDPOINT"),
      "WATARI_ORACLE_ENDPOINT",
    ),
    oracleApiKey: optional(env, "WATARI_ORACLE_API_KEY"),
    sourceProofs: parseSourceProofs(env),
    providerPubkey: optional(env, "WATARI_PROVIDER_PUBKEY"),
    quoteWindowMs: positiveInt(env, "WATARI_QUOTE_WINDOW_MS", 30_000),
    resultTimeoutMs: positiveInt(env, "WATARI_RESULT_TIMEOUT_MS", 5 * 60_000),
  };
}

export function loadBuyerConfig(env: Env = Deno.env.toObject()): BuyerConfig {
  const shared = sharedConfig(env);
  return {
    ...shared,
    providerPrivKey: required(env, "WATARI_PROVIDER_PRIVKEY"),
    proofFile: optional(env, "WATARI_PROOF_FILE"),
    proofBase64: optional(env, "WATARI_PROOF_BASE64"),
    selectionTimeoutMs: positiveInt(
      env,
      "WATARI_SELECTION_TIMEOUT_MS",
      60_000,
    ),
    preimageTimeoutMs: positiveInt(
      env,
      "WATARI_PREIMAGE_TIMEOUT_MS",
      5 * 60_000,
    ),
    notaryUrl: optional(env, "WATARI_NOTARY_URL"),
  };
}

export function squarePaymentUrl(paymentId: string): string {
  return `https://${SQUARE_SANDBOX_HOST}/v2/payments/${paymentId}`;
}

export function buildWatariPredicate(
  input: SharedWatariConfig,
): WatariPredicate {
  const conditions: WatariJsonPathCondition[] = [
    {
      type: "jsonpath",
      expression: "payment.status",
      expected: "COMPLETED",
      description: "Square payment status is COMPLETED",
    },
    {
      type: "jsonpath",
      expression: "payment.amount_money.amount",
      expected: String(input.fiatAmountMinor),
      description: "Square amount matches the Watari quote",
    },
    {
      type: "jsonpath",
      expression: "payment.amount_money.currency",
      expected: input.fiatCurrency,
      description: "Square currency matches the Watari quote",
    },
  ];

  if (input.squareLocationId) {
    conditions.push({
      type: "jsonpath",
      expression: "payment.location_id",
      expected: input.squareLocationId,
      description: "Square location matches the seller",
    });
  }

  return {
    target_url: input.paymentId
      ? squarePaymentUrl(input.paymentId)
      : `https://${SQUARE_SANDBOX_HOST}/v2/payments/{payment_id}`,
    domain_hint: SQUARE_SANDBOX_HOST,
    conditions,
    max_attestation_age_seconds: input.maxAttestationAgeSeconds,
    watari: {
      tag: WATARI_QUERY_TAG,
      amount_sats: input.amountSats,
      fiat_amount_minor: input.fiatAmountMinor,
      fiat_currency: input.fiatCurrency,
      ...(input.paymentLink ? { payment_link: input.paymentLink } : {}),
      ...(input.paymentId ? { payment_id: input.paymentId } : {}),
      ...(input.squareLocationId
        ? { square_location_id: input.squareLocationId }
        : {}),
    },
  };
}

export function buildWatariSpec(input: SharedWatariConfig): Spec {
  const predicate = buildWatariPredicate(input);
  const fiatMajor = (input.fiatAmountMinor / 100).toFixed(2);
  return {
    schema: WATARI_SCHEMA,
    predicate,
    description:
      `${WATARI_QUERY_TAG}: ${input.fiatCurrency} ${fiatMajor} for ${input.amountSats} sats.`,
    context: {
      payment_link: input.paymentLink,
      relays: input.relays,
      mint_url: input.mintUrl,
    },
  };
}

export function isWatariPredicate(value: unknown): value is WatariPredicate {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Partial<WatariPredicate>;
  if (p.domain_hint !== SQUARE_SANDBOX_HOST) return false;
  if (typeof p.target_url !== "string") return false;
  try {
    const target = new URL(p.target_url);
    if (
      target.protocol !== "https:" ||
      target.hostname !== SQUARE_SANDBOX_HOST ||
      !target.pathname.startsWith("/v2/payments/")
    ) {
      return false;
    }
  } catch {
    return false;
  }
  if (!Array.isArray(p.conditions)) return false;
  if (typeof p.max_attestation_age_seconds !== "number") return false;
  if (typeof p.watari !== "object" || p.watari === null) return false;
  return p.watari.tag === WATARI_QUERY_TAG &&
    typeof p.watari.amount_sats === "number" &&
    typeof p.watari.fiat_amount_minor === "number" &&
    typeof p.watari.fiat_currency === "string";
}

export function predicateMatchesBuyerConfig(
  predicate: WatariPredicate,
  config: BuyerConfig,
): boolean {
  return predicate.watari.amount_sats === config.amountSats &&
    predicate.watari.fiat_amount_minor === config.fiatAmountMinor &&
    predicate.watari.fiat_currency === config.fiatCurrency &&
    (config.squareLocationId === undefined ||
      predicate.watari.square_location_id === config.squareLocationId);
}

export function buildWatariResultData(config: BuyerConfig): WatariResultData {
  if (!config.paymentId) {
    throw new WatariConfigError(
      "WATARI_PAYMENT_ID is required to produce proof data",
    );
  }
  return {
    schema: WATARI_SCHEMA,
    target_url: squarePaymentUrl(config.paymentId),
    domain: SQUARE_SANDBOX_HOST,
    payment_id: config.paymentId,
    expected: {
      status: "COMPLETED",
      amount_money: {
        amount: config.fiatAmountMinor,
        currency: config.fiatCurrency,
      },
      ...(config.squareLocationId
        ? { location_id: config.squareLocationId }
        : {}),
    },
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function readProofBase64(
  config: BuyerConfig,
): Promise<string | undefined> {
  if (config.proofBase64) return config.proofBase64;
  if (!config.proofFile) return undefined;
  return bytesToBase64(await Deno.readFile(config.proofFile));
}

export function tlsnProofCommand(paymentId: string): string[] {
  const targetUrl = squarePaymentUrl(paymentId);
  return [
    "./crates/tlsn-prover/target/release/tlsn-prove \\",
    "  --verifier localhost:7046 \\",
    "  --max-recv-data 4096 \\",
    "  --max-sent-data 4096 \\",
    '  -H "Authorization: Bearer $SQUARE_ACCESS_TOKEN" \\',
    `  "${targetUrl}" \\`,
    "  -o proof.presentation.tlsn",
  ];
}
