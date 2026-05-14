import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { moduleDir } from "./env.ts";

test("moduleDir derives the directory from a file import URL without node:path", () => {
  expect(moduleDir({ url: "file:///tmp/anchr/example.ts" } as ImportMeta))
    .toBe("/tmp/anchr");
});
