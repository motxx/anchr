import { test, describe, beforeEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createQueryStore, type QueryStore } from "./query-store";
import type { Query } from "./types";

function fakeQuery(id: string): Query {
  return {
    id,
    status: "pending",
    description: `Query ${id}`,
    verification_requirements: ["exif"],
    created_at: Date.now(),
    expires_at: Date.now() + 600_000,
    payment_status: "none",
  } as Query;
}

describe("QueryStore", () => {
  let store: QueryStore;

  beforeEach(() => {
    store = createQueryStore();
  });

  test("get returns null for nonexistent key", () => {
    expect(store.get("missing")).toBeNull();
  });

  test("set and get round-trip", () => {
    const q = fakeQuery("q1");
    store.set("q1", q);
    expect(store.get("q1")).toBe(q);
  });

  test("values returns all stored queries", () => {
    store.set("q1", fakeQuery("q1"));
    store.set("q2", fakeQuery("q2"));
    const vals = store.values();
    expect(vals.length).toBe(2);
    expect(vals.map((q) => q.id).sort()).toEqual(["q1", "q2"]);
  });

  test("delete removes a query", () => {
    store.set("q1", fakeQuery("q1"));
    store.delete("q1");
    expect(store.get("q1")).toBeNull();
    expect(store.values().length).toBe(0);
  });

  test("clear removes all queries", () => {
    store.set("q1", fakeQuery("q1"));
    store.set("q2", fakeQuery("q2"));
    store.clear();
    expect(store.values().length).toBe(0);
  });

  test("set overwrites existing query", () => {
    store.set("q1", fakeQuery("q1"));
    const updated = { ...fakeQuery("q1"), description: "Updated" };
    store.set("q1", updated);
    expect(store.get("q1")!.description).toBe("Updated");
    expect(store.values().length).toBe(1);
  });
});
