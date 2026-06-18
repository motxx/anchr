import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { runPaidRequestSimulation } from "./paid-request-simulation/mod.ts";

test("public SDK API dogfood: customer, provider, oracle, payment, proof, attachment, and adapters compose locally", async () => {
  const result = await runPaidRequestSimulation();

  expect(result.proof).toBe("simulation-proof-bytes");
  expect(result.data).toEqual({
    schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
    attachment: {
      id: "photo.jpg",
      uri: "https://example.org/evidence/photo.jpg",
      filename: "photo.jpg",
      mime_type: "image/jpeg",
      storage_kind: "external",
    },
  });
  expect(result.customerBinds).toEqual([{
    amountSats: 100,
    providerPubkey: result.providerPubkey,
    hashHex: "01234567".repeat(8),
    sourceProofCount: 1,
  }]);
  expect(result.providerRedeems).toHaveLength(1);
  expect(result.providerRedeems[0]?.preimageHex).toBe("89abcdef".repeat(8));
});
