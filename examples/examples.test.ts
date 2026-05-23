import { walk } from "jsr:@std/fs@^1/walk";
import { relative } from "jsr:@std/path@^1";
import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

const ROOT = new URL("../", import.meta.url).pathname;
const EXAMPLES_ROOT = new URL("./", import.meta.url).pathname;
const FORBIDDEN_ANCHR_IMPORT =
  /(?:from\s+["']|import\s*\(\s*["'])@anchr\/(?!sdk(?:\/|["'])|protocol(?:\/|["']))/;

test("examples import only public SDK or protocol Anchr packages", async () => {
  const violations: string[] = [];

  for await (
    const entry of walk(EXAMPLES_ROOT, {
      exts: [".ts", ".tsx"],
      skip: [/\.test\.tsx?$/],
    })
  ) {
    const source = await Deno.readTextFile(entry.path);
    if (FORBIDDEN_ANCHR_IMPORT.test(source)) {
      violations.push(relative(ROOT, entry.path));
    }
  }

  expect(violations).toEqual([]);
});
