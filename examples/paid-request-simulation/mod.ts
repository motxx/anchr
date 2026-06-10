import {
  buildPreimageDeliveryEvent,
  type CashuClient,
  createCustomer,
  createProvider,
  type Filter,
  generateKeypair,
  KIND_QUERY_REQUEST,
  KIND_QUERY_RESPONSE,
  parseQueryRequestEvent,
  ProofSchema,
  type PublishResult,
  type RedeemHtlcParams,
  type RedeemResult,
  type RelayClient,
  type Subscription,
} from "@anchr/sdk";
import {
  materializeAttachmentRef,
  validateAttachmentUri,
} from "@anchr/sdk/attachments";
import { createInMemoryRelayClient } from "@anchr/sdk/testing";

type RelayEvent = Parameters<RelayClient["publish"]>[0];

function makeCashuClient(mintUrl: string): {
  client: CashuClient;
  locks: BuildHtlcLockCall[];
  binds: BindProviderCall[];
  redeems: RedeemHtlcParams[];
} {
  const locks: BuildHtlcLockCall[] = [];
  const binds: BindProviderCall[] = [];
  const redeems: RedeemHtlcParams[] = [];
  const client: CashuClient = {
    mintUrl,
    buildHtlcLock(params) {
      locks.push({
        amountSats: params.amountSats,
        hashHex: params.hashHex,
        sourceProofCount: params.sourceProofs.length,
      });
      return Promise.resolve({
        token: "cashu-simulation-initial",
        amountSats: params.amountSats,
        proofs: params.sourceProofs,
      });
    },
    bindProvider(params) {
      binds.push({
        providerPubkey: params.providerPubkey,
        hashHex: params.hashHex,
        initialProofCount: params.initialProofs.length,
      });
      return Promise.resolve({
        token: "cashu-simulation-bound",
        amountSats: 100,
        proofs: params.initialProofs,
      });
    },
    redeemHtlc(params): Promise<RedeemResult> {
      redeems.push(params);
      return Promise.resolve({ proofs: [], amountSats: 100 });
    },
  };
  return { client, locks, binds, redeems };
}

export interface BuildHtlcLockCall {
  amountSats: number;
  hashHex: string;
  sourceProofCount: number;
}

export interface BindProviderCall {
  providerPubkey: string;
  hashHex: string;
  initialProofCount: number;
}

export interface PaidRequestSimulationResult {
  providerPubkey: string;
  proof: string;
  data: unknown;
  customerLocks: readonly BuildHtlcLockCall[];
  customerBinds: readonly BindProviderCall[];
  providerRedeems: readonly RedeemHtlcParams[];
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const HASH_HEX = "01234567".repeat(8);
const PREIMAGE_HEX = "89abcdef".repeat(8);

export async function runPaidRequestSimulation(): Promise<
  PaidRequestSimulationResult
> {
  const relayClient = createInMemoryRelayClient({
    relayUrl: "mock://paid-request-simulation",
  });
  const customerCashu = makeCashuClient("https://mint.test.example");
  const providerCashu = makeCashuClient("https://mint.test.example");
  const oracleKey = generateKeypair();
  const providerKey = generateKeypair();
  const attachment = materializeAttachmentRef(
    "https://example.org/evidence/photo.jpg",
  );
  const attachmentError = validateAttachmentUri(attachment.uri);

  if (attachmentError !== null) {
    throw new Error(attachmentError);
  }

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
    relays: ["mock://paid-request-simulation"],
    mint: "https://mint.test.example",
    privKey: bytesToHex(providerKey.secretKey),
    cashuClient: providerCashu.client,
    relayClient,
    selectionTimeoutMs: 500,
    preimageTimeoutMs: 500,
  });
  const servePromise = provider.serve(async (request) => ({
    amountSats: 100,
    produce: async () => ({
      data: {
        schema: request.spec.schema,
        attachment,
      },
      proof: "simulation-proof-bytes",
    }),
  }));

  await new Promise((resolve) => setTimeout(resolve, 5));

  const customer = createCustomer({
    oracles: [{
      pubkey: oracleKey.publicKey,
      client: {
        requestHash: () => Promise.resolve({ hash: HASH_HEX }),
      },
    }],
    relays: ["mock://paid-request-simulation"],
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
      sourceProofs: ["wallet-proof"],
    });
    if (typeof result.proof !== "string") {
      throw new Error("simulation expected string proof bytes");
    }
    await new Promise((resolve) => setTimeout(resolve, 30));

    return {
      providerPubkey: result.providerPubkey,
      proof: result.proof,
      data: result.data,
      customerLocks: customerCashu.locks,
      customerBinds: customerCashu.binds,
      providerRedeems: providerCashu.redeems,
    };
  } finally {
    await provider.stop();
    await servePromise;
    relayClient.close();
  }
}
