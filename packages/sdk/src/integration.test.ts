/**
 * In-process wiring tests — co-execute Customer + Provider + a fake
 * oracle against a fully mocked transport (in-memory relay) and a fully
 * mocked Cashu mint (stubbed CashuClient). They verify that the SDK's
 * event builders/parsers and Customer/Provider state machines compose
 * correctly without touching any external infrastructure.
 *
 * What this file is NOT:
 *   - Not an end-to-end test against a real Nostr relay
 *   - Not an end-to-end test against a real Cashu mint
 *   - Not a verification that NUT-14 HTLC + NIP-44 actually work on the wire
 *
 * The real e2e coverage lives at `e2e/regtest/sdk-integration.test.ts`
 * (run via `deno task test:e2e:regtest`), which exercises this same flow
 * against the Docker-backed regtest Cashu mint and Nostr relay.
 */

import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { createCustomer } from "./customer.ts";
import { createProvider } from "./provider.ts";
import {
  buildPreimageDeliveryEvent,
  parseQueryRequestEvent,
} from "@anchr/protocol/events";
import { type Event, generateKeypair } from "@anchr/protocol/nostr";
import { serveHashRequests } from "./adapters/nostr/hash-responder.ts";
import type {
  CashuClient,
  CashuToken,
  Filter,
  PublishResult,
  RedeemHtlcParams,
  RedeemResult,
  RelayClient,
  Subscription,
} from "./adapters/types.ts";
import type { OracleClient } from "./oracle.ts";
import { bytesToHex } from "./test-helpers.ts";

// --- Mock relay ---

interface SubRecord {
  id: number;
  filter: Filter;
  onEvent: (event: Event) => void;
}

class MockRelay {
  private subs: SubRecord[] = [];
  private nextId = 1;

  subscribe(filter: Filter, onEvent: (event: Event) => void): Subscription {
    const id = this.nextId++;
    this.subs.push({ id, filter, onEvent });
    return {
      close: () => {
        this.subs = this.subs.filter((s) => s.id !== id);
      },
    };
  }

  async publish(event: Event): Promise<PublishResult> {
    for (const sub of [...this.subs]) {
      if (matchesFilter(event, sub.filter)) {
        // Deliver asynchronously so producers don't observe synchronous reentrancy.
        queueMicrotask(() => sub.onEvent(event));
      }
    }
    return { successes: ["mock://relay"], failures: [] };
  }

  close(): void {
    this.subs = [];
  }

  /** Adapt this MockRelay to the RelayClient interface. */
  asClient(): RelayClient {
    return {
      publish: (event: Event) => this.publish(event),
      subscribe: (filter: Filter, onEvent: (event: Event) => void) =>
        this.subscribe(filter, onEvent),
      close: () => this.close(),
    };
  }
}

function matchesFilter(event: Event, filter: Filter): boolean {
  if (filter.kinds !== undefined && !filter.kinds.includes(event.kind)) {
    return false;
  }
  if (filter.authors !== undefined && !filter.authors.includes(event.pubkey)) {
    return false;
  }
  for (const key of Object.keys(filter)) {
    if (!key.startsWith("#")) continue;
    const tagKey = key.slice(1);
    const expected = (filter as Record<string, string[] | undefined>)[key];
    if (!Array.isArray(expected)) continue;
    const tagValues = event.tags.filter((t) => t[0] === tagKey).map((t) =>
      t[1]
    );
    if (!expected.some((v) => tagValues.includes(v))) return false;
  }
  return true;
}

// --- Shared fixtures ---

const HASH_HEX = "deadbeef".repeat(8);
const PREIMAGE_HEX = "ffeeddcc".repeat(8);

function makeOracleClient(): OracleClient {
  return {
    requestHash: async (_queryId: string) => ({
      hash: HASH_HEX,
    }),
  };
}

function makeCashuClient(): CashuClient {
  return {
    mintUrl: "https://mint.example.org",
    bindProvider: async (p) => ({
      token: "cashuBbound",
      amountSats: p.amountSats,
      proofs: [],
    } satisfies CashuToken),
    verifyProviderPaymentLock: () =>
      Promise.resolve({ proofs: [], amountSats: 100 }),
    redeemHtlc: async (_p: RedeemHtlcParams): Promise<RedeemResult> => ({
      proofs: [],
      amountSats: 0,
    }),
  };
}

