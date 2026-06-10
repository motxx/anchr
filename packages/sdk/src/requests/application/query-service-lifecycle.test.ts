import { beforeEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createQueryService, createQueryStore } from "./query-service.ts";
import type { QueryService, QueryStore } from "./query-service.ts";
import { createOracleRegistry } from "../../testing/oracle-registry.ts";
import type {
  Oracle,
  OracleAttestation,
  OracleRegistry,
} from "../../testing/oracle-registry.ts";
import type {
  BlossomKeyMap,
  Query,
  QueryResult,
  VerificationDetail,
} from "../domain/types.ts";

function makeMockOracle(opts?: {
  id?: string;
  pass?: boolean;
  checks?: string[];
  failures?: string[];
}): Oracle {
  const id = opts?.id ?? "built-in";
  const pass = opts?.pass ?? true;
  return {
    info: { id, name: `Mock ${id}`, fee_ppm: 0 },
    verify: async (
      _query: Query,
      _result: QueryResult,
      _keys?: BlossomKeyMap,
    ): Promise<OracleAttestation> => ({
      oracle_id: id,
      query_id: _query.id,
      passed: pass,
      checks: opts?.checks ?? (pass ? ["Mock check passed"] : []),
      failures: opts?.failures ?? (pass ? [] : ["Mock check failed"]),
      attested_at: Date.now(),
    }),
  };
}

function setup(oracleOpts?: { pass?: boolean; oracles?: Oracle[] }) {
  const store = createQueryStore();
  const registry = createOracleRegistry({ skipBuiltIn: true });
  const oracles = oracleOpts?.oracles ?? [
    makeMockOracle({ pass: oracleOpts?.pass ?? true }),
  ];
  for (const o of oracles) registry.register(o);
  const svc = createQueryService({ store, oracleRegistry: registry });
  return { store, registry, svc };
}

const defaultInput = { description: "Take a photo of Tokyo Tower" };
const defaultResult: QueryResult = { attachments: [], notes: "Here it is" };
const defaultMeta = {
  executor_type: "human" as const,
  channel: "adapter" as const,
};

