import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { generateKeypair } from "@anchr/protocol/nostr";
import { createInMemoryRelayClient } from "./testing/relay.ts";
import { serveHashRequests } from "./adapters/nostr/hash-responder.ts";
import { createNostrOracleClient, OracleTimeoutError } from "./oracle.ts";

const HASH_HEX = "ab".repeat(32);

test("relay-DM hash bootstrap round-trips through the responder", async () => {
  const relayClient = createInMemoryRelayClient();
  const oracle = generateKeypair();
  const issued: string[] = [];
  const responder = serveHashRequests({
    relayClient,
    identity: oracle,
    issueHash: (queryId) => {
      issued.push(queryId);
      return HASH_HEX;
    },
  });
  const client = createNostrOracleClient({
    relayClient,
    oraclePubkey: oracle.publicKey,
    timeoutMs: 1_000,
  });

  const first = await client.requestHash("q-1");
  expect(first.hash).toBe(HASH_HEX);

  const second = await client.requestHash("q-1");
  expect(second.hash).toBe(HASH_HEX);
  expect(issued).toEqual(["q-1"]);

  responder.close();
  relayClient.close();
});

test("relay-DM hash bootstrap times out without a responder", async () => {
  const relayClient = createInMemoryRelayClient();
  const oracle = generateKeypair();
  const client = createNostrOracleClient({
    relayClient,
    oraclePubkey: oracle.publicKey,
    timeoutMs: 50,
  });
  await expect(client.requestHash("q-2")).rejects.toThrow(OracleTimeoutError);
  relayClient.close();
});
