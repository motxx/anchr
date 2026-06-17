/**
 * INV-08: the full Customer / Provider / Oracle exchange completes with
 * relay events and NIP-44 DMs as the only inter-actor transport. No actor
 * runs or contacts an HTTP endpoint: the Oracle hash bootstrap goes through
 * the injectable OracleClient port and every other step rides the relay.
 */

import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createInMemoryRelayClient } from "@anchr/sdk/testing";
import {
  buildPreimageDeliveryEvent,
  type CashuClient,
  createCustomer,
  createProvider,
  generateKeypair,
  KIND_QUERY_REQUEST,
  KIND_QUERY_RESPONSE,
  parseQueryRequestEvent,
  ProofSchema,
  type RedeemHtlcParams,
  type RedeemResult,
  serveHashRequests,
} from "@anchr/sdk";

function makeStubCashuClient(): {
  client: CashuClient;
  redeems: RedeemHtlcParams[];
} {
  const redeems: RedeemHtlcParams[] = [];
  const client: CashuClient = {
    mintUrl: "https://mint.test.example",
    bindProvider: (params) =>
      Promise.resolve({
        token: "cashuB-bound",
        amountSats: params.amountSats,
        proofs: [],
      }),
    verifyProviderPaymentLock: () =>
      Promise.resolve({ proofs: [], amountSats: 100 }),
    redeemHtlc: (params): Promise<RedeemResult> => {
      redeems.push(params);
      return Promise.resolve({ proofs: [], amountSats: 100 });
    },
  };
  return { client, redeems };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const HASH_HEX = "01234567".repeat(8);
const PREIMAGE_HEX = "89abcdef".repeat(8);

test("INV-08: full exchange completes relay-only with no HTTP endpoint", async () => {
  // Prove "no HTTP" rather than relying on absence-of-wiring: any fetch
  // call during the exchange is counted and rejected, and the count must
  // stay zero.
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (
    input: URL | Request | string,
    _init?: RequestInit,
  ): Promise<Response> => {
    fetchCalls++;
    return Promise.reject(
      new Error(`INV-08 violation: fetch called with ${String(input)}`),
    );
  };

  try {
    const relayClient = createInMemoryRelayClient();
    const customerCashu = makeStubCashuClient();
    const providerCashu = makeStubCashuClient();
    const oracleKey = generateKeypair();
    const providerKey = generateKeypair();

    // In-process Oracle actor: answers hash bootstrap DMs, watches results on
    // the relay, and delivers the Release Material as a NIP-44 DM — never an
    // HTTP round trip.
    const hashResponder = serveHashRequests({
      relayClient,
      identity: oracleKey,
      issueHash: () => HASH_HEX,
    });
    const queryIdsByRequest = new Map<string, string>();
    relayClient.subscribe({ kinds: [KIND_QUERY_REQUEST] }, (event) => {
      const payload = parseQueryRequestEvent(event);
      if (payload !== null) queryIdsByRequest.set(event.id, payload.query_id);
    });
    relayClient.subscribe({ kinds: [KIND_QUERY_RESPONSE] }, (event) => {
      const requestId = event.tags.find((tag) => tag[0] === "e")?.[1];
      if (requestId === undefined) return;
      const queryId = queryIdsByRequest.get(requestId);
      if (queryId === undefined) return;
      const delivery = buildPreimageDeliveryEvent(oracleKey, event.pubkey, {
        query_id: queryId,
        request_event_id: requestId,
        preimage: PREIMAGE_HEX,
      });
      setTimeout(() => void relayClient.publish(delivery), 10);
    });

    const provider = createProvider({
      oracles: [oracleKey.publicKey],
      relays: ["mock://in-memory-relay"],
      mint: "https://mint.test.example",
      privKey: bytesToHex(providerKey.secretKey),
      cashuClient: providerCashu.client,
      relayClient,
      selectionTimeoutMs: 500,
      preimageTimeoutMs: 500,
    });
    const servePromise = provider.serve((request) =>
      Promise.resolve({
        amountSats: 100,
        produce: () =>
          Promise.resolve({
            data: { schema: request.spec.schema },
            proof: "anonymous-flow-proof-bytes",
          }),
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 5));

    const customer = createCustomer({
      // No oracle client injected: the default relay-DM hash bootstrap
      // (createNostrOracleClient) answers through the same in-memory relay.
      oracles: [{ pubkey: oracleKey.publicKey }],
      relays: ["mock://in-memory-relay"],
      mint: "https://mint.test.example",
      cashuClient: customerCashu.client,
      relayClient,
      offerWindowMs: 50,
      resultTimeoutMs: 500,
    });

    try {
      const result = await customer.request({
        spec: {
          schema: ProofSchema.TlsnV1,
          predicate: { target: "https://api.example.org/account" },
        },
        payment: { maxAmount: 1000 },
        fundingProofs: ["wallet-proof"],
      });

      expect(result.providerPubkey).toBe(providerKey.publicKey);
      expect(result.proof).toBe("anonymous-flow-proof-bytes");

      // Redeem consumed the relay-delivered Release Material.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(providerCashu.redeems.length).toBe(1);
      expect(providerCashu.redeems[0].preimageHex).toBe(PREIMAGE_HEX);
    } finally {
      await provider.stop();
      await servePromise;
      hashResponder.close();
      relayClient.close();
    }

    expect(fetchCalls).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
