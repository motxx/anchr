import { expect } from "@std/expect";
import { test } from "@std/testing/bdd";
import { diffWorkspace, loadFromRepo } from "./lint-dockerfile-workspace.ts";

test("flags workspace member missing from Dockerfile", () => {
  const dockerfile = [
    "COPY packages/foo/deno.json ./packages/foo/",
    "RUN deno install",
  ].join("\n");
  const diff = diffWorkspace(
    ["./packages/foo", "./packages/bar"],
    dockerfile,
  );
  expect(diff).toEqual({ missing: ["packages/bar"], extra: [] });
});

test("flags Dockerfile COPY for non-workspace member", () => {
  const dockerfile = [
    "COPY packages/foo/deno.json ./packages/foo/",
    "COPY packages/gone/deno.json ./packages/gone/",
  ].join("\n");
  const diff = diffWorkspace(["./packages/foo"], dockerfile);
  expect(diff).toEqual({ missing: [], extra: ["packages/gone"] });
});

test("clean when workspace and Dockerfile match", () => {
  const dockerfile = [
    "COPY packages/foo/deno.json ./packages/foo/",
    "COPY example/bar/deno.json ./example/bar/",
  ].join("\n");
  const diff = diffWorkspace(
    ["./packages/foo", "./example/bar"],
    dockerfile,
  );
  expect(diff).toEqual({ missing: [], extra: [] });
});

test("ignores COPY whose source and destination paths differ", () => {
  const dockerfile = "COPY packages/foo/deno.json /elsewhere/";
  const diff = diffWorkspace(["./packages/foo"], dockerfile);
  expect(diff.missing).toEqual(["packages/foo"]);
});

test("repository scan is clean", async () => {
  const diff = await loadFromRepo();
  expect(diff).toEqual({ missing: [], extra: [] });
});
