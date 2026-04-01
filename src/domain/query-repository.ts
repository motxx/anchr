import type { Query, QueryStatus } from "./types";
import { isExpirable } from "./query-transitions";
import type { QueryStore } from "./query-store";

export interface QueryRepository {
  get(id: string): Query | null;
  save(query: Query): void;
  delete(id: string): void;
  clear(): void;

  findOpen(now: number): Query[];
  findAll(): Query[];
  findExpirable(now: number): Query[];
  findByStatus(status: QueryStatus): Query[];
}

export function createInMemoryQueryRepository(): QueryRepository {
  const queries = new Map<string, Query>();

  return {
    get(id) {
      return queries.get(id) ?? null;
    },
    save(query) {
      queries.set(query.id, query);
    },
    delete(id) {
      queries.delete(id);
    },
    clear() {
      queries.clear();
    },
    findOpen(now) {
      const openStatuses: QueryStatus[] = ["pending", "awaiting_quotes", "worker_selected", "processing"];
      return Array.from(queries.values()).filter(
        (q) => openStatuses.includes(q.status) && q.expires_at > now,
      );
    },
    findAll() {
      return Array.from(queries.values()).sort((a, b) => b.created_at - a.created_at);
    },
    findExpirable(now) {
      return Array.from(queries.values()).filter(
        (q) => isExpirable(q.status) && q.expires_at < now,
      );
    },
    findByStatus(status) {
      return Array.from(queries.values()).filter((q) => q.status === status);
    },
  };
}

/** Backward-compatible adapter: wrap a QueryStore as a QueryRepository. */
export function toRepository(store: QueryStore): QueryRepository {
  return {
    get(id) {
      return store.get(id);
    },
    save(query) {
      store.set(query.id, query);
    },
    delete(id) {
      store.delete(id);
    },
    clear() {
      store.clear();
    },
    findOpen(now) {
      const openStatuses: QueryStatus[] = ["pending", "awaiting_quotes", "worker_selected", "processing"];
      return store.values().filter((q) => openStatuses.includes(q.status) && q.expires_at > now);
    },
    findAll() {
      return store.values().sort((a, b) => b.created_at - a.created_at);
    },
    findExpirable(now) {
      return store.values().filter((q) => isExpirable(q.status) && q.expires_at < now);
    },
    findByStatus(status) {
      return store.values().filter((q) => q.status === status);
    },
  };
}
