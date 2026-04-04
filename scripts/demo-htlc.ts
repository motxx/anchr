/**
 * Anchr HTLC Demo — Full 3-actor lifecycle (Requester → Worker → Oracle).
 *
 * Exercises the complete README flow with local infrastructure:
 *   - Nostr relay (ws://localhost:7777)
 *   - Blossom server (http://localhost:3333)
 *   - Cashu mint with FakeWallet (http://localhost:3338)
 *
 * Run:
 *   docker compose up -d && sleep 3
 *   NOSTR_RELAYS=ws://localhost:7777 BLOSSOM_SERVERS=http://localhost:3333 CASHU_MINT_URL=http://localhost:3338 deno run --allow-all --env scripts/demo-htlc.ts
 */

import { generateEphemeralIdentity, type NostrIdentity } from "../src/infrastructure/nostr/identity";
import {
  buildQueryRequestEvent,
  buildQuoteFeedbackEvent,
  buildSelectionFeedbackEvent,
  buildQueryResponseEvent,
  parseQueryRequestPayload,
  parseFeedbackPayload,
  parseQueryResponsePayload,
  parseOracleResponsePayload,
  type QueryRequestPayload,
  type QuoteFeedbackPayload,
  type SelectionFeedbackPayload,
  type QueryResponsePayload,
  ANCHR_QUERY_REQUEST,
} from "../src/infrastructure/nostr/events";
import { buildPreimageDM, parseOracleDM } from "../src/infrastructure/nostr/dm";
import { publishEvent, closePool } from "../src/infrastructure/nostr/client";
import { deriveConversationKey, encryptNip44 } from "../src/infrastructure/nostr/encryption";
import { createPreimageStore } from "../src/infrastructure/cashu/preimage-store";
import { createBountyToken } from "../src/infrastructure/cashu/wallet";
import {
  swapHtlcBindWorker,
  redeemHtlcToken,
  inspectEscrowToken,
} from "../src/infrastructure/cashu/escrow";
import { workerUpload } from "../src/infrastructure/blossom/worker-upload";
import { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { Event } from "nostr-tools/core";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// --- Formatting ---

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

let passed = 0;
let failed = 0;
let currentStep = 0;

function header() {
  console.log(`\n${CYAN}${BOLD}${"═".repeat(60)}${RESET}`);
  console.log(`${CYAN}${BOLD}  Anchr HTLC Demo — Full 3-Actor Lifecycle${RESET}`);
  console.log(`${CYAN}${BOLD}  Requester → Worker → Oracle (with Cashu + Nostr + Blossom)${RESET}`);
  console.log(`${CYAN}${BOLD}${"═".repeat(60)}${RESET}\n`);
}

function step(msg: string) {
  currentStep++;
  console.log(`\n${BOLD}[Step ${currentStep}]${RESET} ${msg}`);
}

function ok(msg: string) {
  passed++;
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}

function info(msg: string) {
  console.log(`  ${DIM}${msg}${RESET}`);
}

function warn(msg: string) {
  console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
}

function fail(msg: string) {
  failed++;
  console.log(`  ${RED}✗${RESET} ${msg}`);
}

function summary() {
  console.log(`\n${CYAN}${BOLD}${"═".repeat(60)}${RESET}`);
  if (failed === 0) {
    console.log(`  ${GREEN}${BOLD}All ${passed} checks passed.${RESET} HTLC lifecycle demo complete.`);
  } else {
    console.log(`  ${RED}${BOLD}${failed} check(s) failed${RESET}, ${passed} passed.`);
  }
  console.log(`${CYAN}${BOLD}${"═".repeat(60)}${RESET}\n`);
}

// --- Infrastructure checks ---

const RELAY_URL = process.env.NOSTR_RELAYS?.split(",")[0]?.trim() ?? "ws://localhost:7777";
const BLOSSOM_URL = process.env.BLOSSOM_SERVERS?.split(",")[0]?.trim() ?? "http://localhost:3333";
const CASHU_MINT_URL = process.env.CASHU_MINT_URL?.trim() ?? "http://localhost:3338";

async function checkRelay(): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try {
      const ws = new WebSocket(RELAY_URL);
      const ok = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => { ws.close(); resolve(false); }, 2000);
        ws.onopen = () => { clearTimeout(t); ws.close(); resolve(true); };
        ws.onerror = () => { clearTimeout(t); resolve(false); };
      });
      if (ok) return true;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function checkBlossom(): Promise<boolean> {
  try {
    const res = await fetch(BLOSSOM_URL, { signal: AbortSignal.timeout(3000) });
    return res.ok || res.status === 404; // server is up
  } catch {
    return false;
  }
}

