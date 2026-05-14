/**
 * Auto-Claim Demo - Insurance Provider / Customer
 *
 * Creates a NIP-90 job request: "if flight NH123 is delayed >= 120 min,
 * pay 10,000 sats to the Provider that returns a valid TLSNotary proof."
 *
 * No Anchr-operated host is involved. The request is announced on Nostr,
 * Providers offer over Nostr, the selected Provider publishes an encrypted
 * result event, and the Oracle settles by DMing the preimage to the Provider.
 *
 * Usage:
 *   NOSTR_RELAYS=ws://localhost:7777 \
 *   CASHU_MINT_URL=http://localhost:3338 \
 *   ORACLE_ENDPOINT=http://localhost:3001 \
 *   ORACLE_PUBKEY=<oracle-pubkey-hex-or-npub> \
 *   AUTO_CLAIM_SOURCE_PROOFS_JSON='[...]' \
 *   deno run --allow-env --allow-net --allow-read --env example/auto-claim/insurer.ts
 */

import {
  type CashuProof,
  createCashuClient,
  createCustomer,
  createHttpOracleClient,
  createRelayClient,
  DEFINED_SCHEMAS,
} from "anchr-sdk";

const relays = listEnv("NOSTR_RELAYS", ["ws://localhost:7777"]);
const mint = requiredEnv("CASHU_MINT_URL");
const oracleEndpoint = requiredEnv("ORACLE_ENDPOINT");
const oraclePubkey = requiredEnv("ORACLE_PUBKEY");
const sourceProofs = parseSourceProofs();

const AIRLINE_URL = Deno.env.get("AIRLINE_URL") ?? "http://localhost:4000";
const FLIGHT = Deno.env.get("FLIGHT") ?? "NH123";
const PAYOUT_SATS = Number(Deno.env.get("PAYOUT_SATS") ?? "10000");
const OFFER_WINDOW_MS = Number(Deno.env.get("OFFER_WINDOW_MS") ?? "30000");
const RESULT_TIMEOUT_MS = Number(
  Deno.env.get("RESULT_TIMEOUT_MS") ?? "3600000",
);

const customer = createCustomer({
  oracles: [{
    pubkey: oraclePubkey,
    client: createHttpOracleClient({
      endpoint: oracleEndpoint,
      apiKey: Deno.env.get("ORACLE_API_KEY") ?? undefined,
    }),
  }],
  relays,
  mint,
  cashuClient: createCashuClient({ mintUrl: mint }),
  relayClient: createRelayClient(relays),
  offerWindowMs: OFFER_WINDOW_MS,
  resultTimeoutMs: RESULT_TIMEOUT_MS,
});

console.log("=== Auto-Claim - Insurance Provider / Customer ===\n");
console.log(`Relays:  ${relays.join(", ")}`);
console.log(`Mint:    ${mint}`);
console.log(`Oracle:  ${oraclePubkey}`);
console.log(`Airline: ${AIRLINE_URL}`);
console.log(`Flight:  ${FLIGHT}`);
console.log(`Payout:  ${PAYOUT_SATS} sats on delay >= 120 min\n`);

const result = await customer.request({
  spec: {
    schema: DEFINED_SCHEMAS.TLSN_HTTPS_V1,
    description: `Auto-claim: ${FLIGHT} delay >= 120 min`,
    predicate: {
      targetUrl: `${AIRLINE_URL}/api/flights/${FLIGHT}`,
      conditions: [
        {
          type: "jsonpath",
          expression: "status",
          expected: "delayed",
          description: "Flight status must be delayed",
        },
        {
          type: "regex",
          expression: '"delay_minutes":\\s*(1[2-9]\\d|[2-9]\\d{2}|\\d{4,})',
          description: "Delay must be >= 120 minutes",
        },
      ],
      maxAttestationAgeSeconds: 300,
    },
  },
  payment: {
    maxAmount: PAYOUT_SATS,
    locktimeSeconds: Number(Deno.env.get("LOCKTIME_SECONDS") ?? "7200"),
  },
  sourceProofs,
  provider: Deno.env.get("AUTO_CLAIM_PROVIDER_PUBKEY") ?? undefined,
});

console.log("\nClaim proof received.");
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
  const raw = requiredEnv("AUTO_CLAIM_SOURCE_PROOFS_JSON");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      "AUTO_CLAIM_SOURCE_PROOFS_JSON must be a non-empty JSON array",
    );
  }
  return parsed as CashuProof[];
}
