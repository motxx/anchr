import { test, describe } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createQueryService } from "./query-service.ts";
import type { ProofDelivery, ProofPublishResult } from "./proof-delivery.ts";
import type { OracleAttestationRecord, ProofVisibility, Query, QueryResult } from "../domain/types.ts";
import type { Oracle, OracleAttestation } from "../domain/oracle-types.ts";
import { createOracleRegistry } from "../infrastructure/oracle/registry.ts";

function createMockOracle(id: string, passResult: boolean): Oracle {
  return {
    info: { id, name: `Mock Oracle ${id}`, fee_ppm: 0 },
    async verify(query: Query, _result: QueryResult): Promise<OracleAttestation> {
      return {
        oracle_id: id,
        query_id: query.id,
        passed: passResult,
        checks: passResult ? ["all_ok"] : [],
        failures: passResult ? [] : ["failed"],
        attested_at: Date.now(),
        tlsn_verified: {
          server_name: "example.com",
          revealed_body: '{"status":"ok"}',
          revealed_headers: "Content-Type: application/json",
          session_timestamp: Math.floor(Date.now() / 1000),
        },
      };
    },
  };
}

function createMockProofDelivery(): { delivery: ProofDelivery; published: Array<{ query_id: string; oracle_id: string; visibility: ProofVisibility }> } {
  const published: Array<{ query_id: string; oracle_id: string; visibility: ProofVisibility }> = [];
  const delivery: ProofDelivery = {
    async publish(query, attestation, visibility): Promise<ProofPublishResult | null> {
      if (visibility !== "public") return null;
      published.push({ query_id: query.id, oracle_id: attestation.oracle_id, visibility });
      return { event_id: `evt_${attestation.oracle_id}`, relays: ["wss://relay.test"] };
    },
  };
  return { delivery, published };
}

describe("proof-delivery integration", () => {
  test("visibility: public triggers attestation publish", async () => {
    const registry = createOracleRegistry({ skipBuiltIn: true });
    const oracle = createMockOracle("test-oracle", true);
    registry.register(oracle);

    const { delivery, published } = createMockProofDelivery();

    const svc = createQueryService({
      oracleRegistry: registry,
      proofDelivery: delivery,
    });

    const query = svc.createQuery({
      description: "Test TLSNotary public",
      tlsn_requirements: { target_url: "https://example.com/api" },
      visibility: "public",
    }, { oracleIds: ["test-oracle"] });

    const result: QueryResult = { attachments: [] };
    const outcome = await svc.submitQueryResult(
      query.id, result, { executor_type: "human", channel: "worker_api" }, "test-oracle",
    );

    expect(outcome.ok).toBe(true);
    expect(published.length).toBe(1);
    expect(published[0]!.oracle_id).toBe("test-oracle");
    expect(published[0]!.visibility).toBe("public");

    const updatedQuery = svc.getQuery(query.id);
    expect(updatedQuery?.published_proofs).toBeDefined();
    expect(updatedQuery!.published_proofs!.length).toBe(1);
  });

  test("visibility: requester_only does NOT publish", async () => {
    const registry = createOracleRegistry({ skipBuiltIn: true });
    const oracle = createMockOracle("test-oracle", true);
    registry.register(oracle);

    const { delivery, published } = createMockProofDelivery();

    const svc = createQueryService({
      oracleRegistry: registry,
      proofDelivery: delivery,
    });

    const query = svc.createQuery({
      description: "Test TLSNotary private",
      tlsn_requirements: { target_url: "https://example.com/api" },
      visibility: "requester_only",
    }, { oracleIds: ["test-oracle"] });

    const result: QueryResult = { attachments: [] };
    const outcome = await svc.submitQueryResult(
      query.id, result, { executor_type: "human", channel: "worker_api" }, "test-oracle",
    );

    expect(outcome.ok).toBe(true);
    expect(published.length).toBe(0);

    const updatedQuery = svc.getQuery(query.id);
    expect(updatedQuery?.published_proofs).toBeUndefined();
  });

  test("quorum with visibility: public publishes all oracle attestations", async () => {
    const registry = createOracleRegistry({ skipBuiltIn: true });
    const oracle1 = createMockOracle("oracle-1", true);
    const oracle2 = createMockOracle("oracle-2", true);
    const oracle3 = createMockOracle("oracle-3", true);
    registry.register(oracle1);
    registry.register(oracle2);
    registry.register(oracle3);

    const { delivery, published } = createMockProofDelivery();

    const svc = createQueryService({
      oracleRegistry: registry,
      proofDelivery: delivery,
    });

    const query = svc.createQuery({
      description: "Test TLSNotary quorum public",
      tlsn_requirements: { target_url: "https://example.com/api" },
      visibility: "public",
    }, {
      oracleIds: ["oracle-1", "oracle-2", "oracle-3"],
      quorum: { min_approvals: 2 },
    });

    const result: QueryResult = { attachments: [] };
    const outcome = await svc.submitQueryResult(
      query.id, result, { executor_type: "human", channel: "worker_api" },
    );

    expect(outcome.ok).toBe(true);
    expect(published.length).toBe(3);
    const oracleIds = published.map((p) => p.oracle_id).sort();
    expect(oracleIds).toEqual(["oracle-1", "oracle-2", "oracle-3"]);

    const updatedQuery = svc.getQuery(query.id);
    expect(updatedQuery?.published_proofs?.length).toBe(3);
  });
});