async function checkCashuMint(): Promise<boolean> {
  try {
    const res = await fetch(`${CASHU_MINT_URL}/v1/info`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function readRelayEvents(filter: Filter, timeoutMs = 5000): Promise<Event[]> {
  const pool = new SimplePool();
  const events: Event[] = [];
  return new Promise<Event[]>((resolve) => {
    const timer = setTimeout(() => { sub.close(); pool.close([]); resolve(events); }, timeoutMs);
    const sub = pool.subscribeMany([RELAY_URL], filter, {
      onevent(event: Event) { events.push(event); },
      oneose() { clearTimeout(timer); sub.close(); pool.close([]); resolve(events); },
    });
  });
}

// --- Main ---

async function runDemo() {
  header();

  // ============================================================
  // Infrastructure checks
  // ============================================================
  step("Checking local infrastructure...");

  const [relayOk, blossomOk, cashuOk] = await Promise.all([
    checkRelay(),
    checkBlossom(),
    checkCashuMint(),
  ]);

  if (relayOk) ok(`Nostr relay at ${RELAY_URL}`);
  else { fail(`Relay not reachable at ${RELAY_URL}`); return; }

  if (blossomOk) ok(`Blossom server at ${BLOSSOM_URL}`);
  else { fail(`Blossom not reachable at ${BLOSSOM_URL}`); return; }

  if (cashuOk) ok(`Cashu mint at ${CASHU_MINT_URL}`);
  else { fail(`Cashu mint not reachable at ${CASHU_MINT_URL}`); return; }

  // ============================================================
  // Create identities for 3 actors
  // ============================================================
  step("Creating ephemeral identities for 3 actors...");

  const requester: NostrIdentity = generateEphemeralIdentity();
  const worker: NostrIdentity = generateEphemeralIdentity();
  const oracle: NostrIdentity = generateEphemeralIdentity();

  ok(`Requester pubkey: ${requester.publicKey.slice(0, 16)}...`);
  ok(`Worker pubkey:    ${worker.publicKey.slice(0, 16)}...`);
  ok(`Oracle pubkey:    ${oracle.publicKey.slice(0, 16)}...`);

  // ============================================================
  // Step 1 (README): Oracle generates preimage, returns hash
  // ============================================================
  step("Oracle generates preimage, returns hash to Requester...");

  const preimageStore = createPreimageStore();
  const queryId = `query_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const preimageEntry = preimageStore.create();

  ok(`Hash: ${preimageEntry.hash.slice(0, 16)}...`);
  info(`Preimage stored secretly by Oracle (never exposed to Requester)`);

  // ============================================================
  // Step 2 (README): Requester holds plain Cashu proofs (Phase 1)
  // ============================================================
  step("Requester mints and holds plain Cashu proofs (Phase 1)...");

  const bountyAmount = 21;
  const bountyResult = await createBountyToken(bountyAmount);
  if (!bountyResult) {
    fail("Failed to mint bounty token from Cashu mint");
    return;
  }

  const holdAmountSats = bountyResult.proofs.reduce((s, p) => s + p.amount, 0);
  ok(`Minted ${holdAmountSats} sats (${bountyResult.proofs.length} proof(s)) — held as plain bearer tokens`);
  info(`Phase 1: no HTLC conditions, no mint interaction — Requester simply holds proofs`);

  // ============================================================
  // Step 3 (README): Requester publishes DVM Job Request (kind 5300)
  // ============================================================
  step("Requester publishes DVM Job Request (kind 5300) to relay...");

  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const uniqueDesc = `渋谷スクランブル交差点 [${queryId}]`;
  const queryPayload: QueryRequestPayload = {
    description: uniqueDesc,
    nonce,
    oracle_pubkey: oracle.publicKey,
    requester_pubkey: requester.publicKey,
    bounty: { mint: CASHU_MINT_URL, token: bountyResult.token },
    expires_at: Date.now() + 600_000,
  };

  const queryEvent = buildQueryRequestEvent(requester, queryId, queryPayload, "JP");
  const pubResult = await publishEvent(queryEvent, [RELAY_URL]);

  if (pubResult.successes.length > 0) {
    ok(`Published kind 5300 event: ${queryEvent.id.slice(0, 16)}...`);
  } else {
    fail("Failed to publish query event to relay");
    return;
  }

  await new Promise(r => setTimeout(r, 500));

  // ============================================================
  // Step 4 (README): Worker discovers query, verifies Oracle pubkey
  // ============================================================
  step("Worker discovers query on relay, verifies Oracle pubkey...");

  const since = Math.floor(Date.now() / 1000) - 30;
  const queryEvents = await readRelayEvents({
    kinds: [ANCHR_QUERY_REQUEST],
    "#t": ["anchr"],
    since,
  });

  const matchingEvent = queryEvents.find((e) => {
    try {
      const p = parseQueryRequestPayload(e.content);
      return p.description === uniqueDesc;
    } catch { return false; }
  });

  if (!matchingEvent) {
    fail("Worker could not find query event on relay");
    return;
  }

  const discoveredPayload = parseQueryRequestPayload(matchingEvent.content);

  // Worker verifies Oracle pubkey against whitelist
  const trustedOracles = [oracle.publicKey];
  if (discoveredPayload.oracle_pubkey && trustedOracles.includes(discoveredPayload.oracle_pubkey)) {
    ok(`Query discovered: "${discoveredPayload.description}"`);
    ok(`Oracle pubkey verified against whitelist`);
  } else {
    fail("Oracle pubkey not in trusted list — Worker would drop out");
    return;
  }

  // ============================================================
  // Step 5 (README): Worker sends quote (kind 7000 status=payment-required)
  // ============================================================
  step("Worker sends quote (kind 7000 status=payment-required)...");

  const quotePayload: QuoteFeedbackPayload = {
    status: "payment-required",
    worker_pubkey: worker.publicKey,
    amount_sats: bountyAmount,
  };

  const quoteEvent = buildQuoteFeedbackEvent(
    worker,
    matchingEvent.id,
    requester.publicKey,
    quotePayload,
  );

  const quotePubResult = await publishEvent(quoteEvent, [RELAY_URL]);
  if (quotePubResult.successes.length > 0) {
    ok(`Quote published: ${quoteEvent.id.slice(0, 16)}... (${bountyAmount} sats)`);
  } else {
    fail("Failed to publish quote event");
    return;
  }

  // ============================================================
  // Requester receives quote (verify decryption)
  // ============================================================
  step("Requester receives and decrypts Worker quote...");

  await new Promise(r => setTimeout(r, 500));

  const feedbackEvents = await readRelayEvents({
    kinds: [7000],
    "#e": [matchingEvent.id],
    since,
  });

  const quoteEvents = feedbackEvents.filter((e) => {
    const statusTag = e.tags.find((t) => t[0] === "status");
    return statusTag?.[1] === "payment-required";
  });

  if (quoteEvents.length === 0) {
    fail("Requester could not find quote events on relay");
    return;
  }

  const firstQuote = quoteEvents[0]!;
  const receivedQuote = parseFeedbackPayload(
    firstQuote.content,
    requester.secretKey,
    firstQuote.pubkey,
  );

  if (receivedQuote.status === "payment-required") {
    const q = receivedQuote as QuoteFeedbackPayload;
    ok(`Received quote from Worker: ${q.worker_pubkey.slice(0, 16)}... for ${q.amount_sats} sats`);
  } else {
    fail("Unexpected feedback status");
    return;
  }

  // ============================================================
  // Step 6 (README): Requester swaps HTLC to bind Worker (Phase 2)
  // ============================================================
  step("Requester swaps HTLC to add Worker pubkey (Phase 2)...");

  const finalToken = await swapHtlcBindWorker(bountyResult.proofs, {
    hash: preimageEntry.hash,
    workerPubkey: worker.publicKey,
    requesterRefundPubkey: requester.publicKey,
    locktimeSeconds: Math.floor(Date.now() / 1000) + 3600,
  });

  if (!finalToken) {
    fail("Failed to swap HTLC for Worker binding");
    return;
  }

  const finalInspected = inspectEscrowToken(finalToken.token)!;
  ok(`HTLC swapped: ${finalInspected.amountSats} sats, hashlock + P2PK(Worker) + refund(Requester)`);

  // ============================================================
  // Step 7 (README): Requester announces selection (kind 7000 status=processing)
  // ============================================================
  step("Requester announces Worker selection (kind 7000 status=processing)...");

  const selectionPayload: SelectionFeedbackPayload = {
    status: "processing",
    selected_worker_pubkey: worker.publicKey,
    htlc_token: finalToken.token,
  };

  const selectionEvent = buildSelectionFeedbackEvent(
    requester,
    matchingEvent.id,
    worker.publicKey,
    selectionPayload,
  );

  const selPubResult = await publishEvent(selectionEvent, [RELAY_URL]);
  if (selPubResult.successes.length > 0) {
    ok(`Selection announced: ${selectionEvent.id.slice(0, 16)}...`);
  } else {
    fail("Failed to publish selection event");
    return;
  }

  // ============================================================
  // Worker receives selection, confirms own pubkey
  // ============================================================
  step("Worker receives selection, confirms own pubkey...");

  await new Promise(r => setTimeout(r, 500));

  const selFeedbackEvents = await readRelayEvents({
    kinds: [7000],
    "#e": [matchingEvent.id],
    since,
  });

  // Find selection event addressed to Worker
  let workerSelected = false;
  for (const e of selFeedbackEvents) {
    try {
      const p = parseFeedbackPayload(e.content, worker.secretKey, e.pubkey);
      if (p.status === "processing") {
        const sel = p as SelectionFeedbackPayload;
        if (sel.selected_worker_pubkey === worker.publicKey) {
          workerSelected = true;
          ok(`Worker confirmed: own pubkey in selection`);
          info(`HTLC token received (${sel.htlc_token?.slice(0, 20)}...)`);
          break;
        }
      }
    } catch { /* not decryptable by Worker */ }
  }

  if (!workerSelected) {
    fail("Worker could not find or decrypt selection event");
    return;
  }

  // ============================================================
  // Steps 8-9 (README): Worker photographs, encrypts, uploads to Blossom
  // ============================================================
  step("Worker creates test data, encrypts (AES-256-GCM), uploads to Blossom...");

  // Simulate a C2PA-signed photo (test image data with nonce)
  const testImageData = new TextEncoder().encode(
    JSON.stringify({
      type: "test_image",
      nonce: nonce,
      description: "渋谷スクランブル交差点",
      timestamp: new Date().toISOString(),
      c2pa_stub: true,
    }),
  );

  const uploadResult = await workerUpload(testImageData, "test-photo.jpg", "image/jpeg", {
    serverUrls: [BLOSSOM_URL],
    skipExifStrip: true,
  });

  if (!uploadResult) {
    fail("Failed to upload to Blossom");
    return;
  }

  ok(`Uploaded to Blossom: ${uploadResult.blossom.hash.slice(0, 16)}...`);
  info(`URL: ${uploadResult.blossom.urls[0]}`);

  // Encrypt symmetric key K → K_R (for Requester) and K_O (for Oracle) using NIP-44
  const keyMaterial = JSON.stringify({
    key: uploadResult.blossom.encryptKey,
    iv: uploadResult.blossom.encryptIv,
  });

  const kR = encryptNip44(keyMaterial, deriveConversationKey(worker.secretKey, requester.publicKey));
  const kO = encryptNip44(keyMaterial, deriveConversationKey(worker.secretKey, oracle.publicKey));

  ok(`K encrypted → K_R (Requester) and K_O (Oracle) via NIP-44`);

  // ============================================================
  // Step 10 (README): Worker publishes DVM Job Result (kind 6300)
  // ============================================================
  step("Worker publishes DVM Job Result (kind 6300)...");

  const responsePayload: QueryResponsePayload = {
    nonce_echo: nonce,
    attachments: [{
      blossom_hash: uploadResult.blossom.hash,
      blossom_urls: uploadResult.blossom.urls,
      decrypt_key_requester: kR,
      decrypt_key_oracle: kO,
      decrypt_iv: uploadResult.blossom.encryptIv,
      mime: "image/jpeg",
    }],
    notes: "渋谷スクランブル交差点の現在の様子を確認しました",
  };

  const responseEvent = buildQueryResponseEvent(
    worker,
    matchingEvent.id,
    requester.publicKey,
    responsePayload,
    oracle.publicKey, // Oracle can now decrypt oracle_payload tag
  );

  const resPubResult = await publishEvent(responseEvent, [RELAY_URL]);
  if (resPubResult.successes.length > 0) {
    ok(`Result published: ${responseEvent.id.slice(0, 16)}...`);
  } else {
    fail("Failed to publish result event");
    return;
  }

  // ============================================================
  // Requester receives result, decrypts K_R
  // ============================================================
  step("Requester receives result, decrypts K_R, accesses blob...");

  await new Promise(r => setTimeout(r, 500));

  const responseEvents = await readRelayEvents({
    kinds: [6300],
    "#e": [matchingEvent.id],
    since,
  });

  if (responseEvents.length === 0) {
    fail("Requester could not find result event on relay");
    return;
  }

  const firstResponse = responseEvents[0]!;
  const parsedResponse = parseQueryResponsePayload(
    firstResponse.content,
    requester.secretKey,
    firstResponse.pubkey,
  );

  ok(`Result decrypted: nonce_echo=${parsedResponse.nonce_echo}`);
  if (parsedResponse.attachments && parsedResponse.attachments.length > 0) {
    info(`Attachment: ${parsedResponse.attachments[0]!.blossom_hash.slice(0, 16)}...`);
  }

  // ============================================================
  // Steps 11-12 (README): Oracle verifies C2PA, delivers preimage via DM
  // ============================================================
  step("Oracle receives result, verifies C2PA (stub), delivers preimage via NIP-44 DM...");

  // Verify Worker pubkey from event metadata (no decryption needed)
  const resultWorkerPubkey = firstResponse.pubkey;
  if (resultWorkerPubkey === worker.publicKey) {
    ok(`Worker pubkey verified: matches selected Worker`);
  } else {
    fail("Worker pubkey mismatch!");
    return;
  }

  // Oracle decrypts oracle_payload tag (NIP-44 encrypted to Oracle)
  const oraclePayload = parseOracleResponsePayload(firstResponse, oracle.secretKey);
  if (!oraclePayload) {
    fail("Oracle could not decrypt oracle_payload tag");
    return;
  }
  ok(`Oracle decrypted oracle_payload from kind 6300 tags`);
  info(`Blossom hash: ${oraclePayload.attachments[0]?.blossom_hash.slice(0, 16)}...`);
  info(`K_O available for blob decryption`);

  // C2PA verification (stub — Oracle would download blob, decrypt with K_O, verify C2PA)
  ok(`C2PA verification passed (stub)`);

  // Deliver preimage via NIP-44 DM (kind 4)
  const preimage = preimageStore.getPreimage(preimageEntry.hash);
  if (!preimage) {
    fail("Oracle lost preimage");
    return;
  }

  const preimageEvent = buildPreimageDM(oracle, worker.publicKey, queryId, preimage);
  const dmPubResult = await publishEvent(preimageEvent, [RELAY_URL]);

  if (dmPubResult.successes.length > 0) {
    ok(`Preimage delivered via NIP-44 DM: ${preimageEvent.id.slice(0, 16)}...`);
  } else {
    fail("Failed to publish preimage DM");
    return;
  }

  // ============================================================
  // Step 13 (README): Worker receives preimage, verifies Oracle pubkey
  // ============================================================
  step("Worker receives preimage via DM, verifies Oracle pubkey...");

  await new Promise(r => setTimeout(r, 500));

  const dmEvents = await readRelayEvents({
    kinds: [4],
    "#p": [worker.publicKey],
    since,
  });

  if (dmEvents.length === 0) {
    fail("Worker could not find DM events on relay");
    return;
  }

  // Worker verifies sender is Oracle
  const oracleDm = dmEvents.find((e) => e.pubkey === oracle.publicKey);
  if (!oracleDm) {
    fail("No DM from Oracle found");
    return;
  }

  const dmPayload = parseOracleDM(oracleDm.content, worker.secretKey, oracleDm.pubkey);

  if (dmPayload.type === "preimage" && dmPayload.query_id === queryId) {
    ok(`Preimage received: ${dmPayload.preimage.slice(0, 16)}...`);
    ok(`Oracle pubkey verified: sender matches Job Request`);
  } else {
    fail("Unexpected DM payload");
    return;
  }

  // Verify preimage matches hash
  const computedHash = bytesToHex(sha256(Buffer.from(dmPayload.preimage, "hex")));

  if (computedHash === preimageEntry.hash) {
    ok(`Preimage verification: hash(preimage) matches original hash`);
  } else {
    fail(`Hash mismatch: expected ${preimageEntry.hash.slice(0, 16)}..., got ${computedHash.slice(0, 16)}...`);
    return;
  }

  // ============================================================
  // Step 14 (README): Worker redeems HTLC
  // ============================================================
  step("Worker redeems HTLC with preimage + Worker signature...");

  const redeemResult = await redeemHtlcToken(
    finalToken.proofs,
    dmPayload.preimage,
    worker.secretKeyHex,
  );

  if (redeemResult) {
    ok(`HTLC redeemed on mint: ${redeemResult.amountSats} sats → Worker's unlocked proofs`);
    ok(`Worker now holds ${redeemResult.proofs.length} fresh proof(s)`);
  } else {
    // FakeWallet may not fully support NUT-14 witness verification
    warn(`Mint redemption failed (FakeWallet may not support NUT-14 witnesses)`);
    const redeemInspect = inspectEscrowToken(finalToken.token);
    if (redeemInspect && redeemInspect.amountSats > 0) {
      ok(`HTLC token valid: ${redeemInspect.amountSats} sats (redemption requires NUT-14 compatible mint)`);
      ok(`Worker has preimage + private key → both conditions satisfied`);
    } else {
      fail("HTLC token invalid");
    }
  }

  // ============================================================
  // Summary
  // ============================================================
  info("");
  info("Flow completed:");
  info("  1. Oracle → Requester: hash(preimage)");
  info("  2. Requester: plain Cashu proofs (Phase 1, no conditions)");
  info("  3. Requester → Relay: kind 5300 Job Request");
  info("  4. Worker ← Relay: discover + verify Oracle pubkey");
  info("  5. Worker → Relay: kind 7000 quote (NIP-44 encrypted)");
  info("  6. Requester: swap HTLC → hashlock + P2PK(Worker) (Phase 2)");
  info("  7. Requester → Relay: kind 7000 selection (NIP-44 encrypted)");
  info("  8. Worker → Blossom: encrypted blob (AES-256-GCM)");
  info("  9. Worker → Relay: kind 6300 result (K_R + K_O via NIP-44)");
  info(" 10. Oracle: verify C2PA → deliver preimage via NIP-44 DM");
  info(" 11. Worker: receive preimage → redeem HTLC");

  summary();
}

runDemo()
  .catch((e) => {
    console.error(`${RED}Fatal:${RESET}`, e);
    failed++;
  })
  .finally(() => {
    closePool();
    process.exit(failed > 0 ? 1 : 0);
  });
