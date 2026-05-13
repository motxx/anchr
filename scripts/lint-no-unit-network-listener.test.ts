import { expect } from "@std/expect";
import { test } from "@std/testing/bdd";
import { scanRepo, scanText } from "./lint-no-unit-network-listener.ts";

test("catches Deno.serve in unit tests", () => {
  const hits = scanText(
    `const server = Deno.serve({ port: 1234 }, app.fetch);`,
    "packages/example/src/server.test.ts",
  );
  expect(hits).toEqual([
    {
      file: "packages/example/src/server.test.ts",
      line: 1,
      text: `const server = Deno.serve({ port: 1234 }, app.fetch);`,
      api: "Deno.serve",
    },
  ]);
});

test("catches Deno.listen in unit tests", () => {
  const hits = scanText(
    `const listener = Deno.listen({ port: 1234 });`,
    "packages/example/src/socket.test.ts",
  );
  expect(hits.map((hit) => hit.api)).toEqual(["Deno.listen"]);
});

test("allows in-process request helpers", () => {
  const hits = scanText(
    `const res = await app.request("/health");`,
    "packages/example/src/server.test.ts",
  );
  expect(hits).toEqual([]);
});

test("repository scan is clean", async () => {
  const hits = await scanRepo();
  expect(hits).toEqual([]);
});
