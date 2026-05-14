import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { createMemoryStateStore } from "./storage.ts";

test("createMemoryStateStore reads, writes, and deletes provider state", async () => {
  const store = createMemoryStateStore({
    initialEntries: [["provider:req1", '{"status":"quote_published"}']],
  });
  expect(await store.get("provider:req1")).toBe(
    '{"status":"quote_published"}',
  );
  await store.set("provider:req1", '{"status":"redeemed"}');
  expect(await store.get("provider:req1")).toBe('{"status":"redeemed"}');
  await store.delete("provider:req1");
  expect(await store.get("provider:req1")).toBe(null);
});
