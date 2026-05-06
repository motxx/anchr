import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AnchrWorker } from "./worker.ts";

type Query = {
  id: string;
  status: string;
  description: string;
  bounty?: { amount_sats: number };
  verification_requirements?: string[];
  tlsn_requirements?: { target_url: string };
};

function createFakeClient(queries: Query[]) {
  const submitted: Array<{ queryId: string; presentation: string }> = [];
  return {
    submitted,
    client: {
      listOpenQueries: () => Promise.resolve(queries),
      submitPresentation: (queryId: string, presentation: string) => {
        submitted.push({ queryId, presentation });
        return Promise.resolve({ ok: true, message: "Verification passed" });
      },
    },
  };
}

describe("AnchrWorker", () => {
  test("runOnce fulfills the first eligible TLSN query", async () => {
    const fake = createFakeClient([
      {
        id: "query_photo",
        status: "pending",
        description: "photo task",
        verification_requirements: ["gps"],
      },
      {
        id: "query_tlsn",
        status: "pending",
        description: "tlsn task",
        bounty: { amount_sats: 21 },
        verification_requirements: ["tlsn"],
        tlsn_requirements: { target_url: "https://api.example.com/status" },
      },
    ]);
    const events: unknown[] = [];

    const worker = new AnchrWorker(
      {
        serverUrl: "http://localhost:3000",
        verifierHost: "localhost:7046",
        minBountySats: 10,
        allowedDomains: ["api.example.com"],
      },
      {
        anchr: fake.client,
        generateProof: (targetUrl) =>
          Promise.resolve(`presentation:${targetUrl}`),
      },
    );
    worker.on("fulfilled", (event) => events.push(event));

    const event = await worker.runOnce();

    expect(event).toEqual({
      queryId: "query_tlsn",
      ok: true,
      message: "Verification passed",
      targetUrl: "https://api.example.com/status",
      durationMs: event!.durationMs,
    });
    expect(event!.durationMs).toBeGreaterThanOrEqual(0);
    expect(fake.submitted).toEqual([
      {
        queryId: "query_tlsn",
        presentation: "presentation:https://api.example.com/status",
      },
    ]);
    expect(events).toHaveLength(1);
  });

  test("runOnce returns null when domain and bounty filters reject all queries", async () => {
    const fake = createFakeClient([
      {
        id: "query_low_bounty",
        status: "pending",
        description: "low bounty",
        bounty: { amount_sats: 1 },
        verification_requirements: ["tlsn"],
        tlsn_requirements: { target_url: "https://api.example.com/status" },
      },
      {
        id: "query_wrong_domain",
        status: "pending",
        description: "wrong domain",
        bounty: { amount_sats: 100 },
        verification_requirements: ["tlsn"],
        tlsn_requirements: { target_url: "https://evil.example/status" },
      },
    ]);

    const worker = new AnchrWorker(
      {
        serverUrl: "http://localhost:3000",
        verifierHost: "localhost:7046",
        minBountySats: 10,
        allowedDomains: ["api.example.com"],
      },
      {
        anchr: fake.client,
        generateProof: () => Promise.resolve("unused"),
      },
    );

    expect(await worker.runOnce()).toBeNull();
    expect(fake.submitted).toEqual([]);
  });
});
