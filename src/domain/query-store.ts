import type { Query } from "./types";

// --- QueryStore interface ---

export interface QueryStore {
  get(id: string): Query | null;
  set(id: string, query: Query): void;
  values(): Query[];
  delete(id: string): void;
  clear(): void;
}

export function createQueryStore(): QueryStore {
  const queries = new Map<string, Query>();
  return {
    get: (id) => queries.get(id) ?? null,
    set: (id, query) => { queries.set(id, query); },
    values: () => Array.from(queries.values()),
    delete: (id) => { queries.delete(id); },
    clear: () => { queries.clear(); },
  };
}
