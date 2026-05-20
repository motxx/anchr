import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  createIndexedDbStateStore,
  createMemoryStateStore,
  type IndexedDbFactoryLike,
  IndexedDbStateStoreError,
} from "./storage.ts";

test("createMemoryStateStore reads, writes, and deletes string state", async () => {
  const store = createMemoryStateStore();
  await store.set("customer:q1", '{"status":"request_published"}');
  expect(await store.get("customer:q1")).toBe(
    '{"status":"request_published"}',
  );
  await store.delete("customer:q1");
  expect(await store.get("customer:q1")).toBe(null);
});

test("createMemoryStateStore exposes local-state capability metadata", () => {
  const store = createMemoryStateStore();
  expect(store.manifest).toEqual({
    id: "memory-state",
    technology: "memory",
    capabilities: ["local_state"],
    runtimes: ["browser", "deno", "node", "worker"],
    experimental: false,
  });
});

test("createIndexedDbStateStore rejects runtimes without IndexedDB", () => {
  expect(() => createIndexedDbStateStore({ indexedDB: undefined }))
    .toThrow(IndexedDbStateStoreError);
});

test("createIndexedDbStateStore persists state through an injected IndexedDB factory", async () => {
  const fake = new FakeIndexedDb();
  const store = createIndexedDbStateStore({
    indexedDB: fake.factory(),
    databaseName: "anchr-test",
    storeName: "state",
  });

  await store.set("customer:q2", '{"status":"result_received"}');
  expect(await store.get("customer:q2")).toBe('{"status":"result_received"}');
  await store.delete("customer:q2");
  expect(await store.get("customer:q2")).toBe(null);
});

class FakeIndexedDb {
  private readonly values = new Map<string, string>();

  factory(): IndexedDbFactoryLike {
    const values = this.values;
    return {
      open: () => {
        const database = new FakeDatabase(values);
        const request = new FakeOpenRequest(database);
        queueMicrotask(() => request.succeedWithUpgrade());
        return request;
      },
    };
  }
}

class FakeOpenRequest {
  onupgradeneeded: ((event: Event) => void) | null = null;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly error: DOMException | null = null;

  constructor(readonly result: FakeDatabase) {}

  succeedWithUpgrade(): void {
    this.onupgradeneeded?.(new Event("upgradeneeded"));
    this.onsuccess?.(new Event("success"));
  }
}

class FakeRequest<T> {
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly error: DOMException | null = null;

  constructor(readonly result: T) {}

  succeed(): void {
    queueMicrotask(() => {
      this.onsuccess?.(new Event("success"));
    });
  }
}

class FakeDatabase {
  readonly objectStoreNames = {
    contains: (_name: string): boolean => true,
  };

  constructor(private readonly values: Map<string, string>) {}

  createObjectStore(_name: string): unknown {
    return makeObjectStore(this.values);
  }

  transaction(_storeName: string, _mode?: IDBTransactionMode) {
    const values = this.values;
    return {
      error: null,
      onerror: null,
      objectStore: () => makeObjectStore(values),
    };
  }
}

function makeObjectStore(values: Map<string, string>) {
  return {
    get: (key: string) => {
      const request = new FakeRequest(values.get(key));
      request.succeed();
      return request;
    },
    put: (value: string, key: string) => {
      values.set(key, value);
      const request = new FakeRequest(key);
      request.succeed();
      return request;
    },
    delete: (key: string) => {
      values.delete(key);
      const request = new FakeRequest(undefined);
      request.succeed();
      return request;
    },
  };
}
