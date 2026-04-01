import { beforeEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { clearQueryStore, createQuery, getQuery, submitQueryResult } from "../application/query-service";
import { clearIntegrityStore } from "./verification/integrity-store";

/**
 * Tests for MCP query backend data transformation.
 *
 * Since getMcpQueryBackend() creates a default backend that delegates to
 * the same query-service functions, we test the data flow through
 * create → status → list → cancel to ensure correctness.
 *
 * The module is loaded dynamically to avoid top-level env issues.
 */

beforeEach(() => {
  clearQueryStore();
  clearIntegrityStore();
});

describe("MCP query backend — default backend", () => {
  test("createQuery returns created payload with expected fields", async () => {
    const { getMcpQueryBackend } = await import("./mcp-query-backend");
    const backend = getMcpQueryBackend();

    const result = await backend.createQuery(
      { description: "Test MCP query", verification_requirements: ["exif"] },
      600,
      { requester_type: "agent", client_name: "test" },
    ) as Record<string, unknown>;

    expect(result.query_id).toBeDefined();
    expect(result.status).toBe("pending");
    expect(result.description).toBe("Test MCP query");
    expect(result.challenge_nonce).toBeDefined();
    expect(result.challenge_rule).toBeDefined();
    expect(result.reference_app_url).toContain("/queries/");
    expect(result.query_api_url).toContain("/queries/");
  });

  test("getQueryStatus returns status payload for existing query", async () => {
    const { getMcpQueryBackend } = await import("./mcp-query-backend");
    const backend = getMcpQueryBackend();

    const created = await backend.createQuery(
      { description: "Status test" },
      600,
      { requester_type: "human" },
    ) as Record<string, unknown>;

    const status = await backend.getQueryStatus(created.query_id as string) as Record<string, unknown>;
    expect(status.query_id).toBe(created.query_id);
    expect(status.status).toBe("pending");
    expect(status.description).toBe("Status test");
    expect(typeof status.expires_in_seconds).toBe("number");
    expect(status.verification).toBeNull();
  });

  test("getQueryStatus returns error for unknown query", async () => {
    const { getMcpQueryBackend } = await import("./mcp-query-backend");
    const backend = getMcpQueryBackend();

    const result = await backend.getQueryStatus("nonexistent") as Record<string, unknown>;
    expect(result.error).toBe("Query not found");
  });

  test("listAvailableQueries returns open queries", async () => {
    const { getMcpQueryBackend } = await import("./mcp-query-backend");
    const backend = getMcpQueryBackend();

    await backend.createQuery({ description: "Q1" }, 600, { requester_type: "agent" });
    await backend.createQuery({ description: "Q2" }, 600, { requester_type: "agent" });

    const list = await backend.listAvailableQueries() as Array<Record<string, unknown>>;
    expect(list.length).toBeGreaterThanOrEqual(2);
    const descriptions = list.map((q) => q.description);
    expect(descriptions).toContain("Q1");
    expect(descriptions).toContain("Q2");
  });

  test("cancelQuery cancels existing query", async () => {
    const { getMcpQueryBackend } = await import("./mcp-query-backend");
    const backend = getMcpQueryBackend();

    const created = await backend.createQuery(
      { description: "Cancel me" },
      600,
      { requester_type: "agent" },
    ) as Record<string, unknown>;

    const result = await backend.cancelQuery(created.query_id as string) as Record<string, unknown>;
    expect(result.ok).toBe(true);

    const status = await backend.getQueryStatus(created.query_id as string) as Record<string, unknown>;
    expect(status.status).toBe("rejected");
  });

  test("getQueryAttachment returns error when no attachments", async () => {
    const { getMcpQueryBackend } = await import("./mcp-query-backend");
    const backend = getMcpQueryBackend();

    const created = await backend.createQuery(
      { description: "No attachments" },
      600,
      { requester_type: "agent" },
    ) as Record<string, unknown>;

    const result = await backend.getQueryAttachment(created.query_id as string, 0) as Record<string, unknown>;
    expect(result.error).toContain("attachments");
  });
});
