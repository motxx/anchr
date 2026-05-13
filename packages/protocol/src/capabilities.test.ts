import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  type AdapterManifest,
  checkCapabilities,
  missingCapabilities,
} from "./capabilities.ts";

const manifest: AdapterManifest = {
  id: "nostr-relay",
  technology: "nostr",
  capabilities: ["transport", "signer"],
  runtimes: ["browser", "deno", "node"],
  experimental: true,
};

test("missingCapabilities reports only unsupported capabilities", () => {
  expect(missingCapabilities(manifest, ["transport"])).toEqual([]);
  expect(missingCapabilities(manifest, ["transport", "payment"])).toEqual([
    "payment",
  ]);
});

test("checkCapabilities returns a conformance result", () => {
  expect(checkCapabilities(manifest, ["transport"])).toEqual({
    ok: true,
    missing: [],
  });
  expect(checkCapabilities(manifest, ["payment", "proof_verifier"])).toEqual({
    ok: false,
    missing: ["payment", "proof_verifier"],
  });
});