describe("Application Service — Simple lifecycle", () => {
  test("create → submit → approved", async () => {
    const { svc } = setup({ pass: true });
    const query = svc.createQuery(defaultInput);
    expect(query.status).toBe("pending");

    const outcome = await svc.submitQueryResult(
      query.id,
      defaultResult,
      defaultMeta,
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.query?.status).toBe("approved");
    expect(outcome.query?.payment_status).toBe("released");
    expect(outcome.message).toContain("passed");
  });

  test("create → submit → rejected", async () => {
    const { svc } = setup({ pass: false });
    const query = svc.createQuery(defaultInput);

    const outcome = await svc.submitQueryResult(
      query.id,
      defaultResult,
      defaultMeta,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.query?.status).toBe("rejected");
    expect(outcome.query?.payment_status).toBe("cancelled");
  });

  test("create → cancel → rejected", () => {
    const { svc } = setup();
    const query = svc.createQuery(defaultInput);
    const outcome = svc.cancelQuery(query.id);
    expect(outcome.ok).toBe(true);

    const updated = svc.getQuery(query.id);
    expect(updated?.status).toBe("rejected");
  });

  test("create → expire → expired", async () => {
    const { svc } = setup();
    const query = svc.createQuery(defaultInput, { ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 5));

    const expired = svc.expireQueries();
    expect(expired).toBe(1);
    expect(svc.getQuery(query.id)?.status).toBe("expired");
  });

  test("submit to non-existent query", async () => {
    const { svc } = setup();
    const outcome = await svc.submitQueryResult(
      "no-such-id",
      defaultResult,
      defaultMeta,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("not found");
  });

  test("submit to already approved query", async () => {
    const { svc } = setup({ pass: true });
    const query = svc.createQuery(defaultInput);
    await svc.submitQueryResult(query.id, defaultResult, defaultMeta);

    const second = await svc.submitQueryResult(
      query.id,
      defaultResult,
      defaultMeta,
    );
    expect(second.ok).toBe(false);
  });

  test("cancel non-existent query", () => {
    const { svc } = setup();
    const outcome = svc.cancelQuery("no-such-id");
    expect(outcome.ok).toBe(false);
  });

  test("cancel already approved query", async () => {
    const { svc } = setup({ pass: true });
    const query = svc.createQuery(defaultInput);
    await svc.submitQueryResult(query.id, defaultResult, defaultMeta);

    const outcome = svc.cancelQuery(query.id);
    expect(outcome.ok).toBe(false);
  });

  test("listOpenQueries excludes expired", async () => {
    const { svc } = setup();
    svc.createQuery(defaultInput, { ttlMs: 1 });
    svc.createQuery(defaultInput, { ttlMs: 600_000 });
    await new Promise((r) => setTimeout(r, 5));
    svc.expireQueries();
    expect(svc.listOpenQueries().length).toBe(1);
  });

  test("listAllQueries sorted by created_at desc", async () => {
    const { svc } = setup();
    const q1 = svc.createQuery(defaultInput);
    await new Promise((r) => setTimeout(r, 2));
    const q2 = svc.createQuery(defaultInput);
    const all = svc.listAllQueries();
    expect(all[0].id).toBe(q2.id);
    expect(all[1].id).toBe(q1.id);
  });

  test("purgeExpiredFromStore removes expired queries", async () => {
    const { svc } = setup();
    svc.createQuery(defaultInput, { ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 5));
    svc.expireQueries();
    const purged = svc.purgeExpiredFromStore();
    expect(purged.length).toBe(1);
    expect(svc.listAllQueries().length).toBe(0);
  });

  test("clearQueryStore removes all", () => {
    const { svc } = setup();
    svc.createQuery(defaultInput);
    svc.createQuery(defaultInput);
    svc.clearQueryStore();
    expect(svc.listAllQueries().length).toBe(0);
  });
});

describe("Application Service — HTLC lifecycle", () => {
  const htlcOptions = () => ({
    escrow: {
      type: "htlc" as const,
      hash: "abc123",
      oracle_pubkeys: ["oracle_pub"],
      customer_pubkey: "req_pub",
      locktime: Math.floor(Date.now() / 1000) + 1200,
    },
    payment_lock: { amount_sats: 100 },
  });

  test("create HTLC query starts at awaiting_offers", () => {
    const { svc } = setup();
    const query = svc.createQuery(defaultInput, htlcOptions());
    expect(query.status).toBe("awaiting_offers");
    expect(query.escrow).toBeDefined();
    expect(query.offers).toEqual([]);
  });

  test("full HTLC lifecycle: create → offer → select → submit → approve", async () => {
    const { svc } = setup({ pass: true });
    const query = svc.createQuery(defaultInput, htlcOptions());

    const offerOutcome = svc.recordOffer(query.id, {
      provider_pubkey: "provider1",
      offer_event_id: "evt1",
      received_at: Date.now(),
    });
    expect(offerOutcome.ok).toBe(true);

    const selectOutcome = await svc.selectProvider(query.id, "provider1");
    svc.beginWork(query.id);
    expect(selectOutcome.ok).toBe(true);
    expect(svc.getQuery(query.id)?.status).toBe("processing");

    const submitOutcome = await svc.submitEscrowResult(
      query.id,
      defaultResult,
      "provider1",
    );
    expect(submitOutcome.ok).toBe(true);
    expect(submitOutcome.query?.status).toBe("approved");
  });

  test("HTLC lifecycle: rejected verification", async () => {
    const { svc } = setup({ pass: false });
    const query = svc.createQuery(defaultInput, htlcOptions());
    svc.recordOffer(query.id, {
      provider_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await svc.selectProvider(query.id, "w1");
    svc.beginWork(query.id);

    const outcome = await svc.submitEscrowResult(query.id, defaultResult, "w1");
    expect(outcome.ok).toBe(false);
    expect(outcome.query?.status).toBe("rejected");
  });

  test("HTLC: recordResult + completeVerification separately", async () => {
    const { svc } = setup({ pass: true });
    const query = svc.createQuery(defaultInput, htlcOptions());
    svc.recordOffer(query.id, {
      provider_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await svc.selectProvider(query.id, "w1");
    svc.beginWork(query.id);

    const recordOutcome = svc.recordResult(query.id, defaultResult, "w1");
    expect(recordOutcome.ok).toBe(true);
    expect(svc.getQuery(query.id)?.status).toBe("verifying");

    const verifyOutcome = svc.completeVerification(query.id, true, "oracle1");
    expect(verifyOutcome.ok).toBe(true);
    expect(svc.getQuery(query.id)?.status).toBe("approved");
  });

  test("HTLC: completeVerification rejected", async () => {
    const { svc } = setup();
    const query = svc.createQuery(defaultInput, htlcOptions());
    svc.recordOffer(query.id, {
      provider_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await svc.selectProvider(query.id, "w1");
    svc.beginWork(query.id);
    svc.recordResult(query.id, defaultResult, "w1");

    const outcome = svc.completeVerification(query.id, false);
    expect(outcome.ok).toBe(true);
    expect(svc.getQuery(query.id)?.status).toBe("rejected");
  });

  test("HTLC: cancel at awaiting_offers", () => {
    const { svc } = setup();
    const query = svc.createQuery(defaultInput, htlcOptions());
    const outcome = svc.cancelQuery(query.id);
    expect(outcome.ok).toBe(true);
    expect(svc.getQuery(query.id)?.status).toBe("rejected");
  });

  test("HTLC: expire at processing", async () => {
    const { svc } = setup();
    const query = svc.createQuery(defaultInput, { ...htlcOptions(), ttlMs: 1 });
    svc.recordOffer(query.id, {
      provider_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await svc.selectProvider(query.id, "w1");
    svc.beginWork(query.id);

    await new Promise((r) => setTimeout(r, 5));
    const expired = svc.expireQueries();
    expect(expired).toBe(1);
    expect(svc.getQuery(query.id)?.status).toBe("expired");
  });

  test("HTLC: cannot submit to non-HTLC query", async () => {
    const { svc } = setup();
    const query = svc.createQuery(defaultInput);
    const outcome = await svc.submitEscrowResult(query.id, defaultResult, "w1");
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("escrow");
  });

  test("HTLC: provider pubkey mismatch", async () => {
    const { svc } = setup();
    const query = svc.createQuery(defaultInput, htlcOptions());
    svc.recordOffer(query.id, {
      provider_pubkey: "w1",
      offer_event_id: "e1",
      received_at: Date.now(),
    });
    await svc.selectProvider(query.id, "w1");
    svc.beginWork(query.id);

    const outcome = await svc.submitEscrowResult(
      query.id,
      defaultResult,
      "wrong_provider",
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("does not match");
  });
});

describe("Application Service — Quorum verification", () => {
  test("multi-oracle quorum: passes with enough approvals", async () => {
    const { svc } = setup({
      oracles: [
        makeMockOracle({ id: "o1", pass: true }),
        makeMockOracle({ id: "o2", pass: true }),
        makeMockOracle({ id: "o3", pass: false }),
      ],
    });
    const query = svc.createQuery(defaultInput, {
      quorum: { min_approvals: 2 },
    });

    const outcome = await svc.submitQueryResult(
      query.id,
      defaultResult,
      defaultMeta,
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.query?.status).toBe("approved");
    expect(outcome.query?.attestations?.length).toBe(3);
  });

  test("multi-oracle quorum: fails with insufficient approvals", async () => {
    const { svc } = setup({
      oracles: [
        makeMockOracle({ id: "o1", pass: true }),
        makeMockOracle({ id: "o2", pass: false }),
        makeMockOracle({ id: "o3", pass: false }),
      ],
    });
    const query = svc.createQuery(defaultInput, {
      quorum: { min_approvals: 2 },
    });

    const outcome = await svc.submitQueryResult(
      query.id,
      defaultResult,
      defaultMeta,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.query?.status).toBe("rejected");
  });
});

describe("Application Service — Aggregate error propagation", () => {
  test("rejects empty description (delegates validation to aggregate)", () => {
    const { svc } = setup();
    expect(() => svc.createQuery({ description: "" })).toThrow(
      "description must not be empty",
    );
  });

  test("rejects HTLC locktime too short at service level", () => {
    const { svc } = setup();
    const nowSecs = Math.floor(Date.now() / 1000);
    expect(() =>
      svc.createQuery(defaultInput, {
        escrow: {
          type: "htlc",
          hash: "h",
          oracle_pubkeys: ["o"],
          customer_pubkey: "r",
          locktime: nowSecs + 100,
        },
      })
    ).toThrow("600s");
  });
});
