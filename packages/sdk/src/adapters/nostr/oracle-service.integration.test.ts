/**
 * Relay-driven Oracle service integration: real kind 6300 results built by
 * the canonical `buildQueryResponseEvent` flow through
 * `createOracleNostrService` on an in-memory relay. Release happens only when
 * the watched request's real verification requirement is met, and only toward
 * the recorded selected Provider.
 */

import { beforeEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { buildQueryResponseEvent } from "@anchr/protocol/events";
import type { Event } from "@anchr/protocol/nostr";
import { ProofSchema } from "@anchr/protocol/schema";
import { createInMemoryRelayClient } from "../../testing/relay.ts";
import { makeQuery } from "../../testing/factories.ts";
import { generateEphemeralIdentity } from "../../identity.ts";
import { clearIntegrityStore, storeIntegrity } from "../../proofs/mod.ts";
import { createPreimageStore } from "../../payments/mod.ts";
import { createOracleNostrService } from "./oracle-service.ts";
import { parseOracleDM } from "./events/dm.ts";
import type { OracleDMPayload } from "./events/events.ts";

const REQUEST_EVENT_ID = "11".repeat(32);

function injectC2paIntegrity(
  attachmentId: string,
  queryId: string,
  gps = { lat: 35.0001, lon: 139.0001 },
) {
  storeIntegrity({
    attachmentId,
    requestId: queryId,
    capturedAt: Date.now(),
    exif: {
      hasExif: false,
      hasCameraModel: false,
      hasGps: false,
      hasTimestamp: false,
      timestampRecent: false,
      gpsNearHint: null,
      metadata: {},
      checks: [],
      failures: [],
    },
    c2pa: {
      available: true,
      hasManifest: true,
      signatureValid: true,
      gps,
      manifest: { title: "test.jpg", claimGenerator: "test" },
      checks: ["C2PA manifest found", "C2PA signature valid"],
      failures: [],
    },
  });
}

function evidenceData(
  attachmentId: string,
  gps = { lat: 35.0001, lon: 139.0001 },
): Record<string, unknown> {
  return {
    attachments: [{
      id: attachmentId,
      uri: `https://blossom.example.com/${attachmentId}`,
      mime_type: "image/jpeg",
      storage_kind: "blossom",
      blossom_hash: attachmentId,
    }],
    gps,
  };
}

async function waitFor(
  cond: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("oracle-service relay integration (canonical wire contract)", () => {
  beforeEach(() => {
    clearIntegrityStore();
  });

  test("releases the preimage only to the selected Provider once the real requirement is met", async () => {
    const relay = createInMemoryRelayClient();
    const oracle = generateEphemeralIdentity();
    const customer = generateEphemeralIdentity();
    const selectedProvider = generateEphemeralIdentity();
    const intruder = generateEphemeralIdentity();
    const store = createPreimageStore();

    const dms: Event[] = [];
    relay.subscribe({ kinds: [4] }, (event) => dms.push(event));

    const service = createOracleNostrService({
      identity: oracle,
      relayClient: relay,
      preimageStore: store,
    });

    const query = makeQuery({
      id: "q-int-pass",
      verification_requirements: ["c2pa"],
      schema: ProofSchema.C2paImageV1,
      schema_requirement: {
        expected_gps: { lat: 35.0, lon: 139.0 },
        max_gps_distance_km: 50,
      },
    });
    const { hash } = service.generateRequestHash(query.id);
    const preimage = store.getPreimage(hash);
    expect(preimage).not.toBeNull();

    service.watchRequest(query, REQUEST_EVENT_ID, "customer_pub");
    injectC2paIntegrity("photo_int", query.id);

    const buildResult = (provider: typeof selectedProvider) =>
      buildQueryResponseEvent(
        provider,
        REQUEST_EVENT_ID,
        customer.publicKey,
        {
          schema: ProofSchema.C2paImageV1,
          data: evidenceData("photo_int"),
          proof: "proof-bytes",
        },
        oracle.publicKey,
        query.id,
      );

    // ATTACK: result arrives before any Provider selection — fail closed,
    // no DM of any kind.
    await relay.publish(buildResult(intruder));
    // ATTACK: selection recorded, but the result comes from a different
    // Provider — ignored.
    service.recordSelectedProvider(query.id, selectedProvider.publicKey);
    await relay.publish(buildResult(intruder));

    // The selected Provider's spec-conforming result is verified against
    // the real requirement and releases the preimage.
    await relay.publish(buildResult(selectedProvider));
    await waitFor(() => dms.length > 0);

    expect(dms.length).toBe(1);
    const dm = parseOracleDM(
      dms[0]!.content,
      selectedProvider.secretKey,
      oracle.publicKey,
    );
    expect(dm?.type).toBe("preimage");
    if (dm?.type !== "preimage") throw new Error("unreachable");
    expect(dm.query_id).toBe(query.id);
    expect(dm.preimage).toBe(preimage);
    // Release material is consumed after delivery.
    expect(store.has(hash)).toBe(false);

    service.stop();
    relay.close();
  });

  test("rejects a result that does not meet the real requirement and ignores binding mismatches", async () => {
    const relay = createInMemoryRelayClient();
    const oracle = generateEphemeralIdentity();
    const customer = generateEphemeralIdentity();
    const provider = generateEphemeralIdentity();
    const store = createPreimageStore();

    const dms: Event[] = [];
    relay.subscribe({ kinds: [4] }, (event) => dms.push(event));

    const service = createOracleNostrService({
      identity: oracle,
      relayClient: relay,
      preimageStore: store,
    });

    const query = makeQuery({
      id: "q-int-fail",
      verification_requirements: ["c2pa"],
      schema: ProofSchema.C2paImageV1,
      schema_requirement: {
        expected_gps: { lat: 35.0, lon: 139.0 },
        max_gps_distance_km: 50,
      },
    });
    const { hash } = service.generateRequestHash(query.id);
    service.watchRequest(query, REQUEST_EVENT_ID, "customer_pub");
    service.recordSelectedProvider(query.id, provider.publicKey);

    // ATTACK: payload bound to a different query id — ignored entirely.
    await relay.publish(buildQueryResponseEvent(
      provider,
      REQUEST_EVENT_ID,
      customer.publicKey,
      {
        schema: ProofSchema.C2paImageV1,
        data: evidenceData("photo_other"),
        proof: "proof-bytes",
      },
      oracle.publicKey,
      "another-query",
    ));

    injectC2paIntegrity("photo_fail", query.id, { lat: 36.0, lon: 140.0 });

    // A bound result with GPS outside the requested policy is rejected.
    await relay.publish(buildQueryResponseEvent(
      provider,
      REQUEST_EVENT_ID,
      customer.publicKey,
      {
        schema: ProofSchema.C2paImageV1,
        data: evidenceData("photo_fail", { lat: 36.0, lon: 140.0 }),
        proof: "proof-bytes",
      },
      oracle.publicKey,
      query.id,
    ));
    await waitFor(() => dms.length > 0);

    expect(dms.length).toBe(1);
    const dm: OracleDMPayload | null = parseOracleDM(
      dms[0]!.content,
      provider.secretKey,
      oracle.publicKey,
    );
    expect(dm?.type).toBe("rejection");
    if (dm?.type !== "rejection") throw new Error("unreachable");
    expect(dm.reason).toContain("GPS");
    // The preimage is never revealed on the rejected path.
    expect(store.has(hash)).toBe(true);

    service.stop();
    relay.close();
  });
});
