import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { detectRuntimeTarget, isDenoRuntime } from "./runtime.ts";

test("detectRuntimeTarget identifies the Deno test runtime", () => {
  expect(detectRuntimeTarget()).toBe("deno");
  expect(isDenoRuntime()).toBe(true);
});
