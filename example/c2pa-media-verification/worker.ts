/**
 * C2PA Media Verification — Worker (On-ground Journalist)
 *
 * Demonstrates the Worker side of a photo verification flow using the HTTP API directly.
 * The journalist:
 *   1. Discovers open photo queries
 *   2. Uploads a C2PA-signed photo
 *   3. Submits for oracle verification and displays the result
 *
 * Usage:
 *   bun run example/c2pa-media-verification/worker.ts [path-to-c2pa-photo]
 */

const SERVER_URL = process.env.ANCHR_SERVER_URL ?? "http://localhost:3000";
const PHOTO_PATH = process.argv[2] ?? "signed-photo.jpg";

console.log("=== C2PA Media Verification — Worker (Journalist) ===\n");
console.log(`Server: ${SERVER_URL}`);
console.log(`Photo:  ${PHOTO_PATH}\n`);

// --- Step 1: List open photo queries ---

console.log("Step 1: Finding open photo queries...\n");

const queriesRes = await fetch(`${SERVER_URL}/queries`);
if (!queriesRes.ok) {
  console.error(`Failed to list queries: ${queriesRes.status} ${queriesRes.statusText}`);
  process.exit(1);
}

const queries: Array<{
  id: string;
  description: string;
  status: string;
  location_hint?: string;
  expected_gps?: { lat: number; lon: number };
  max_gps_distance_km?: number;
  bounty?: { amount_sats: number };
  verification_requirements: string[];
}> = await queriesRes.json();

// Find a photo query (has gps and ai_check verification requirements)
const photoQuery = queries.find(
  (q) =>
    q.status === "pending" &&
    q.verification_requirements.includes("gps") &&
    q.verification_requirements.includes("ai_check"),
);

if (!photoQuery) {
  console.log("No open photo queries found.");
  console.log("Run requester.ts first to create one.");
  process.exit(0);
}

console.log(`Found query: ${photoQuery.id}`);
console.log(`  Description: ${photoQuery.description}`);
console.log(`  Location: ${photoQuery.location_hint ?? "N/A"}`);
if (photoQuery.expected_gps) {
  console.log(
    `  Expected GPS: ${photoQuery.expected_gps.lat}°N, ${photoQuery.expected_gps.lon}°E (±${photoQuery.max_gps_distance_km ?? "?"}km)`,
  );
}
console.log(`  Bounty: ${photoQuery.bounty?.amount_sats ?? 0} sats`);
console.log();

// --- Step 2: Upload the C2PA-signed photo ---

console.log("Step 2: Uploading C2PA-signed photo...\n");

// Read the photo file (works in Deno and Bun)
let photoBytes: Uint8Array;
try {
  photoBytes = await Deno.readFile(PHOTO_PATH);
} catch {
  console.error(`Photo not found: ${PHOTO_PATH}`);
  console.error("Provide a C2PA-signed photo as the first argument.");
  console.error("You can create one with: c2patool test-photo.jpg -m manifest.json -o signed-photo.jpg");
  process.exit(1);
}

const photoBlob = new File([photoBytes], PHOTO_PATH.split("/").pop() ?? "photo.jpg", {
  type: "image/jpeg",
});

const formData = new FormData();
formData.append("photo", photoBlob);

const uploadRes = await fetch(`${SERVER_URL}/queries/${photoQuery.id}/upload`, {
  method: "POST",
  body: formData,
});

if (!uploadRes.ok) {
  const err = await uploadRes.text();
  console.error(`Upload failed: ${uploadRes.status} ${err}`);
  process.exit(1);
}

const uploadResult: {
  ok: boolean;
  attachment: { id: string; uri: string; mime_type: string };
  encryption: { encrypt_key: string; encrypt_iv: string } | null;
} = await uploadRes.json();
console.log(`Uploaded: ${uploadResult.attachment.id}`);
console.log(`  URI: ${uploadResult.attachment.uri}`);
console.log();

// --- Step 3: Submit the query result ---

console.log("Step 3: Submitting for verification...\n");

// Submit with the attachment ref and optional encryption keys for oracle verification.
// Uses POST /queries/:id/result (the /submit endpoint is deprecated).
const submitRes = await fetch(`${SERVER_URL}/queries/${photoQuery.id}/result`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    worker_pubkey: "example-journalist",
    notes: "Photo taken at Shibuya crossing, C2PA signed by camera",
    attachments: [uploadResult.attachment],
    ...(uploadResult.encryption && {
      encryption_keys: { [uploadResult.attachment.id]: uploadResult.encryption },
    }),
  }),
});

const submitResult: {
  ok: boolean;
  message: string;
  verification?: { passed: boolean; checks: string[]; failures: string[] };
  payment_status?: string;
} = await submitRes.json();
console.log(`Submitted: ${submitResult.ok ? "success" : "failed"}`);
console.log(`  Message: ${submitResult.message}`);
if (submitResult.payment_status) {
  console.log(`  Payment: ${submitResult.payment_status}`);
}
console.log();

// --- Step 4: Check verification result ---

// The submit response already includes the verification result
if (submitResult.verification) {
  console.log("--- Verification Result ---\n");
  console.log(`Passed: ${submitResult.verification.passed}`);
  if (submitResult.verification.checks.length > 0) {
    console.log("Checks passed:");
    for (const c of submitResult.verification.checks) {
      console.log(`  ✓ ${c}`);
    }
  }
  if (submitResult.verification.failures.length > 0) {
    console.log("Checks failed:");
    for (const f of submitResult.verification.failures) {
      console.log(`  ✗ ${f}`);
    }
  }
}
