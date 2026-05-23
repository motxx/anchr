import type { ActorStateStore } from "@anchr/protocol/adapters";

export type { ActorStateStore } from "@anchr/protocol/adapters";

export interface MemoryStateStoreOptions {
  initialEntries?: readonly (readonly [string, string])[];
}

export function createMemoryStateStore(
  options: MemoryStateStoreOptions = {},
): ActorStateStore {
  const values = new Map<string, string>(options.initialEntries);
  return {
    manifest: {
      id: "memory-state",
      technology: "memory",
      capabilities: ["local_state"],
      runtimes: ["browser", "deno", "node", "worker"],
      experimental: false,
    },
    get(key: string): Promise<string | null> {
      return Promise.resolve(values.get(key) ?? null);
    },
    set(key: string, value: string): Promise<void> {
      values.set(key, value);
      return Promise.resolve();
    },
    delete(key: string): Promise<void> {
      values.delete(key);
      return Promise.resolve();
    },
  };
}

export interface IndexedDbStateStoreOptions {
  databaseName?: string;
  storeName?: string;
  indexedDB?: IndexedDbFactoryLike;
}

export interface IndexedDbFactoryLike {
  open(name: string, version?: number): IndexedDbOpenRequestLike;
}

interface IndexedDbRequestLike<T> {
  readonly result: T;
  readonly error: DOMException | null;
  onsuccess: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
}

interface IndexedDbOpenRequestLike
  extends IndexedDbRequestLike<IndexedDbDatabaseLike> {
  onupgradeneeded: ((event: Event) => void) | null;
}

interface IndexedDbDatabaseLike {
  readonly objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string): unknown;
  transaction(
    storeName: string,
    mode: IDBTransactionMode,
  ): IndexedDbTransactionLike;
}

interface IndexedDbTransactionLike {
  readonly error: DOMException | null;
  onerror: ((event: Event) => void) | null;
  objectStore(name: string): IndexedDbObjectStoreLike;
}

interface IndexedDbObjectStoreLike {
  get(key: string): IndexedDbRequestLike<unknown>;
  put(value: string, key: string): IndexedDbRequestLike<unknown>;
  delete(key: string): IndexedDbRequestLike<unknown>;
}

export class IndexedDbStateStoreError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "IndexedDbStateStoreError";
  }
}

export function createIndexedDbStateStore(
  options: IndexedDbStateStoreOptions = {},
): ActorStateStore {
  const databaseName = options.databaseName ?? "anchr-sdk-state";
  const storeName = options.storeName ?? "actor-state";
  const factory = options.indexedDB ?? (
    globalThis.indexedDB === undefined
      ? undefined
      : browserIndexedDbFactory(globalThis.indexedDB)
  );
  if (factory === undefined) {
    throw new IndexedDbStateStoreError("IndexedDB is not available");
  }
  const database = openDatabase(factory, databaseName, storeName);

  return {
    manifest: {
      id: "indexeddb-state",
      technology: "indexeddb",
      capabilities: ["local_state"],
      runtimes: ["browser"],
      experimental: false,
    },
    async get(key: string): Promise<string | null> {
      const value = await runRequest(
        database,
        storeName,
        "readonly",
        (store) => store.get(key),
      );
      return typeof value === "string" ? value : null;
    },
    async set(key: string, value: string): Promise<void> {
      await runRequest(
        database,
        storeName,
        "readwrite",
        (store) => store.put(value, key),
      );
    },
    async delete(key: string): Promise<void> {
      await runRequest(
        database,
        storeName,
        "readwrite",
        (store) => store.delete(key),
      );
    },
  };
}

function browserIndexedDbFactory(factory: IDBFactory): IndexedDbFactoryLike {
  return {
    open(name: string, version?: number): IndexedDbOpenRequestLike {
      return new BrowserOpenRequest(factory.open(name, version));
    },
  };
}

class BrowserOpenRequest implements IndexedDbOpenRequestLike {
  constructor(private readonly request: IDBOpenDBRequest) {}

  get result(): IndexedDbDatabaseLike {
    return this.request.result;
  }

  get error(): DOMException | null {
    return this.request.error;
  }

  get onsuccess(): ((event: Event) => void) | null {
    return null;
  }

  set onsuccess(handler: ((event: Event) => void) | null) {
    this.request.onsuccess = handler === null
      ? null
      : (event) => handler(event);
  }

  get onerror(): ((event: Event) => void) | null {
    return null;
  }

  set onerror(handler: ((event: Event) => void) | null) {
    this.request.onerror = handler === null ? null : (event) => handler(event);
  }

  get onupgradeneeded(): ((event: Event) => void) | null {
    return null;
  }

  set onupgradeneeded(handler: ((event: Event) => void) | null) {
    this.request.onupgradeneeded = handler === null
      ? null
      : (event) => handler(event);
  }
}

function openDatabase(
  factory: IndexedDbFactoryLike,
  databaseName: string,
  storeName: string,
): Promise<IndexedDbDatabaseLike> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new IndexedDbStateStoreError(
          `Failed to open IndexedDB database ${databaseName}`,
          request.error ?? undefined,
        ),
      );
  });
}

function runRequest<T>(
  databasePromise: Promise<IndexedDbDatabaseLike>,
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IndexedDbObjectStoreLike) => IndexedDbRequestLike<T>,
): Promise<T> {
  return databasePromise.then((database) =>
    new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new IndexedDbStateStoreError(
            `IndexedDB ${mode} request failed for store ${storeName}`,
            request.error ?? undefined,
          ),
        );
      transaction.onerror = () =>
        reject(
          new IndexedDbStateStoreError(
            `IndexedDB transaction failed for store ${storeName}`,
            transaction.error ?? undefined,
          ),
        );
    })
  );
}
