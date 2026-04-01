import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createQueryAggregate,
  submitResult,
  expireQuery,
  cancelQuery,
  addQuote,
  selectWorker,
  recordResult,
  completeVerification,
  MIN_HTLC_LOCKTIME_SECS,
} from "./query-aggregate";
import type {
  Query,
  QueryInput,
  QueryResult,
  VerificationDetail,
  SubmissionMeta,
  QuoteInfo,
  HtlcInfo,
} from "./types";
import type { CreateQueryAggregateOptions, TransitionResult } from "./query-aggregate";

// --- Helpers ---

function expectOk(result: TransitionResult): Query {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected ok but got error: ${result.error}`);
  return result.query;
}

function expectErr(result: TransitionResult): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected error but got ok");
  return result.error;
}

const defaultInput: QueryInput = {
  description: "Take a photo of Tokyo Tower",
};

const defaultOptions: CreateQueryAggregateOptions = {
  ttlMs: 600_000, // 10 min
};

function makeHtlcOptions(overrides?: Partial<HtlcInfo>): CreateQueryAggregateOptions {
  const nowSecs = Math.floor(Date.now() / 1000);
  return {
    ttlMs: 600_000,
    htlc: {
      hash: "abc123hash",
      oracle_pubkey: "oracle_pub",
      requester_pubkey: "requester_pub",
      locktime: nowSecs + 1200,
      ...overrides,
    },
  };
}

function makeQuery(overrides?: Partial<Query>): Query {
  return {
    id: "test_query_1",
    status: "pending",
    description: "Test",
    verification_requirements: ["gps", "ai_check"],
    created_at: Date.now(),
    expires_at: Date.now() + 600_000,
    payment_status: "locked",
    ...overrides,
  };
}

function makeHtlcQuery(overrides?: Partial<Query>): Query {
  return makeQuery({
    status: "awaiting_quotes",
    payment_status: "htlc_locked",
    htlc: {
      hash: "abc123hash",
      oracle_pubkey: "oracle_pub",
      requester_pubkey: "requester_pub",
      locktime: Math.floor(Date.now() / 1000) + 1200,
    },
    quotes: [],
    ...overrides,
  });
}

const passedVerification: VerificationDetail = {
  passed: true,
  checks: ["GPS check passed", "AI check passed"],
  failures: [],
};

const failedVerification: VerificationDetail = {
  passed: false,
  checks: ["GPS check passed"],
  failures: ["AI check failed"],
};

const defaultMeta: SubmissionMeta = {
  executor_type: "human",
  channel: "worker_api",
};

const defaultResult: QueryResult = {
  attachments: [],
  notes: "Test result",
};

// --- createQueryAggregate ---

describe("createQueryAggregate", () => {
  test("creates a simple query with pending status", () => {
    const q = expectOk(createQueryAggregate(defaultInput, defaultOptions));
    expect(q.status).toBe("pending");
    expect(q.description).toBe("Take a photo of Tokyo Tower");
    expect(q.payment_status).toBe("locked");
    expect(q.htlc).toBeUndefined();
    expect(q.quotes).toBeUndefined();
  });

  test("creates an HTLC query with awaiting_quotes status", () => {
    const q = expectOk(createQueryAggregate(defaultInput, makeHtlcOptions()));
    expect(q.status).toBe("awaiting_quotes");
    expect(q.payment_status).toBe("htlc_locked");
    expect(q.htlc).toBeDefined();
    expect(q.quotes).toEqual([]);
  });

  test("sets expires_at from ttlMs", () => {
    const before = Date.now();
    const q = expectOk(createQueryAggregate(defaultInput, { ttlMs: 120_000 }));
    expect(q.expires_at).toBeGreaterThanOrEqual(before + 120_000);
  });

  test("sets requester_meta", () => {
    const q = expectOk(createQueryAggregate(defaultInput, {
      ttlMs: 600_000,
      requesterMeta: { requester_type: "agent", requester_id: "bot1" },
    }));
    expect(q.requester_meta?.requester_type).toBe("agent");
  });

  test("sets bounty", () => {
    const q = expectOk(createQueryAggregate(defaultInput, {
      ttlMs: 600_000,
      bounty: { amount_sats: 100 },
    }));
    expect(q.bounty?.amount_sats).toBe(100);
  });

  test("sets oracle_ids", () => {
    const q = expectOk(createQueryAggregate(defaultInput, {
      ttlMs: 600_000,
      oracleIds: ["oracle1", "oracle2"],
    }));
    expect(q.oracle_ids).toEqual(["oracle1", "oracle2"]);
  });

  test("sets nostr_event_id", () => {
    const q = expectOk(createQueryAggregate(defaultInput, {
      ttlMs: 600_000,
      nostrEventId: "evt123",
    }));
    expect(q.nostr_event_id).toBe("evt123");
  });

  test("sets quorum", () => {
    const q = expectOk(createQueryAggregate(defaultInput, {
      ttlMs: 600_000,
      quorum: { min_approvals: 2 },
    }));
    expect(q.quorum?.min_approvals).toBe(2);
  });

  test("sets expected_gps and max_gps_distance_km", () => {
    const q = expectOk(createQueryAggregate({
      ...defaultInput,
      expected_gps: { lat: 35.6, lon: 139.7 },
      max_gps_distance_km: 5,
    }, defaultOptions));
    expect(q.expected_gps?.lat).toBe(35.6);
    expect(q.max_gps_distance_km).toBe(5);
  });

  test("sets tlsn_requirements", () => {
    const q = expectOk(createQueryAggregate({
      ...defaultInput,
      tlsn_requirements: { target_url: "https://example.com/api" },
    }, defaultOptions));
    expect(q.tlsn_requirements?.target_url).toBe("https://example.com/api");
  });

  test("generates nonce when nonce is in verification_requirements", () => {
    const q = expectOk(createQueryAggregate({
      ...defaultInput,
      verification_requirements: ["nonce", "gps"],
    }, defaultOptions));
    expect(q.challenge_nonce).toBeDefined();
    expect(q.challenge_rule).toBeDefined();
  });

  test("does not generate nonce when nonce is not required", () => {
    const q = expectOk(createQueryAggregate(defaultInput, defaultOptions));
    expect(q.challenge_nonce).toBeUndefined();
  });

  // --- Validation errors ---
  test("rejects empty description", () => {
    const err = expectErr(createQueryAggregate({ description: "" }, defaultOptions));
    expect(err).toContain("description");
  });

  test("rejects invalid GPS", () => {
    const result = createQueryAggregate({
      description: "Photo",
      expected_gps: { lat: 999, lon: 0 },
    }, defaultOptions);
    expect(result.ok).toBe(false);
  });

  test("rejects HTLC locktime too short", () => {
    const nowSecs = Math.floor(Date.now() / 1000);
    const err = expectErr(createQueryAggregate(defaultInput, {
      ttlMs: 600_000,
      htlc: {
        hash: "h",
        oracle_pubkey: "o",
        requester_pubkey: "r",
        locktime: nowSecs + 100, // too short
      },
    }));
    expect(err).toContain("600s");
  });

  test("accepts HTLC locktime exactly at minimum", () => {
    const nowSecs = Math.floor(Date.now() / 1000);
    const result = createQueryAggregate(defaultInput, {
      ttlMs: 600_000,
      htlc: {
        hash: "h",
        oracle_pubkey: "o",
        requester_pubkey: "r",
        locktime: nowSecs + MIN_HTLC_LOCKTIME_SECS,
      },
    });
    expect(result.ok).toBe(true);
  });
});

// --- submitResult (Simple path) ---

describe("submitResult", () => {
  test("pending → approved on passed verification", () => {
    const query = makeQuery();
    const q = expectOk(submitResult(query, defaultResult, passedVerification, defaultMeta));
    expect(q.status).toBe("approved");
    expect(q.payment_status).toBe("released");
    expect(q.verification?.passed).toBe(true);
    expect(q.result).toEqual(defaultResult);
    expect(q.submission_meta).toEqual(defaultMeta);
  });

  test("pending → rejected on failed verification", () => {
    const query = makeQuery();
    const q = expectOk(submitResult(query, defaultResult, failedVerification, defaultMeta));
    expect(q.status).toBe("rejected");
    expect(q.payment_status).toBe("cancelled");
  });

  test("sets assigned_oracle_id from attestations", () => {
    const query = makeQuery();
    const atts = [{ oracle_id: "oracle1", passed: true, checks: [], failures: [], attested_at: Date.now() }];
    const q = expectOk(submitResult(query, defaultResult, passedVerification, defaultMeta, undefined, atts));
    expect(q.assigned_oracle_id).toBe("oracle1");
  });

  test("sets assigned_oracle_id from oracleId parameter", () => {
    const query = makeQuery();
    const q = expectOk(submitResult(query, defaultResult, passedVerification, defaultMeta, "my_oracle"));
    expect(q.assigned_oracle_id).toBe("my_oracle");
  });

  test("sets blossom_keys", () => {
    const query = makeQuery();
    const keys = { att1: { encrypt_key: "k", encrypt_iv: "iv" } };
    const q = expectOk(submitResult(query, defaultResult, passedVerification, defaultMeta, undefined, undefined, keys));
    expect(q.blossom_keys).toEqual(keys);
  });

  test("stores attestations when quorum is set", () => {
    const query = makeQuery({ quorum: { min_approvals: 2 } });
    const atts = [
      { oracle_id: "o1", passed: true, checks: [], failures: [], attested_at: Date.now() },
      { oracle_id: "o2", passed: true, checks: [], failures: [], attested_at: Date.now() },
    ];
    const q = expectOk(submitResult(query, defaultResult, passedVerification, defaultMeta, undefined, atts));
    expect(q.attestations?.length).toBe(2);
  });

  test("does not store attestations when no quorum", () => {
    const query = makeQuery();
    const q = expectOk(submitResult(query, defaultResult, passedVerification, defaultMeta));
    expect(q.attestations).toBeUndefined();
  });

  test("rejects when query is not pending", () => {
    const query = makeQuery({ status: "approved" });
    const err = expectErr(submitResult(query, defaultResult, passedVerification, defaultMeta));
    expect(err).toContain("approved");
  });

  test("expires query instead of submitting if past deadline", () => {
    const query = makeQuery({ expires_at: Date.now() - 1000 });
    const q = expectOk(submitResult(query, defaultResult, passedVerification, defaultMeta));
    expect(q.status).toBe("expired");
    expect(q.payment_status).toBe("cancelled");
  });

  test("rejects HTLC query", () => {
    const query = makeHtlcQuery({ status: "pending" });
    const err = expectErr(submitResult(query, defaultResult, passedVerification, defaultMeta));
    expect(err).toContain("HTLC");
  });
});

// --- expireQuery ---

describe("expireQuery", () => {
  test("expires pending query past deadline", () => {
    const query = makeQuery({ expires_at: 1000 });
    const q = expectOk(expireQuery(query, 2000));
    expect(q.status).toBe("expired");
    expect(q.payment_status).toBe("cancelled");
  });

  test("expires awaiting_quotes query past deadline", () => {
    const query = makeHtlcQuery({ expires_at: 1000 });
    const q = expectOk(expireQuery(query, 2000));
    expect(q.status).toBe("expired");
  });

  test("expires processing query past deadline", () => {
    const query = makeHtlcQuery({ status: "processing", expires_at: 1000 });
    expectOk(expireQuery(query, 2000));
  });

  test("expires worker_selected query past deadline", () => {
    const query = makeQuery({ status: "worker_selected", expires_at: 1000 });
    expectOk(expireQuery(query, 2000));
  });

  test("rejects when not expired yet", () => {
    const query = makeQuery({ expires_at: 5000 });
    const err = expectErr(expireQuery(query, 2000));
    expect(err).toContain("not expired");
  });

  test("rejects approved query", () => {
    const query = makeQuery({ status: "approved", expires_at: 1000 });
    expect(expireQuery(query, 2000).ok).toBe(false);
  });

  test("rejects rejected query", () => {
    const query = makeQuery({ status: "rejected", expires_at: 1000 });
    expect(expireQuery(query, 2000).ok).toBe(false);
  });

  test("rejects already expired query", () => {
    const query = makeQuery({ status: "expired", expires_at: 1000 });
    expect(expireQuery(query, 2000).ok).toBe(false);
  });

  test("rejects verifying query", () => {
    const query = makeHtlcQuery({ status: "verifying", expires_at: 1000 });
    expect(expireQuery(query, 2000).ok).toBe(false);
  });
});

// --- cancelQuery ---

describe("cancelQuery", () => {
  test("cancels pending query", () => {
    const query = makeQuery();
    const q = expectOk(cancelQuery(query));
    expect(q.status).toBe("rejected");
    expect(q.payment_status).toBe("cancelled");
  });

  test("cancels awaiting_quotes query", () => {
    const query = makeHtlcQuery();
    const q = expectOk(cancelQuery(query));
    expect(q.status).toBe("rejected");
  });

  test("cancels worker_selected query", () => {
    const query = makeQuery({ status: "worker_selected" });
    expectOk(cancelQuery(query));
  });

  test("cancels processing query", () => {
    const query = makeHtlcQuery({ status: "processing" });
    expectOk(cancelQuery(query));
  });

  test("rejects verifying query", () => {
    const query = makeHtlcQuery({ status: "verifying" });
    const err = expectErr(cancelQuery(query));
    expect(err).toContain("verifying");
  });

  test("rejects approved query", () => {
    const query = makeQuery({ status: "approved" });
    expect(cancelQuery(query).ok).toBe(false);
  });

  test("rejects rejected query", () => {
    const query = makeQuery({ status: "rejected" });
    expect(cancelQuery(query).ok).toBe(false);
  });

  test("rejects expired query", () => {
    const query = makeQuery({ status: "expired" });
    expect(cancelQuery(query).ok).toBe(false);
  });
});

// --- HTLC: addQuote ---

describe("addQuote", () => {
  test("adds quote to awaiting_quotes query", () => {
    const query = makeHtlcQuery();
    const quote: QuoteInfo = {
      worker_pubkey: "worker1",
      quote_event_id: "evt1",
      received_at: Date.now(),
    };
    const q = expectOk(addQuote(query, quote));
    expect(q.quotes?.length).toBe(1);
    expect(q.quotes?.[0].worker_pubkey).toBe("worker1");
  });

  test("appends to existing quotes", () => {
    const query = makeHtlcQuery({
      quotes: [{
        worker_pubkey: "w1",
        quote_event_id: "e1",
        received_at: Date.now(),
      }],
    });
    const quote: QuoteInfo = {
      worker_pubkey: "w2",
      quote_event_id: "e2",
      received_at: Date.now(),
    };
    const q = expectOk(addQuote(query, quote));
    expect(q.quotes?.length).toBe(2);
  });

  test("rejects non-HTLC query", () => {
    const query = makeQuery();
    const quote: QuoteInfo = { worker_pubkey: "w", quote_event_id: "e", received_at: Date.now() };
    const err = expectErr(addQuote(query, quote));
    expect(err).toContain("HTLC");
  });

  test("rejects when not awaiting_quotes", () => {
    const query = makeHtlcQuery({ status: "processing" });
    const quote: QuoteInfo = { worker_pubkey: "w", quote_event_id: "e", received_at: Date.now() };
    const err = expectErr(addQuote(query, quote));
    expect(err).toContain("processing");
  });

  test("rejects quote with empty worker_pubkey", () => {
    const query = makeHtlcQuery();
    const quote: QuoteInfo = { worker_pubkey: "", quote_event_id: "e", received_at: Date.now() };
    const err = expectErr(addQuote(query, quote));
    expect(err).toContain("worker_pubkey");
  });

  test("rejects quote with empty quote_event_id", () => {
    const query = makeHtlcQuery();
    const quote: QuoteInfo = { worker_pubkey: "w", quote_event_id: "", received_at: Date.now() };
    const err = expectErr(addQuote(query, quote));
    expect(err).toContain("quote_event_id");
  });
});

// --- HTLC: selectWorker ---

describe("selectWorker", () => {
  test("transitions awaiting_quotes → processing", () => {
    const query = makeHtlcQuery();
    const q = expectOk(selectWorker(query, "worker_pub", {}));
    expect(q.status).toBe("processing");
    expect(q.htlc?.worker_pubkey).toBe("worker_pub");
  });

  test("sets escrow_token and payment_status on swap", () => {
    const query = makeHtlcQuery();
    const q = expectOk(selectWorker(query, "worker_pub", { escrow_token: "tok123" }));
    expect(q.htlc?.escrow_token).toBe("tok123");
    expect(q.payment_status).toBe("htlc_swapped");
  });

  test("preserves payment_status without escrow_token", () => {
    const query = makeHtlcQuery();
    const q = expectOk(selectWorker(query, "worker_pub", {}));
    expect(q.payment_status).toBe("htlc_locked");
  });

  test("sets verified_escrow_sats", () => {
    const query = makeHtlcQuery();
    const q = expectOk(selectWorker(query, "worker_pub", { verified_escrow_sats: 100 }));
    expect(q.htlc?.verified_escrow_sats).toBe(100);
  });

  test("rejects non-HTLC query", () => {
    const query = makeQuery();
    const err = expectErr(selectWorker(query, "w", {}));
    expect(err).toContain("HTLC");
  });

  test("rejects wrong state (processing)", () => {
    const query = makeHtlcQuery({ status: "processing" });
    expect(selectWorker(query, "w", {}).ok).toBe(false);
  });

  test("rejects wrong state (verifying)", () => {
    const query = makeHtlcQuery({ status: "verifying" });
    expect(selectWorker(query, "w", {}).ok).toBe(false);
  });
});

// --- HTLC: recordResult ---

describe("recordResult", () => {
  test("transitions processing → verifying", () => {
    const query = makeHtlcQuery({
      status: "processing",
      htlc: {
        hash: "h",
        oracle_pubkey: "o",
        requester_pubkey: "r",
        locktime: Math.floor(Date.now() / 1000) + 1200,
        worker_pubkey: "worker1",
      },
    });
    const q = expectOk(recordResult(query, defaultResult, "worker1"));
    expect(q.status).toBe("verifying");
    expect(q.result).toEqual(defaultResult);
    expect(q.submitted_at).toBeDefined();
  });

  test("allows submission when no worker_pubkey set", () => {
    const query = makeHtlcQuery({ status: "processing" });
    expectOk(recordResult(query, defaultResult, "any_worker"));
  });

  test("rejects mismatched worker_pubkey", () => {
    const query = makeHtlcQuery({
      status: "processing",
      htlc: {
        hash: "h",
        oracle_pubkey: "o",
        requester_pubkey: "r",
        locktime: Math.floor(Date.now() / 1000) + 1200,
        worker_pubkey: "worker1",
      },
    });
    const err = expectErr(recordResult(query, defaultResult, "wrong_worker"));
    expect(err).toContain("does not match");
  });

  test("sets blossom_keys", () => {
    const query = makeHtlcQuery({ status: "processing" });
    const keys = { att1: { encrypt_key: "k", encrypt_iv: "iv" } };
    const q = expectOk(recordResult(query, defaultResult, "w", keys));
    expect(q.blossom_keys).toEqual(keys);
  });

  test("rejects non-HTLC query", () => {
    const query = makeQuery({ status: "processing" });
    const err = expectErr(recordResult(query, defaultResult, "w"));
    expect(err).toContain("HTLC");
  });

  test("rejects wrong state (awaiting_quotes)", () => {
    const query = makeHtlcQuery();
    expect(recordResult(query, defaultResult, "w").ok).toBe(false);
  });

  test("rejects wrong state (verifying)", () => {
    const query = makeHtlcQuery({ status: "verifying" });
    expect(recordResult(query, defaultResult, "w").ok).toBe(false);
  });
});

// --- HTLC: completeVerification ---

describe("completeVerification", () => {
  test("verifying → approved when passed", () => {
    const query = makeHtlcQuery({ status: "verifying" });
    const q = expectOk(completeVerification(query, true, passedVerification, "oracle1"));
    expect(q.status).toBe("approved");
    expect(q.payment_status).toBe("released");
    expect(q.assigned_oracle_id).toBe("oracle1");
  });

  test("verifying → rejected when not passed", () => {
    const query = makeHtlcQuery({ status: "verifying" });
    const q = expectOk(completeVerification(query, false, failedVerification));
    expect(q.status).toBe("rejected");
    expect(q.payment_status).toBe("cancelled");
  });

  test("stores verification detail", () => {
    const query = makeHtlcQuery({ status: "verifying" });
    const q = expectOk(completeVerification(query, true, passedVerification));
    expect(q.verification).toEqual(passedVerification);
  });

  test("stores attestations when quorum is set", () => {
    const query = makeHtlcQuery({ status: "verifying", quorum: { min_approvals: 2 } });
    const atts = [
      { oracle_id: "o1", passed: true, checks: [], failures: [], attested_at: Date.now() },
      { oracle_id: "o2", passed: true, checks: [], failures: [], attested_at: Date.now() },
    ];
    const q = expectOk(completeVerification(query, true, passedVerification, undefined, atts));
    expect(q.attestations?.length).toBe(2);
  });

  test("derives oracle_id from attestations", () => {
    const query = makeHtlcQuery({ status: "verifying" });
    const atts = [{ oracle_id: "orc1", passed: true, checks: [], failures: [], attested_at: Date.now() }];
    const q = expectOk(completeVerification(query, true, passedVerification, undefined, atts));
    expect(q.assigned_oracle_id).toBe("orc1");
  });

  test("rejects non-HTLC query", () => {
    const query = makeQuery({ status: "verifying" });
    const err = expectErr(completeVerification(query, true, passedVerification));
    expect(err).toContain("HTLC");
  });

  test("rejects wrong state (processing)", () => {
    const query = makeHtlcQuery({ status: "processing" });
    expect(completeVerification(query, true, passedVerification).ok).toBe(false);
  });

  test("rejects wrong state (awaiting_quotes)", () => {
    const query = makeHtlcQuery();
    expect(completeVerification(query, true, passedVerification).ok).toBe(false);
  });

  test("rejects already approved query", () => {
    const query = makeHtlcQuery({ status: "approved" });
    expect(completeVerification(query, true, passedVerification).ok).toBe(false);
  });
});

// --- Full HTLC lifecycle ---

describe("HTLC full lifecycle", () => {
  test("awaiting_quotes → processing → verifying → approved", () => {
    const q0 = makeHtlcQuery();
    expect(q0.status).toBe("awaiting_quotes");

    const q1 = expectOk(addQuote(q0, {
      worker_pubkey: "w1",
      quote_event_id: "e1",
      received_at: Date.now(),
    }));

    const q2 = expectOk(selectWorker(q1, "w1", {}));
    expect(q2.status).toBe("processing");

    const q3 = expectOk(recordResult(q2, defaultResult, "w1"));
    expect(q3.status).toBe("verifying");

    const q4 = expectOk(completeVerification(q3, true, passedVerification, "oracle1"));
    expect(q4.status).toBe("approved");
    expect(q4.payment_status).toBe("released");
  });

  test("awaiting_quotes → processing → verifying → rejected", () => {
    const q0 = makeHtlcQuery();
    const q1 = expectOk(addQuote(q0, { worker_pubkey: "w1", quote_event_id: "e1", received_at: Date.now() }));
    const q2 = expectOk(selectWorker(q1, "w1", {}));
    const q3 = expectOk(recordResult(q2, defaultResult, "w1"));
    const q4 = expectOk(completeVerification(q3, false, failedVerification));
    expect(q4.status).toBe("rejected");
    expect(q4.payment_status).toBe("cancelled");
  });

  test("can expire at awaiting_quotes", () => {
    const q = makeHtlcQuery({ expires_at: 1000 });
    const expired = expectOk(expireQuery(q, 2000));
    expect(expired.status).toBe("expired");
  });

  test("can expire at processing", () => {
    const q = makeHtlcQuery({ status: "processing", expires_at: 1000 });
    expectOk(expireQuery(q, 2000));
  });

  test("cannot expire at verifying", () => {
    const q = makeHtlcQuery({ status: "verifying", expires_at: 1000 });
    expect(expireQuery(q, 2000).ok).toBe(false);
  });

  test("can cancel at awaiting_quotes", () => {
    expectOk(cancelQuery(makeHtlcQuery()));
  });

  test("can cancel at processing", () => {
    expectOk(cancelQuery(makeHtlcQuery({ status: "processing" })));
  });

  test("cannot cancel at verifying", () => {
    expect(cancelQuery(makeHtlcQuery({ status: "verifying" })).ok).toBe(false);
  });
});
