import { test, expect, describe, beforeEach } from "bun:test";
import { createInMemoryQueryRepository, toRepository } from "./query-repository";
import { createQueryStore } from "./query-store";
import type { Query } from "./types";
import type { QueryRepository } from "./query-repository";

function makeQuery(overrides?: Partial<Query>): Query {
  return {
    id: `q_${Math.random().toString(36).slice(2)}`,
    status: "pending",
    description: "Test",
    verification_requirements: ["gps", "ai_check"],
    created_at: Date.now(),
    expires_at: Date.now() + 600_000,
    payment_status: "locked",
    ...overrides,
  };
}

function runRepositoryTests(name: string, factory: () => QueryRepository) {
  describe(name, () => {
    let repo: QueryRepository;

    beforeEach(() => {
      repo = factory();
    });

    // CRUD
    test("get returns null for missing id", () => {
      expect(repo.get("nonexistent")).toBeNull();
    });

    test("save + get roundtrip", () => {
      const q = makeQuery({ id: "q1" });
      repo.save(q);
      expect(repo.get("q1")).toEqual(q);
    });

    test("save overwrites existing", () => {
      const q1 = makeQuery({ id: "q1", description: "v1" });
      repo.save(q1);
      const q2 = { ...q1, description: "v2" };
      repo.save(q2);
      expect(repo.get("q1")?.description).toBe("v2");
    });

    test("delete removes query", () => {
      const q = makeQuery({ id: "q1" });
      repo.save(q);
      repo.delete("q1");
      expect(repo.get("q1")).toBeNull();
    });

    test("delete non-existent is no-op", () => {
      repo.delete("nonexistent"); // should not throw
    });

    test("clear removes all", () => {
      repo.save(makeQuery({ id: "q1" }));
      repo.save(makeQuery({ id: "q2" }));
      repo.clear();
      expect(repo.findAll().length).toBe(0);
    });

    // findOpen
    test("findOpen returns open non-expired queries", () => {
      const now = Date.now();
      repo.save(makeQuery({ id: "q1", status: "pending", expires_at: now + 10000 }));
      repo.save(makeQuery({ id: "q2", status: "approved", expires_at: now + 10000 }));
      repo.save(makeQuery({ id: "q3", status: "pending", expires_at: now - 1000 })); // expired
      repo.save(makeQuery({ id: "q4", status: "awaiting_quotes", expires_at: now + 10000 }));
      repo.save(makeQuery({ id: "q5", status: "processing", expires_at: now + 10000 }));
      repo.save(makeQuery({ id: "q6", status: "rejected", expires_at: now + 10000 }));

      const open = repo.findOpen(now);
      const ids = open.map((q) => q.id).sort();
      expect(ids).toEqual(["q1", "q4", "q5"]);
    });

    // findExpirable
    test("findExpirable returns only expirable and past-deadline queries", () => {
      const now = Date.now();
      repo.save(makeQuery({ id: "q1", status: "pending", expires_at: now - 1000 }));
      repo.save(makeQuery({ id: "q2", status: "pending", expires_at: now + 10000 })); // not expired
      repo.save(makeQuery({ id: "q3", status: "approved", expires_at: now - 1000 })); // not expirable
      repo.save(makeQuery({ id: "q4", status: "awaiting_quotes", expires_at: now - 500 }));

      const expirable = repo.findExpirable(now);
      const ids = expirable.map((q) => q.id).sort();
      expect(ids).toEqual(["q1", "q4"]);
    });

    // findByStatus
    test("findByStatus returns only matching status", () => {
      repo.save(makeQuery({ id: "q1", status: "pending" }));
      repo.save(makeQuery({ id: "q2", status: "approved" }));
      repo.save(makeQuery({ id: "q3", status: "pending" }));

      const pending = repo.findByStatus("pending");
      expect(pending.length).toBe(2);
      expect(pending.every((q) => q.status === "pending")).toBe(true);
    });

    test("findByStatus returns empty for no matches", () => {
      repo.save(makeQuery({ id: "q1", status: "pending" }));
      expect(repo.findByStatus("expired").length).toBe(0);
    });

    // findAll
    test("findAll returns sorted by created_at desc", () => {
      repo.save(makeQuery({ id: "q1", created_at: 1000 }));
      repo.save(makeQuery({ id: "q2", created_at: 3000 }));
      repo.save(makeQuery({ id: "q3", created_at: 2000 }));

      const all = repo.findAll();
      expect(all.map((q) => q.id)).toEqual(["q2", "q3", "q1"]);
    });

    // Instance independence
    test("separate instances are independent", () => {
      const repo2 = factory();
      repo.save(makeQuery({ id: "q1" }));
      expect(repo2.get("q1")).toBeNull();
    });
  });
}

runRepositoryTests("createInMemoryQueryRepository", createInMemoryQueryRepository);

runRepositoryTests("toRepository(QueryStore)", () => {
  const store = createQueryStore();
  return toRepository(store);
});
