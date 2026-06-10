import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createInMemoryRelayClient } from "@anchr/sdk/testing";
import { QuickStartError, runQuickStart } from "./mod.ts";

test("quick start round-trips an advertisement through the relay", async () => {
  const relayClient = createInMemoryRelayClient();
  const result = await runQuickStart(relayClient, { timeoutMs: 1_000 });
  expect(result.echoed.query_id).toBe(result.queryId);
  expect(result.echoed.max_amount_sats).toBe(21);
  expect(result.acceptedBy.length).toBe(1);
  relayClient.close();
});

test("quick start fails loudly when the relay never echoes", async () => {
  const relayClient = createInMemoryRelayClient();
  const silent = {
    publish: relayClient.publish.bind(relayClient),
    subscribe: () => ({ close: () => {} }),
    close: () => {},
  };
  await expect(runQuickStart(silent, { timeoutMs: 50 })).rejects.toThrow(
    QuickStartError,
  );
});
