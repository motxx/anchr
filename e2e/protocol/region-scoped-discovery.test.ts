/**
 * Region-scoped discovery on the canonical advertisement: a Provider with a
 * region code serves only `#region`-matching requests (P4 in
 * docs/lifecycle-unification-design.md).
 */

import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createInMemoryRelayClient } from "@anchr/sdk/testing";
import {
  type CashuClient,
  createCustomer,
  createProvider,
  generateKeypair,
  ProofSchema,
  type RedeemResult,
} from "@anchr/sdk";

function stubCashuClient(): CashuClient {
  return {
    mintUrl: "https://mint.test.example",
    buildHtlcLock: (params) =>
      Promise.resolve({
        token: "cashuB-initial",
        amountSats: params.amountSats,
        proofs: params.sourceProofs,
      }),
    bindProvider: (params) =>
      Promise.resolve({
        token: "cashuB-bound",
        amountSats: 100,
        proofs: params.initialProofs,
      }),
    redeemHtlc: (): Promise<RedeemResult> =>
      Promise.resolve({ proofs: [], amountSats: 100 }),
  };
}

const HASH_HEX = "01234567".repeat(8);
const CUSTOM_SCHEMA = "https://example.org/spec/proof/out-of-region/v1";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

test("a region-scoped Provider only serves region-matching advertisements", async () => {
  const relayClient = createInMemoryRelayClient();
  const oracleKey = generateKeypair();
  const providerKey = generateKeypair();
  const servedSchemas: string[] = [];

  const provider = createProvider({
    oracles: [oracleKey.publicKey],
    relays: ["mock://in-memory-relay"],
    mint: "https://mint.test.example",
    privKey: bytesToHex(providerKey.secretKey),
    cashuClient: stubCashuClient(),
    relayClient,
    regionCode: "jp",
    selectionTimeoutMs: 100,
    preimageTimeoutMs: 100,
  });
  const servePromise = provider.serve((request) => {
    servedSchemas.push(request.spec.schema);
    return Promise.resolve({
      amountSats: 100,
      produce: () =>
        Promise.resolve({ data: { ok: true }, proof: "region-proof" }),
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 5));

  const makeCustomer = () =>
    createCustomer({
      oracles: [{
        pubkey: oracleKey.publicKey,
        client: { requestHash: () => Promise.resolve({ hash: HASH_HEX }) },
      }],
      relays: ["mock://in-memory-relay"],
      mint: "https://mint.test.example",
      cashuClient: stubCashuClient(),
      relayClient,
      offerWindowMs: 50,
      resultTimeoutMs: 300,
    });

  try {
    // Out-of-region (untagged) advertisement: the Provider never sees it.
    await expect(
      makeCustomer().request({
        spec: { schema: CUSTOM_SCHEMA, predicate: {} },
        payment: { maxAmount: 1000 },
        sourceProofs: [],
      }),
    ).rejects.toThrow();
    expect(servedSchemas).toEqual([]);

    // Region-tagged advertisement reaches the Provider and completes.
    const result = await makeCustomer().request({
      spec: { schema: ProofSchema.TlsnV1, predicate: {} },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
      regionCode: "JP",
    });
    expect(result.proof).toBe("region-proof");
    expect(servedSchemas).toEqual([ProofSchema.TlsnV1]);
  } finally {
    await provider.stop();
    await servePromise;
    relayClient.close();
  }
});