// --- End-to-end test ---

test("in-process wiring: customer.request returns the provider's data via a shared mock relay (no real mint, no real network)", async () => {
  const relay = new MockRelay();
  const oracleKey = generateKeypair();
  const customerCashuClient = makeCashuClient();
  const providerCashuClient = makeCashuClient();

  // Mock oracle: watches kind 6300 result events, then sends a NIP-44
  // preimage DM to the provider that authored the result. We fish the
  // request-event id and provider pubkey out of the kind 6300 event's
  // `e` tag (the request reference) and `pubkey` (the provider).
  // The original request payload (carrying query_id) was on kind 5300;
  // we also subscribe to those to remember query_ids by event id.
  const queryIdsByRequest: Map<string, string> = new Map();
  const hashResponder = serveHashRequests({
    relayClient: relay.asClient(),
    identity: oracleKey,
    issueHash: () => HASH_HEX,
  });
  relay.subscribe({ kinds: [5300] }, (event) => {
    const payload = parseQueryRequestEvent(event);
    if (payload !== null) queryIdsByRequest.set(event.id, payload.query_id);
  });
  relay.subscribe({ kinds: [6300] }, (event) => {
    const requestId = event.tags.find((t) => t[0] === "e")?.[1];
    if (requestId === undefined) return;
    const queryId = queryIdsByRequest.get(requestId);
    if (queryId === undefined) return;
    const dm = buildPreimageDeliveryEvent(oracleKey, event.pubkey, {
      query_id: queryId,
      request_event_id: requestId,
      preimage: PREIMAGE_HEX,
    });
    // Real oracles take time to verify the proof; here we delay just
    // enough that the provider has subscribed to kind 4 by the time
    // we publish the DM. (Without a delay, the DM is published before
    // waitForPreimage's subscribe call has run.)
    setTimeout(() => void relay.publish(dm), 10);
  });

  const providerKey = generateKeypair();

  const provider = createProvider({
    oracles: [oracleKey.publicKey],
    relays: ["mock://relay"],
    mint: "https://mint.example.org",
    privKey: bytesToHex(providerKey.secretKey),
    cashuClient: providerCashuClient,
    relayClient: relay.asClient(),
    selectionTimeoutMs: 500,
    preimageTimeoutMs: 500,
  });

  const servePromise = provider.serve(async (request) => {
    return {
      amountSats: 100,
      produce: async () => ({
        data: { schema: request.spec.schema, ok: true },
        proof: "tlsn-proof-bytes",
      }),
    };
  });

  // Give the provider's subscription a tick to register before the
  // customer publishes. Otherwise the kind 5300 event arrives before
  // the provider is listening.
  await new Promise((r) => setTimeout(r, 5));

  const customer = createCustomer({
    oracles: [{
      pubkey: oracleKey.publicKey,
      client: makeOracleClient(),
    }],
    relays: ["mock://relay"],
    mint: "https://mint.example.org",
    cashuClient: customerCashuClient,
    relayClient: relay.asClient(),
    offerWindowMs: 50,
    resultTimeoutMs: 500,
  });

  const result = await customer.request({
    spec: {
      schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
      predicate: { target: "https://api.example.org" },
    },
    payment: { maxAmount: 1000 },
    fundingProofs: [],
  });

  expect(result.providerPubkey).toBe(providerKey.publicKey);
  expect(result.schema).toBe("https://anchr-spec.org/spec/proof/tlsn/v1");
  expect(result.data).toEqual({
    schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
    ok: true,
  });
  expect(result.proof).toBe("tlsn-proof-bytes");

  // The customer returns as soon as kind 6300 arrives, but the
  // provider is still in the middle of waitForPreimage → redeemHtlc.
  // Wait a tick for the mock oracle's NIP-44 DM to land + the
  // provider's handleJob to complete before stopping (otherwise the
  // pending preimage timeout is reported as a leak).
  await new Promise((r) => setTimeout(r, 30));
  await provider.stop();
  await servePromise;
  hashResponder.close();
});
