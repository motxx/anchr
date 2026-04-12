/**
 * C2PA Media Verification — Requester (News Desk)
 *
 * A news desk requests a verified photo from a specific location.
 * Anchr ensures the submitted photo is a real camera capture (not AI-generated)
 * by verifying C2PA Content Credentials, GPS proximity, and EXIF metadata.
 *
 * Usage:
 *   bun run example/c2pa-media-verification/requester.ts
 */

// Published package: import { Anchr } from "anchr-sdk";
import { Anchr } from "../../packages/sdk/src/index.ts";

const SERVER_URL = process.env.ANCHR_SERVER_URL ?? "http://localhost:3000";

const anchr = new Anchr({ serverUrl: SERVER_URL });

console.log("=== C2PA Media Verification — Requester (News Desk) ===\n");
console.log(`Server: ${SERVER_URL}\n`);

// Create a photo verification query.
// The SDK handles:
//   1. Building the query with verification requirements (nonce, gps, timestamp, ai_check)
//   2. Broadcasting via Nostr relay
//   3. Polling for a verified result or timeout
const result = await anchr.photo({
  description: "Current situation at the protest location",
  locationHint: "Shibuya, Tokyo",
  expectedGps: { lat: 35.6595, lon: 139.7004 },
  maxGpsDistanceKm: 0.5,
  maxSats: 100,
  timeoutSeconds: 600,
});

console.log("--- Result ---\n");
console.log(`Verified: ${result.verified}`);
console.log(`Query ID: ${result.queryId}`);
console.log(`Sats paid: ${result.satsPaid}`);

if (result.checks) {
  console.log("\nVerification checks:");
  for (const check of result.checks) {
    console.log(`  ✓ ${check}`);
  }
}

if (result.gps) {
  console.log(`\nGPS: ${result.gps.lat}°N, ${result.gps.lon}°E`);
}

if (result.attachments && result.attachments.length > 0) {
  console.log("\nAttachments:");
  for (const att of result.attachments) {
    console.log(`  - ${att.mimeType}: ${att.uri}`);
  }
}
