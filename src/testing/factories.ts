/**
 * Shared test factories for domain objects.
 */

import type { Query } from "../domain/types";

let queryCounter = 0;

/** Reset the query counter (useful in beforeEach). */
export function resetQueryCounter(): void {
  queryCounter = 0;
}

/**
 * Create a test Query with sensible defaults.
 * All fields can be overridden via the `overrides` parameter.
 */
export function makeQuery(overrides?: Partial<Query>): Query {
  return {
    id: `test_query_${++queryCounter}`,
    status: "pending",
    description: "Test query",
    verification_requirements: ["gps", "ai_check"],
    created_at: Date.now(),
    expires_at: Date.now() + 600_000,
    payment_status: "locked",
    ...overrides,
  } as Query;
}
