/**
 * C2PA Media Verification - Provider
 *
 * Listens for C2PA image requests on Nostr, offers matching requests, and
 * returns the C2PA-signed photo as an encrypted kind 6300 result after
 * selection. The Oracle reads the oracle_payload tag, verifies the proof, and
 * DMs the HTLC preimage to this Provider.
 *
 * For large media, use a Blossom-backed producer. This minimal example embeds
 * the signed image bytes as base64 proof data so the flow stays serverless.
 *
 * Usage:
 *   NOSTR_RELAYS=ws://localhost:7777 \
 *   CASHU_MINT_URL=http://localhost:3338 \
 *   ORACLE_PUBKEY=<oracle-pubkey-hex-or-npub> \
 *   C2PA_PROVIDER_PRIVKEY=<provider-nsec-or-hex> \
 *   deno run --allow-env --allow-net --allow-read --env examples/c2pa-media-verification/worker.ts signed-photo.jpg
 */

import {
  createCashuClient,
  createProvider,
  createRelayClient,
  DEFINED_SCHEMAS,
  type ProviderRequestEvent,
} from "anchr-sdk";

const relays = listEnv("NOSTR_RELAYS", ["ws://localhost:7777"]);
const mint = requiredEnv("CASHU_MINT_URL");
const oraclePubkey = requiredEnv("ORACLE_PUBKEY");
const privKey = requiredEnv("C2PA_PROVIDER_PRIVKEY");
const photoPath = Deno.args[0] ?? Deno.env.get("C2PA_PHOTO_PATH") ??
  "signed-photo.jpg";
const offerSats = Number(Deno.env.get("C2PA_OFFER_SATS") ?? "100");

interface C2paPredicate {
  locationHint?: string;
  expectedGps?: { lat: number; lon: number };
  maxGpsDistanceKm?: number;
  freshnessSeconds?: number;
}

const provider = createProvider({
  oracles: [oraclePubkey],
  relays,
  mint,
  privKey,
  cashuClient: createCashuClient({ mintUrl: mint }),
  relayClient: createRelayClient(relays),
  selectionTimeoutMs: Number(Deno.env.get("SELECTION_TIMEOUT_MS") ?? "120000"),
  preimageTimeoutMs: Number(Deno.env.get("PREIMAGE_TIMEOUT_MS") ?? "300000"),
});

console.log("=== C2PA Media Verification - Provider ===\n");
console.log(`Provider: ${provider.pubkey}`);
console.log(`Relays:   ${relays.join(", ")}`);
console.log(`Mint:     ${mint}`);
console.log(`Oracle:   ${oraclePubkey}`);
console.log(`Photo:    ${photoPath}\n`);
console.log("Listening for C2PA photo requests...\n");

const stop = () => {
  void provider.stop();
};
Deno.addSignalListener("SIGINT", stop);
Deno.addSignalListener("SIGTERM", stop);

await provider.serve(async (request: ProviderRequestEvent) => {
  if (request.spec.schema !== DEFINED_SCHEMAS.C2PA_IMAGE_V1) return null;
  const predicate = parsePredicate(request.spec.predicate);
  if (!predicate) return null;

  console.log(`Matched request from ${request.customerPubkey}`);
  console.log(`  Location: ${predicate.locationHint ?? "unspecified"}`);
  console.log(`  Offer:    ${Math.min(offerSats, request.maxAmountSats)} sats`);

  return {
    amountSats: Math.min(offerSats, request.maxAmountSats),
    produce: async () => {
      const bytes = await Deno.readFile(photoPath);
      const filename = photoPath.split("/").pop() ?? "signed-photo.jpg";
      return {
        data: {
          filename,
          mimeType: guessMimeType(filename),
          locationHint: predicate.locationHint,
          expectedGps: predicate.expectedGps,
          maxGpsDistanceKm: predicate.maxGpsDistanceKm,
          capturedAt: new Date().toISOString(),
          notes: Deno.env.get("C2PA_NOTES") ??
            "Photo submitted by the selected Provider",
        },
        proof: base64Encode(bytes),
      };
    },
  };
});

function parsePredicate(value: unknown): C2paPredicate | null {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  const expectedGps = parseGps(p.expectedGps);
  return {
    locationHint: typeof p.locationHint === "string"
      ? p.locationHint
      : undefined,
    expectedGps,
    maxGpsDistanceKm: typeof p.maxGpsDistanceKm === "number"
      ? p.maxGpsDistanceKm
      : undefined,
    freshnessSeconds: typeof p.freshnessSeconds === "number"
      ? p.freshnessSeconds
      : undefined,
  };
}

function parseGps(value: unknown): { lat: number; lon: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const gps = value as Record<string, unknown>;
  if (typeof gps.lat !== "number" || typeof gps.lon !== "number") {
    return undefined;
  }
  return { lat: gps.lat, lon: gps.lon };
}

function guessMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  return "image/jpeg";
}

function base64Encode(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return btoa(out);
}

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
