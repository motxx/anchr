import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { runPaidRequestSimulation } from "./mod.ts";

test("paid request simulation completes a Customer to Provider request", async () => {
  const result = await runPaidRequestSimulation();

  expect(result.proof).toBe("simulation-proof-bytes");
  expect(result.customerLocks).toHaveLength(1);
  expect(result.customerBinds).toHaveLength(1);
  expect(result.providerRedeems[0]?.preimageHex).toBe("89abcdef".repeat(8));
});
