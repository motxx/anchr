import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  type AdapterManifest,
  buildPreimageDeliveryEvent,
  type CashuClient,
  checkCapabilities,
  createCustomer,
  createProvider,
  type Filter,
  generateKeypair,
  KIND_QUERY_REQUEST,
  KIND_QUERY_RESPONSE,
  parseQueryRequestEvent,
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

type RelayEvent = Parameters<RelayClient["publish"]>[0];

interface SubRecord {
  id: number;
  filter: Filter;
  onEvent: (event: RelayEvent) => void;
}

class InMemoryRelay {
  private subscriptions: SubRecord[] = [];
  private nextId = 1;

  readonly manifest: AdapterManifest = {
    id: "dogfood-in-memory-relay",
    technology: "in-memory",
    capabilities: ["transport"],
    runtimes: ["deno"],
    experimental: false,
  };

  subscribe(
    filter: Filter,
    onEvent: (event: RelayEvent) => void,
  ): Subscription {
    const id = this.nextId;
    this.nextId += 1;
    this.subscriptions.push({ id, filter, onEvent });
    return {
      close: () => {
        this.subscriptions = this.subscriptions.filter((sub) => sub.id !== id);
      },
    };
  }

  async publish(event: RelayEvent): Promise<PublishResult> {
    for (const sub of this.subscriptions) {
      if (matchesFilter(event, sub.filter)) {
        queueMicrotask(() => sub.onEvent(event));
      }
    }
    return { successes: ["mock://dogfood-relay"], failures: [] };
  }

  close(): void {
    this.subscriptions = [];
  }

  asClient(): RelayClient {
    return {
      manifest: this.manifest,
      publish: (event) => this.publish(event),
      subscribe: (filter, onEvent) => this.subscribe(filter, onEvent),
      close: () => this.close(),
    };
  }
}

function matchesFilter(event: RelayEvent, filter: Filter): boolean {
  if (filter.kinds !== undefined && !filter.kinds.includes(event.kind)) {
    return false;
  }
  if (filter.authors !== undefined && !filter.authors.includes(event.pubkey)) {
    return false;
  }
  for (const { tag, values } of tagFilters(filter)) {
    const eventValues = event.tags.filter((entry) => entry[0] === tag).map((
      entry,
    ) => entry[1]);
    if (!values.some((value) => eventValues.includes(value))) return false;
  }
  return true;
}

function tagFilters(filter: Filter): { tag: string; values: string[] }[] {
  const filters: { tag: string; values: string[] }[] = [];
  for (const [key, value] of Object.entries(filter)) {
    if (!key.startsWith("#")) continue;
    if (!isStringArray(value)) continue;
    filters.push({ tag: key.slice(1), values: value });
  }
  return filters;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string");
}

function makeCashuClient(mintUrl: string): {
  client: CashuClient;
  locks: BuildHtlcLockCall[];
  binds: BindProviderCall[];
  redeems: RedeemHtlcParams[];
} {
  const locks: BuildHtlcLockCall[] = [];
  const binds: BindProviderCall[] = [];
  const redeems: RedeemHtlcParams[] = [];
  const manifest: AdapterManifest = {
    id: "dogfood-cashu",
    technology: "cashu-stub",
    capabilities: ["payment"],
    runtimes: ["deno"],
    experimental: false,
  };
  const client: CashuClient = {
    manifest,
    mintUrl,
    buildHtlcLock(params) {
      locks.push({
        amountSats: params.amountSats,
        hashHex: params.hashHex,
        sourceProofCount: params.sourceProofs.length,
      });
      return Promise.resolve({
        token: "cashu-dogfood-initial",
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
        token: "cashu-dogfood-bound",
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

interface BuildHtlcLockCall {
  amountSats: number;
  hashHex: string;
  sourceProofCount: number;
}

interface BindProviderCall {
  providerPubkey: string;
  hashHex: string;
  initialProofCount: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const HASH_HEX = "01234567".repeat(8);
const PREIMAGE_HEX = "89abcdef".repeat(8);

test("public SDK API dogfood: customer, provider, oracle, payment, proof, attachment, and adapters compose locally", async () => {
  const relay = new InMemoryRelay();
  const relayClient = relay.asClient();
  const customerCashu = makeCashuClient("https://mint.test.example");
  const providerCashu = makeCashuClient("https://mint.test.example");
  const customerCashuManifest = customerCashu.client.manifest;
  const oracleKey = generateKeypair();
  const providerKey = generateKeypair();
  const attachment = materializeAttachmentRef(
    "https://example.org/evidence/photo.jpg",
  );

  expect(checkCapabilities(relay.manifest, ["transport"])).toEqual({
    ok: true,
    missing: [],
  });
  if (customerCashuManifest === undefined) {
    throw new Error("dogfood cashu adapter must expose a manifest");
  }
  expect(checkCapabilities(customerCashuManifest, ["payment"]))
    .toEqual({ ok: true, missing: [] });
  expect(validateAttachmentUri(attachment.uri)).toBeNull();

  const queryIdsByRequest = new Map<string, string>();
  relay.subscribe({ kinds: [KIND_QUERY_REQUEST] }, (event) => {
    const payload = parseQueryRequestEvent(event);
    if (payload !== null) queryIdsByRequest.set(event.id, payload.query_id);
  });
  relay.subscribe({ kinds: [KIND_QUERY_RESPONSE] }, (event) => {
    const requestId = event.tags.find((tag) => tag[0] === "e")?.[1];
    if (requestId === undefined) return;
    const queryId = queryIdsByRequest.get(requestId);
    if (queryId === undefined) return;
    const delivery = buildPreimageDeliveryEvent(oracleKey, event.pubkey, {
      query_id: queryId,
      request_event_id: requestId,
      preimage: PREIMAGE_HEX,
    });
    setTimeout(() => void relay.publish(delivery), 10);
  });

  const provider = createProvider({
    oracles: [oracleKey.publicKey],
    relays: ["mock://dogfood-relay"],
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
      proof: "dogfood-proof-bytes",
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
    relays: ["mock://dogfood-relay"],
    mint: "https://mint.test.example",
    cashuClient: customerCashu.client,
    relayClient,
    offerWindowMs: 50,
    resultTimeoutMs: 500,
  });

  try {
    const result = await customer.request({
      spec: {
        schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
        predicate: { target: "https://api.example.org/account" },
      },
      payment: { maxAmount: 1000 },
      sourceProofs: ["wallet-proof"],
    });

    expect(result.providerPubkey).toBe(providerKey.publicKey);
    expect(result.proof).toBe("dogfood-proof-bytes");
    expect(result.data).toEqual({
      schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
      attachment,
    });
    expect(customerCashu.locks).toEqual([{
      amountSats: 1000,
      hashHex: HASH_HEX,
      sourceProofCount: 1,
    }]);
    expect(customerCashu.binds).toEqual([{
      providerPubkey: providerKey.publicKey,
      hashHex: HASH_HEX,
      initialProofCount: 1,
    }]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(providerCashu.redeems).toHaveLength(1);
    expect(providerCashu.redeems[0]?.preimageHex).toBe(PREIMAGE_HEX);
  } finally {
    await provider.stop();
    await servePromise;
    relay.close();
  }
});
