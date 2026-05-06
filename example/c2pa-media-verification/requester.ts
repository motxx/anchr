/**
 * C2PA Media Verification - Requester / Customer
 *
 * A news desk requests a verified photo from a location. The request is a
 * NIP-90 job announced on Nostr; no Anchr-operated host is involved.
 *
 * Usage:
 *   NOSTR_RELAYS=ws://localhost:7777 \
 *   CASHU_MINT_URL=http://localhost:3338 \
 *   ORACLE_ENDPOINT=http://localhost:3001 \
 *   ORACLE_PUBKEY=<oracle-pubkey-hex-or-npub> \
 *   C2PA_SOURCE_PROOFS_JSON='[...]' \
 *   deno run --allow-env --allow-net --allow-read --env example/c2pa-media-verification/requester.ts
 */

import {
  type CashuProof,
  createCustomer,
  createHttpOracleClient,
  DEFINED_SCHEMAS,
} from "anchr-sdk";

const relays = listEnv("NOSTR_RELAYS", ["ws://localhost:7777"]);
const mint = requiredEnv("CASHU_MINT_URL");
const oracleEndpoint = requiredEnv("ORACLE_ENDPOINT");
const oraclePubkey = requiredEnv("ORACLE_PUBKEY");
const sourceProofs = parseSourceProofs();

const LOCATION_HINT = Deno.env.get("C2PA_LOCATION_HINT") ?? "Shibuya, Tokyo";
const EXPECTED_LAT = Number(Deno.env.get("C2PA_EXPECTED_LAT") ?? "35.6595");
const EXPECTED_LON = Number(Deno.env.get("C2PA_EXPECTED_LON") ?? "139.7004");
const MAX_DISTANCE_KM = Number(Deno.env.get("C2PA_MAX_DISTANCE_KM") ?? "0.5");
const MAX_SATS = Number(Deno.env.get("C2PA_MAX_SATS") ?? "100");

const customer = createCustomer({
  oracles: [oraclePubkey],
  relays,
  mint,
  oracleClient: createHttpOracleClient({
    endpoint: oracleEndpoint,
    oraclePubkey,
    apiKey: Deno.env.get("ORACLE_API_KEY") ?? undefined,
  }),
  quoteWindowMs: Number(Deno.env.get("QUOTE_WINDOW_MS") ?? "30000"),
  resultTimeoutMs: Number(Deno.env.get("RESULT_TIMEOUT_MS") ?? "600000"),
});

console.log("=== C2PA Media Verification - Requester / Customer ===\n");
console.log(`Relays:   ${relays.join(", ")}`);
console.log(`Mint:     ${mint}`);
console.log(`Oracle:   ${oraclePubkey}`);
console.log(`Location: ${LOCATION_HINT}`);
console.log(`Bounty:   ${MAX_SATS} sats\n`);

const result = await customer.request({
  spec: {
    schema: DEFINED_SCHEMAS.C2PA_IMAGE_V1,
    description: "Current situation at the requested location",
    predicate: {
      locationHint: LOCATION_HINT,
      expectedGps: { lat: EXPECTED_LAT, lon: EXPECTED_LON },
      maxGpsDistanceKm: MAX_DISTANCE_KM,
      freshnessSeconds: Number(Deno.env.get("C2PA_FRESHNESS_SECONDS") ?? "600"),
    },
  },
  payment: {
    maxAmount: MAX_SATS,
    locktimeSeconds: Number(Deno.env.get("LOCKTIME_SECONDS") ?? "3600"),
  },
  sourceProofs,
  provider: Deno.env.get("C2PA_PROVIDER_PUBKEY") ?? undefined,
});

console.log("--- Result ---\n");
console.log(`Provider: ${result.providerPubkey}`);
console.log(`Schema:   ${result.schema}`);
console.log("Data:");
console.log(JSON.stringify(result.data, null, 2));
console.log(
  `Proof:    ${
    typeof result.proof === "string"
      ? `${result.proof.length} chars`
      : `${result.proof.byteLength} bytes`
  }`,
);

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function listEnv(name: string, fallback: string[]): string[] {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return fallback;
  return raw.split(",").map((v) => v.trim()).filter(Boolean);
}

function parseSourceProofs(): CashuProof[] {
  const raw = requiredEnv("C2PA_SOURCE_PROOFS_JSON");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("C2PA_SOURCE_PROOFS_JSON must be a non-empty JSON array");
  }
  return parsed as CashuProof[];
}
