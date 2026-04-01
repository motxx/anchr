/**
 * Anchr HTLC Demo — Web UI server.
 *
 * Serves the split-screen 3-actor demo and runs the HTLC lifecycle
 * over WebSocket, emitting DemoEvent JSON for each step.
 *
 *   deno run --allow-all --env scripts/demo-htlc-server.ts
 */
import { generateEphemeralIdentity, type NostrIdentity } from "../src/nostr/identity";
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
} from "../src/nostr/events";
import { buildPreimageDM, parseOracleDM } from "../src/nostr/dm";
import { publishEvent, closePool } from "../src/nostr/client";
import { deriveConversationKey, encryptNip44 } from "../src/nostr/encryption";
import { createPreimageStore } from "../src/oracle/preimage-store";
import { createBountyToken } from "../src/cashu/wallet";
import {
  swapHtlcBindWorker,
  redeemHtlcToken,
  inspectEscrowToken,
} from "../src/cashu/escrow";
import { workerUpload } from "../src/blossom/worker-upload";
import { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { Event } from "nostr-tools/core";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// --- DemoEvent type (mirrors DemoApp.tsx) ---

interface DemoEvent {
  actor: "requester" | "worker" | "oracle" | "system";
  step: number;
  type: "step" | "ok" | "info" | "warn" | "fail";
  message: string;
  data?: Record<string, string | number>;
  timestamp: number;
}

// --- Infrastructure config ---

const RELAY_URL = process.env.NOSTR_RELAYS?.split(",")[0]?.trim() ?? "ws://localhost:7777";
const BLOSSOM_URL = process.env.BLOSSOM_SERVERS?.split(",")[0]?.trim() ?? "http://localhost:3333";
const CASHU_MINT_URL = process.env.CASHU_MINT_URL?.trim() ?? "http://localhost:3338";

// --- Helpers ---

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
    return res.ok || res.status === 404;
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

// --- Demo runner ---

type Emit = (event: DemoEvent) => void;

async function runHtlcDemo(emit: Emit): Promise<void> {
  let stepNum = 0;

  function emitStep(actor: DemoEvent["actor"], msg: string, data?: DemoEvent["data"]) {
    stepNum++;
    emit({ actor, step: stepNum, type: "step", message: msg, data, timestamp: Date.now() });
  }
  function emitOk(actor: DemoEvent["actor"], msg: string, data?: DemoEvent["data"]) {
    emit({ actor, step: stepNum, type: "ok", message: msg, data, timestamp: Date.now() });
  }
  function emitInfo(actor: DemoEvent["actor"], msg: string, data?: DemoEvent["data"]) {
    emit({ actor, step: stepNum, type: "info", message: msg, data, timestamp: Date.now() });
  }
  function emitWarn(actor: DemoEvent["actor"], msg: string, data?: DemoEvent["data"]) {
    emit({ actor, step: stepNum, type: "warn", message: msg, data, timestamp: Date.now() });
  }
  function emitFail(actor: DemoEvent["actor"], msg: string, data?: DemoEvent["data"]) {
    emit({ actor, step: stepNum, type: "fail", message: msg, data, timestamp: Date.now() });
  }

  // 1. Infrastructure checks
  emitStep("system", "Checking local infrastructure...");

  const [relayOk, blossomOk, cashuOk] = await Promise.all([
    checkRelay(),
    checkBlossom(),
    checkCashuMint(),
  ]);

  if (relayOk) emitOk("system", `Nostr relay at ${RELAY_URL}`);
  else { emitFail("system", `Relay not reachable at ${RELAY_URL}`); return; }

  if (blossomOk) emitOk("system", `Blossom server at ${BLOSSOM_URL}`);
  else { emitFail("system", `Blossom not reachable at ${BLOSSOM_URL}`); return; }

  if (cashuOk) emitOk("system", `Cashu mint at ${CASHU_MINT_URL}`);
  else { emitFail("system", `Cashu mint not reachable at ${CASHU_MINT_URL}`); return; }

  // 2. Create identities
  emitStep("system", "Creating ephemeral identities for 3 actors...");

  const requester: NostrIdentity = generateEphemeralIdentity();
  const worker: NostrIdentity = generateEphemeralIdentity();
  const oracle: NostrIdentity = generateEphemeralIdentity();

  emitOk("requester", "Identity created", { pubkey: requester.publicKey.slice(0, 16) + "..." });
  emitOk("worker", "Identity created", { pubkey: worker.publicKey.slice(0, 16) + "..." });
  emitOk("oracle", "Identity created", { pubkey: oracle.publicKey.slice(0, 16) + "..." });

  // 3. Oracle generates preimage
  emitStep("oracle", "Generating preimage, returning hash to Requester...");

  const preimageStore = createPreimageStore();
  const queryId = `query_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const preimageEntry = preimageStore.create();

  emitOk("oracle", "Preimage generated", { hash: preimageEntry.hash.slice(0, 16) + "..." });
  emitInfo("oracle", "Preimage stored secretly (never exposed to Requester)");

  // 4. Requester mints Cashu proofs
  emitStep("requester", "Minting plain Cashu proofs (Phase 1)...");

  const bountyAmount = 21;
  const bountyResult = await createBountyToken(bountyAmount);
  if (!bountyResult) {
    emitFail("requester", "Failed to mint bounty token from Cashu mint");
    return;
  }

  const holdAmountSats = bountyResult.proofs.reduce((s, p) => s + p.amount, 0);
  emitOk("requester", `Minted ${holdAmountSats} sats`, { proofs: bountyResult.proofs.length });
  emitInfo("requester", "Phase 1: no HTLC conditions, Requester holds bearer tokens");

  // 5. Requester publishes Job Request (kind 5300)
  emitStep("requester", "Publishing DVM Job Request (kind 5300)...");

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
    emitOk("requester", "Published to relay", { event_id: queryEvent.id.slice(0, 16) + "..." });
  } else {
    emitFail("requester", "Failed to publish query event");
    return;
  }

  await new Promise(r => setTimeout(r, 500));

  // 6. Worker discovers query
  emitStep("worker", "Discovering query on relay, verifying Oracle pubkey...");

  const since = Math.floor(Date.now() / 1000) - 30;
  const queryEvents = await readRelayEvents({
    kinds: [ANCHR_QUERY_REQUEST],
    "#t": ["anchr"],
    since,
  });

  const matchingEvent = queryEvents.find((e) => {
    try {
      return parseQueryRequestPayload(e.content).description === uniqueDesc;
    } catch { return false; }
  });

  if (!matchingEvent) {
    emitFail("worker", "Could not find query event on relay");
    return;
  }

  const discoveredPayload = parseQueryRequestPayload(matchingEvent.content);
  const trustedOracles = [oracle.publicKey];

  if (discoveredPayload.oracle_pubkey && trustedOracles.includes(discoveredPayload.oracle_pubkey)) {
    emitOk("worker", `Query discovered: "${discoveredPayload.description}"`);
    emitOk("worker", "Oracle pubkey verified against whitelist");
  } else {
    emitFail("worker", "Oracle pubkey not in trusted list");
    return;
  }

  // 7. Worker sends quote
  emitStep("worker", "Sending quote (kind 7000 status=payment-required)...");

  const quotePayload: QuoteFeedbackPayload = {
    status: "payment-required",
    worker_pubkey: worker.publicKey,
    amount_sats: bountyAmount,
  };

  const quoteEvent = buildQuoteFeedbackEvent(worker, matchingEvent.id, requester.publicKey, quotePayload);
  const quotePubResult = await publishEvent(quoteEvent, [RELAY_URL]);

  if (quotePubResult.successes.length > 0) {
    emitOk("worker", `Quote published: ${bountyAmount} sats`, { event_id: quoteEvent.id.slice(0, 16) + "..." });
  } else {
    emitFail("worker", "Failed to publish quote event");
    return;
  }

  // 8. Requester receives quote
  emitStep("requester", "Receiving and decrypting Worker quote...");

  await new Promise(r => setTimeout(r, 500));

  const feedbackEvents = await readRelayEvents({ kinds: [7000], "#e": [matchingEvent.id], since });
  const quoteEvents = feedbackEvents.filter((e) => {
    const statusTag = e.tags.find((t) => t[0] === "status");
    return statusTag?.[1] === "payment-required";
  });

  if (quoteEvents.length === 0) {
    emitFail("requester", "Could not find quote events on relay");
    return;
  }

  const firstQuote = quoteEvents[0]!;
  const receivedQuote = parseFeedbackPayload(firstQuote.content, requester.secretKey, firstQuote.pubkey);

  if (receivedQuote.status === "payment-required") {
    const q = receivedQuote as QuoteFeedbackPayload;
    emitOk("requester", `Quote received: ${q.amount_sats} sats`, { worker: q.worker_pubkey.slice(0, 16) + "..." });
  } else {
    emitFail("requester", "Unexpected feedback status");
    return;
  }

  // 9. Requester swaps HTLC (Phase 2)
  emitStep("requester", "Swapping HTLC to bind Worker (Phase 2)...");

  const finalToken = await swapHtlcBindWorker(bountyResult.proofs, {
    hash: preimageEntry.hash,
    workerPubkey: worker.publicKey,
    requesterRefundPubkey: requester.publicKey,
    locktimeSeconds: Math.floor(Date.now() / 1000) + 3600,
  });

  if (!finalToken) {
    emitFail("requester", "Failed to swap HTLC for Worker binding");
    return;
  }

  const finalInspected = inspectEscrowToken(finalToken.token)!;
  emitOk("requester", `HTLC swapped: ${finalInspected.amountSats} sats`, {
    conditions: "hashlock + P2PK(Worker) + refund(Requester)",
  });

  // 10. Requester announces selection
  emitStep("requester", "Announcing Worker selection (kind 7000 status=processing)...");

  const selectionPayload: SelectionFeedbackPayload = {
    status: "processing",
    selected_worker_pubkey: worker.publicKey,
    htlc_token: finalToken.token,
  };

  const selectionEvent = buildSelectionFeedbackEvent(requester, matchingEvent.id, worker.publicKey, selectionPayload);
  const selPubResult = await publishEvent(selectionEvent, [RELAY_URL]);

  if (selPubResult.successes.length > 0) {
    emitOk("requester", "Selection announced", { event_id: selectionEvent.id.slice(0, 16) + "..." });
  } else {
    emitFail("requester", "Failed to publish selection event");
    return;
  }

  // 11. Worker receives selection
  emitStep("worker", "Receiving selection, confirming own pubkey...");

  await new Promise(r => setTimeout(r, 500));

  const selFeedbackEvents = await readRelayEvents({ kinds: [7000], "#e": [matchingEvent.id], since });

  let workerSelected = false;
  for (const e of selFeedbackEvents) {
    try {
      const p = parseFeedbackPayload(e.content, worker.secretKey, e.pubkey);
      if (p.status === "processing") {
        const sel = p as SelectionFeedbackPayload;
        if (sel.selected_worker_pubkey === worker.publicKey) {
          workerSelected = true;
          emitOk("worker", "Confirmed: own pubkey in selection");
          emitInfo("worker", `HTLC token received (${sel.htlc_token?.slice(0, 20)}...)`);
          break;
        }
      }
    } catch { /* not decryptable */ }
  }

  if (!workerSelected) {
    emitFail("worker", "Could not find or decrypt selection event");
    return;
  }

  // 12. Worker uploads to Blossom
  emitStep("worker", "Creating data, encrypting (AES-256-GCM), uploading to Blossom...");

  const testImageData = new TextEncoder().encode(
    JSON.stringify({
      type: "test_image",
      nonce,
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
    emitFail("worker", "Failed to upload to Blossom");
    return;
  }

  emitOk("worker", `Uploaded to Blossom`, { hash: uploadResult.blossom.hash.slice(0, 16) + "..." });

  const keyMaterial = JSON.stringify({
    key: uploadResult.blossom.encryptKey,
    iv: uploadResult.blossom.encryptIv,
  });
  const kR = encryptNip44(keyMaterial, deriveConversationKey(worker.secretKey, requester.publicKey));
  const kO = encryptNip44(keyMaterial, deriveConversationKey(worker.secretKey, oracle.publicKey));

  emitOk("worker", "K encrypted to K_R (Requester) and K_O (Oracle) via NIP-44");

  // 13. Worker publishes result (kind 6300)
  emitStep("worker", "Publishing DVM Job Result (kind 6300)...");

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

  const responseEvent = buildQueryResponseEvent(worker, matchingEvent.id, requester.publicKey, responsePayload, oracle.publicKey);
  const resPubResult = await publishEvent(responseEvent, [RELAY_URL]);

  if (resPubResult.successes.length > 0) {
    emitOk("worker", "Result published", { event_id: responseEvent.id.slice(0, 16) + "..." });
  } else {
    emitFail("worker", "Failed to publish result event");
    return;
  }

  // 14. Requester receives result
  emitStep("requester", "Receiving result, decrypting K_R, accessing blob...");

  await new Promise(r => setTimeout(r, 500));

  const responseEvents = await readRelayEvents({ kinds: [6300], "#e": [matchingEvent.id], since });

  if (responseEvents.length === 0) {
    emitFail("requester", "Could not find result event on relay");
    return;
  }

  const firstResponse = responseEvents[0]!;
  const parsedResponse = parseQueryResponsePayload(firstResponse.content, requester.secretKey, firstResponse.pubkey);

  emitOk("requester", `Result decrypted`, { nonce_echo: parsedResponse.nonce_echo });
  if (parsedResponse.attachments?.length) {
    emitInfo("requester", `Attachment: ${parsedResponse.attachments[0]!.blossom_hash.slice(0, 16)}...`);
  }

  // 15. Oracle verifies and delivers preimage
  emitStep("oracle", "Verifying C2PA, delivering preimage via NIP-44 DM...");

  const resultWorkerPubkey = firstResponse.pubkey;
  if (resultWorkerPubkey === worker.publicKey) {
    emitOk("oracle", "Worker pubkey verified: matches selected Worker");
  } else {
    emitFail("oracle", "Worker pubkey mismatch!");
    return;
  }

  const oraclePayload = parseOracleResponsePayload(firstResponse, oracle.secretKey);
  if (!oraclePayload) {
    emitFail("oracle", "Could not decrypt oracle_payload tag");
    return;
  }
  emitOk("oracle", "Decrypted oracle_payload from kind 6300 tags");
  emitOk("oracle", "C2PA verification passed (stub)");

  const preimage = preimageStore.getPreimage(preimageEntry.hash);
  if (!preimage) {
    emitFail("oracle", "Lost preimage");
    return;
  }

  const preimageEvent = buildPreimageDM(oracle, worker.publicKey, queryId, preimage);
  const dmPubResult = await publishEvent(preimageEvent, [RELAY_URL]);

  if (dmPubResult.successes.length > 0) {
    emitOk("oracle", "Preimage delivered via NIP-44 DM", { event_id: preimageEvent.id.slice(0, 16) + "..." });
  } else {
    emitFail("oracle", "Failed to publish preimage DM");
    return;
  }

  // 16. Worker receives preimage
  emitStep("worker", "Receiving preimage via DM, verifying Oracle pubkey...");

  await new Promise(r => setTimeout(r, 500));

  const dmEvents = await readRelayEvents({ kinds: [4], "#p": [worker.publicKey], since });

  if (dmEvents.length === 0) {
    emitFail("worker", "Could not find DM events on relay");
    return;
  }

  const oracleDm = dmEvents.find((e) => e.pubkey === oracle.publicKey);
  if (!oracleDm) {
    emitFail("worker", "No DM from Oracle found");
    return;
  }

  const dmPayload = parseOracleDM(oracleDm.content, worker.secretKey, oracleDm.pubkey);

  if (dmPayload.type === "preimage" && dmPayload.query_id === queryId) {
    emitOk("worker", `Preimage received`, { preimage: dmPayload.preimage.slice(0, 16) + "..." });
    emitOk("worker", "Oracle pubkey verified: sender matches Job Request");
  } else {
    emitFail("worker", "Unexpected DM payload");
    return;
  }

  const computedHash = bytesToHex(sha256(Buffer.from(dmPayload.preimage, "hex")));
  if (computedHash === preimageEntry.hash) {
    emitOk("worker", "hash(preimage) matches original hash");
  } else {
    emitFail("worker", `Hash mismatch`);
    return;
  }

  // 17. Worker redeems HTLC
  emitStep("worker", "Redeeming HTLC with preimage + Worker signature...");

  const redeemResult = await redeemHtlcToken(finalToken.proofs, dmPayload.preimage, worker.secretKeyHex);

  if (redeemResult) {
    emitOk("worker", `HTLC redeemed: ${redeemResult.amountSats} sats`, { proofs: redeemResult.proofs.length });
  } else {
    emitWarn("worker", "Mint redemption failed (FakeWallet may not support NUT-14 witnesses)");
    const redeemInspect = inspectEscrowToken(finalToken.token);
    if (redeemInspect && redeemInspect.amountSats > 0) {
      emitOk("worker", `HTLC token valid: ${redeemInspect.amountSats} sats`);
      emitOk("worker", "Worker has preimage + private key — both conditions satisfied");
    } else {
      emitFail("worker", "HTLC token invalid");
    }
  }

  // Done
  emit({ actor: "system", step: stepNum, type: "step", message: "__done__", timestamp: Date.now() });
}

// --- Server ---

const PORT = Number(process.env.PORT) || 3456;

Deno.serve({ port: PORT }, (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/ws") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    console.log("[demo-server] WebSocket connected, starting HTLC demo...");
    socket.onopen = () => {
      runHtlcDemo((event) => {
        try { socket.send(JSON.stringify(event)); } catch { /* client gone */ }
      })
        .catch((e) => {
          const errEvent: DemoEvent = {
            actor: "system", step: 0, type: "fail",
            message: `Fatal: ${e instanceof Error ? e.message : String(e)}`,
            timestamp: Date.now(),
          };
          try { socket.send(JSON.stringify(errEvent)); } catch { /* client gone */ }
        })
        .finally(() => {
          closePool();
          try { socket.close(); } catch { /* already closed */ }
        });
    };
    return response;
  }

  if (url.pathname === "/") {
    // Serve the demo HTML file
    return Deno.readFile("./src/ui/demo/index.html").then(
      (data) => new Response(data, { headers: { "content-type": "text/html; charset=utf-8" } })
    );
  }

  return new Response("Not Found", { status: 404 });
});

console.log(`[demo-server] Anchr HTLC Demo UI running at http://localhost:${PORT}`);
