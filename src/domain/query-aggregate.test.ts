import { test, expect, describe } from "bun:test";
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
import type { CreateQueryAggregateOptions } from "./query-aggregate";

// --- Helpers ---

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
    const result = createQueryAggregate(defaultInput, defaultOptions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.status).toBe("pending");
    expect(result.query.description).toBe("Take a photo of Tokyo Tower");
    expect(result.query.payment_status).toBe("locked");
    expect(result.query.htlc).toBeUndefined();
    expect(result.query.quotes).toBeUndefined();
  });

  test("creates an HTLC query with awaiting_quotes status", () => {
    const result = createQueryAggregate(defaultInput, makeHtlcOptions());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.status).toBe("awaiting_quotes");
    expect(result.query.payment_status).toBe("htlc_locked");
    expect(result.query.htlc).toBeDefined();
    expect(result.query.quotes).toEqual([]);
  });

  test("sets expires_at from ttlMs", () => {
    const before = Date.now();
    const result = createQueryAggregate(defaultInput, { ttlMs: 120_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.expires_at).toBeGreaterThanOrEqual(before + 120_000);
  });

  test("sets requester_meta", () => {
    const result = createQueryAggregate(defaultInput, {
      ttlMs: 600_000,
      requesterMeta: { requester_type: "agent", requester_id: "bot1" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.requester_meta?.requester_type).toBe("agent");
  });

  test("sets bounty", () => {
    const result = createQueryAggregate(defaultInput, {
      ttlMs: 600_000,
      bounty: { amount_sats: 100 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.bounty?.amount_sats).toBe(100);
  });

  test("sets oracle_ids", () => {
    const result = createQueryAggregate(defaultInput, {
      ttlMs: 600_000,
      oracleIds: ["oracle1", "oracle2"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.oracle_ids).toEqual(["oracle1", "oracle2"]);
  });

  test("sets nostr_event_id", () => {
    const result = createQueryAggregate(defaultInput, {
      ttlMs: 600_000,
      nostrEventId: "evt123",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.nostr_event_id).toBe("evt123");
  });

  test("sets quorum", () => {
    const result = createQueryAggregate(defaultInput, {
      ttlMs: 600_000,
      quorum: { min_approvals: 2 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.quorum?.min_approvals).toBe(2);
  });

  test("sets expected_gps and max_gps_distance_km", () => {
    const result = createQueryAggregate({
      ...defaultInput,
      expected_gps: { lat: 35.6, lon: 139.7 },
      max_gps_distance_km: 5,
    }, defaultOptions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.expected_gps?.lat).toBe(35.6);
    expect(result.query.max_gps_distance_km).toBe(5);
  });

  test("sets tlsn_requirements", () => {
    const result = createQueryAggregate({
      ...defaultInput,
      tlsn_requirements: { target_url: "https://example.com/api" },
    }, defaultOptions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.tlsn_requirements?.target_url).toBe("https://example.com/api");
  });

  test("generates nonce when nonce is in verification_requirements", () => {
    const result = createQueryAggregate({
      ...defaultInput,
      verification_requirements: ["nonce", "gps"],
    }, defaultOptions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.challenge_nonce).toBeDefined();
    expect(result.query.challenge_rule).toBeDefined();
  });

  test("does not generate nonce when nonce is not required", () => {
    const result = createQueryAggregate(defaultInput, defaultOptions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.challenge_nonce).toBeUndefined();
  });

  // --- Validation errors ---
  test("rejects empty description", () => {
    const result = createQueryAggregate({ description: "" }, defaultOptions);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("description");
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
    const result = createQueryAggregate(defaultInput, {
      ttlMs: 600_000,
      htlc: {
        hash: "h",
        oracle_pubkey: "o",
        requester_pubkey: "r",
        locktime: nowSecs + 100, // too short
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("600s");
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
    const result = submitResult(query, defaultResult, passedVerification, defaultMeta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.status).toBe("approved");
    expect(result.query.payment_status).toBe("released");
    expect(result.query.verification?.passed).toBe(true);
    expect(result.query.result).toEqual(defaultResult);
    expect(result.query.submission_meta).toEqual(defaultMeta);
  });

  test("pending → rejected on failed verification", () => {
    const query = makeQuery();
    const result = submitResult(query, defaultResult, failedVerification, defaultMeta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.status).toBe("rejected");
    expect(result.query.payment_status).toBe("cancelled");
  });

  test("sets assigned_oracle_id from attestations", () => {
    const query = makeQuery();
    const atts = [{ oracle_id: "oracle1", passed: true, checks: [], failures: [], attested_at: Date.now() }];
    const result = submitResult(query, defaultResult, passedVerification, defaultMeta, undefined, atts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.assigned_oracle_id).toBe("oracle1");
  });

  test("sets assigned_oracle_id from oracleId parameter", () => {
    const query = makeQuery();
    const result = submitResult(query, defaultResult, passedVerification, defaultMeta, "my_oracle");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.assigned_oracle_id).toBe("my_oracle");
  });

  test("sets blossom_keys", () => {
    const query = makeQuery();
    const keys = { att1: { encrypt_key: "k", encrypt_iv: "iv" } };
    const result = submitResult(query, defaultResult, passedVerification, defaultMeta, undefined, undefined, keys);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.blossom_keys).toEqual(keys);
  });

  test("stores attestations when quorum is set", () => {
    const query = makeQuery({ quorum: { min_approvals: 2 } });
    const atts = [
      { oracle_id: "o1", passed: true, checks: [], failures: [], attested_at: Date.now() },
      { oracle_id: "o2", passed: true, checks: [], failures: [], attested_at: Date.now() },
    ];
    const result = submitResult(query, defaultResult, passedVerification, defaultMeta, undefined, atts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.attestations?.length).toBe(2);
  });

  test("does not store attestations when no quorum", () => {
    const query = makeQuery();
    const result = submitResult(query, defaultResult, passedVerification, defaultMeta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.attestations).toBeUndefined();
  });

  test("rejects when query is not pending", () => {
    const query = makeQuery({ status: "approved" });
    const result = submitResult(query, defaultResult, passedVerification, defaultMeta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("approved");
  });

  test("expires query instead of submitting if past deadline", () => {
    const query = makeQuery({ expires_at: Date.now() - 1000 });
    const result = submitResult(query, defaultResult, passedVerification, defaultMeta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.status).toBe("expired");
    expect(result.query.payment_status).toBe("cancelled");
  });

  test("rejects HTLC query", () => {
    const query = makeHtlcQuery({ status: "pending" });
    const result = submitResult(query, defaultResult, passedVerification, defaultMeta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("HTLC");
  });
});

// --- expireQuery ---

describe("expireQuery", () => {
  test("expires pending query past deadline", () => {
    const query = makeQuery({ expires_at: 1000 });
    const result = expireQuery(query, 2000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.status).toBe("expired");
    expect(result.query.payment_status).toBe("cancelled");
  });

  test("expires awaiting_quotes query past deadline", () => {
    const query = makeHtlcQuery({ expires_at: 1000 });
    const result = expireQuery(query, 2000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.status).toBe("expired");
  });

  test("expires processing query past deadline", () => {
    const query = makeHtlcQuery({ status: "processing", expires_at: 1000 });
    const result = expireQuery(query, 2000);
    expect(result.ok).toBe(true);
  });

  test("expires worker_selected query past deadline", () => {
    const query = makeQuery({ status: "worker_selected", expires_at: 1000 });
    const result = expireQuery(query, 2000);
    expect(result.ok).toBe(true);
  });

  test("rejects when not expired yet", () => {
    const query = makeQuery({ expires_at: 5000 });
    const result = expireQuery(query, 2000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not expired");
  });

  test("rejects approved query", () => {
    const query = makeQuery({ status: "approved", expires_at: 1000 });
    const result = expireQuery(query, 2000);
    expect(result.ok).toBe(false);
  });

  test("rejects rejected query", () => {
    const query = makeQuery({ status: "rejected", expires_at: 1000 });
    const result = expireQuery(query, 2000);
    expect(result.ok).toBe(false);
  });

  test("rejects already expired query", () => {
    const query = makeQuery({ status: "expired", expires_at: 1000 });
    const result = expireQuery(query, 2000);
    expect(result.ok).toBe(false);
  });

  test("rejects verifying query", () => {
    const query = makeHtlcQuery({ status: "verifying", expires_at: 1000 });
    const result = expireQuery(query, 2000);
    expect(result.ok).toBe(false);
  });
});

// --- cancelQuery ---

describe("cancelQuery", () => {
  test("cancels pending query", () => {
    const query = makeQuery();
    const result = cancelQuery(query);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.status).toBe("rejected");
    expect(result.query.payment_status).toBe("cancelled");
  });

  test("cancels awaiting_quotes query", () => {
    const query = makeHtlcQuery();
    const result = cancelQuery(query);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.status).toBe("rejected");
  });

  test("cancels worker_selected query", () => {
    const query = makeQuery({ status: "worker_selected" });
    const result = cancelQuery(query);
    expect(result.ok).toBe(true);
  });

  test("cancels processing query", () => {
    const query = makeHtlcQuery({ status: "processing" });
    const result = cancelQuery(query);
    expect(result.ok).toBe(true);
  });

  test("rejects verifying query", () => {
    const query = makeHtlcQuery({ status: "verifying" });
    const result = cancelQuery(query);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("verifying");
  });

  test("rejects approved query", () => {
    const query = makeQuery({ status: "approved" });
    const result = cancelQuery(query);
    expect(result.ok).toBe(false);
  });

  test("rejects rejected query", () => {
    const query = makeQuery({ status: "rejected" });
    const result = cancelQuery(query);
    expect(result.ok).toBe(false);
  });

  test("rejects expired query", () => {
    const query = makeQuery({ status: "expired" });
    const result = cancelQuery(query);
    expect(result.ok).toBe(false);
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
    const result = addQuote(query, quote);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.quotes?.length).toBe(1);
    expect(result.query.quotes?.[0].worker_pubkey).toBe("worker1");
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
    const result = addQuote(query, quote);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.quotes?.length).toBe(2);
  });

  test("rejects non-HTLC query", () => {
    const query = makeQuery();
    const quote: QuoteInfo = { worker_pubkey: "w", quote_event_id: "e", received_at: Date.now() };
    const result = addQuote(query, quote);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("HTLC");
  });

  test("rejects when not awaiting_quotes", () => {
    const query = makeHtlcQuery({ status: "processing" });
    const quote: QuoteInfo = { worker_pubkey: "w", quote_event_id: "e", received_at: Date.now() };
    const result = addQuote(query, quote);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("processing");
  });

  test("rejects quote with empty worker_pubkey", () => {
    const query = makeHtlcQuery();
    const quote: QuoteInfo = { worker_pubkey: "", quote_event_id: "e", received_at: Date.now() };
    const result = addQuote(query, quote);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("worker_pubkey");
  });

  test("rejects quote with empty quote_event_id", () => {
    const query = makeHtlcQuery();
    const quote: QuoteInfo = { worker_pubkey: "w", quote_event_id: "", received_at: Date.now() };
    const result = addQuote(query, quote);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("quote_event_id");
  });
});

// --- HTLC: selectWorker ---

describe("selectWorker", () => {
  test("transitions awaiting_quotes → processing", () => {
    const query = makeHtlcQuery();
    const result = selectWorker(query, "worker_pub", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.status).toBe("processing");
    expect(result.query.htlc?.worker_pubkey).toBe("worker_pub");
  });

  test("sets escrow_token and payment_status on swap", () => {
    const query = makeHtlcQuery();
    const result = selectWorker(query, "worker_pub", { escrow_token: "tok123" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.htlc?.escrow_token).toBe("tok123");
    expect(result.query.payment_status).toBe("htlc_swapped");
  });

  test("preserves payment_status without escrow_token", () => {
    const query = makeHtlcQuery();
    const result = selectWorker(query, "worker_pub", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.payment_status).toBe("htlc_locked");
  });

  test("sets verified_escrow_sats", () => {
    const query = makeHtlcQuery();
    const result = selectWorker(query, "worker_pub", { verified_escrow_sats: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.htlc?.verified_escrow_sats).toBe(100);
  });

  test("rejects non-HTLC query", () => {
    const query = makeQuery();
    const result = selectWorker(query, "w", {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("HTLC");
  });

  test("rejects wrong state (processing)", () => {
    const query = makeHtlcQuery({ status: "processing" });
    const result = selectWorker(query, "w", {});
    expect(result.ok).toBe(false);
  });

  test("rejects wrong state (verifying)", () => {
    const query = makeHtlcQuery({ status: "verifying" });
    const result = selectWorker(query, "w", {});
    expect(result.ok).toBe(false);
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
    const result = recordResult(query, defaultResult, "worker1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.status).toBe("verifying");
    expect(result.query.result).toEqual(defaultResult);
    expect(result.query.submitted_at).toBeDefined();
  });

  test("allows submission when no worker_pubkey set", () => {
    const query = makeHtlcQuery({ status: "processing" });
    const result = recordResult(query, defaultResult, "any_worker");
    expect(result.ok).toBe(true);
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
    const result = recordResult(query, defaultResult, "wrong_worker");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("does not match");
  });

  test("sets blossom_keys", () => {
    const query = makeHtlcQuery({ status: "processing" });
    const keys = { att1: { encrypt_key: "k", encrypt_iv: "iv" } };
    const result = recordResult(query, defaultResult, "w", keys);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.blossom_keys).toEqual(keys);
  });

  test("rejects non-HTLC query", () => {
    const query = makeQuery({ status: "processing" });
    const result = recordResult(query, defaultResult, "w");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("HTLC");
  });

  test("rejects wrong state (awaiting_quotes)", () => {
    const query = makeHtlcQuery();
    const result = recordResult(query, defaultResult, "w");
    expect(result.ok).toBe(false);
  });

  test("rejects wrong state (verifying)", () => {
    const query = makeHtlcQuery({ status: "verifying" });
    const result = recordResult(query, defaultResult, "w");
    expect(result.ok).toBe(false);
  });
});

// --- HTLC: completeVerification ---

describe("completeVerification", () => {
  test("verifying → approved when passed", () => {
    const query = makeHtlcQuery({ status: "verifying" });
    const result = completeVerification(query, true, passedVerification, "oracle1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.status).toBe("approved");
    expect(result.query.payment_status).toBe("released");
    expect(result.query.assigned_oracle_id).toBe("oracle1");
  });

  test("verifying → rejected when not passed", () => {
    const query = makeHtlcQuery({ status: "verifying" });
    const result = completeVerification(query, false, failedVerification);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.status).toBe("rejected");
    expect(result.query.payment_status).toBe("cancelled");
  });

  test("stores verification detail", () => {
    const query = makeHtlcQuery({ status: "verifying" });
    const result = completeVerification(query, true, passedVerification);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.verification).toEqual(passedVerification);
  });

  test("stores attestations when quorum is set", () => {
    const query = makeHtlcQuery({ status: "verifying", quorum: { min_approvals: 2 } });
    const atts = [
      { oracle_id: "o1", passed: true, checks: [], failures: [], attested_at: Date.now() },
      { oracle_id: "o2", passed: true, checks: [], failures: [], attested_at: Date.now() },
    ];
    const result = completeVerification(query, true, passedVerification, undefined, atts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.attestations?.length).toBe(2);
  });

  test("derives oracle_id from attestations", () => {
    const query = makeHtlcQuery({ status: "verifying" });
    const atts = [{ oracle_id: "orc1", passed: true, checks: [], failures: [], attested_at: Date.now() }];
    const result = completeVerification(query, true, passedVerification, undefined, atts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.assigned_oracle_id).toBe("orc1");
  });

  test("rejects non-HTLC query", () => {
    const query = makeQuery({ status: "verifying" });
    const result = completeVerification(query, true, passedVerification);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("HTLC");
  });

  test("rejects wrong state (processing)", () => {
    const query = makeHtlcQuery({ status: "processing" });
    const result = completeVerification(query, true, passedVerification);
    expect(result.ok).toBe(false);
  });

  test("rejects wrong state (awaiting_quotes)", () => {
    const query = makeHtlcQuery();
    const result = completeVerification(query, true, passedVerification);
    expect(result.ok).toBe(false);
  });

  test("rejects already approved query", () => {
    const query = makeHtlcQuery({ status: "approved" });
    const result = completeVerification(query, true, passedVerification);
    expect(result.ok).toBe(false);
  });
});

// --- Full HTLC lifecycle ---

describe("HTLC full lifecycle", () => {
  test("awaiting_quotes → processing → verifying → approved", () => {
    // 1. Start
    const q0 = makeHtlcQuery();
    expect(q0.status).toBe("awaiting_quotes");

    // 2. Add quote
    const q1Result = addQuote(q0, {
      worker_pubkey: "w1",
      quote_event_id: "e1",
      received_at: Date.now(),
    });
    expect(q1Result.ok).toBe(true);
    if (!q1Result.ok) return;

    // 3. Select worker
    const q2Result = selectWorker(q1Result.query, "w1", {});
    expect(q2Result.ok).toBe(true);
    if (!q2Result.ok) return;
    expect(q2Result.query.status).toBe("processing");

    // 4. Record result
    const q3Result = recordResult(q2Result.query, defaultResult, "w1");
    expect(q3Result.ok).toBe(true);
    if (!q3Result.ok) return;
    expect(q3Result.query.status).toBe("verifying");

    // 5. Complete verification
    const q4Result = completeVerification(q3Result.query, true, passedVerification, "oracle1");
    expect(q4Result.ok).toBe(true);
    if (!q4Result.ok) return;
    expect(q4Result.query.status).toBe("approved");
    expect(q4Result.query.payment_status).toBe("released");
  });

  test("awaiting_quotes → processing → verifying → rejected", () => {
    const q0 = makeHtlcQuery();
    const q1 = addQuote(q0, { worker_pubkey: "w1", quote_event_id: "e1", received_at: Date.now() });
    if (!q1.ok) return;
    const q2 = selectWorker(q1.query, "w1", {});
    if (!q2.ok) return;
    const q3 = recordResult(q2.query, defaultResult, "w1");
    if (!q3.ok) return;
    const q4 = completeVerification(q3.query, false, failedVerification);
    expect(q4.ok).toBe(true);
    if (!q4.ok) return;
    expect(q4.query.status).toBe("rejected");
    expect(q4.query.payment_status).toBe("cancelled");
  });

  test("can expire at awaiting_quotes", () => {
    const q = makeHtlcQuery({ expires_at: 1000 });
    const result = expireQuery(q, 2000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.status).toBe("expired");
  });

  test("can expire at processing", () => {
    const q = makeHtlcQuery({ status: "processing", expires_at: 1000 });
    const result = expireQuery(q, 2000);
    expect(result.ok).toBe(true);
  });

  test("cannot expire at verifying", () => {
    const q = makeHtlcQuery({ status: "verifying", expires_at: 1000 });
    const result = expireQuery(q, 2000);
    expect(result.ok).toBe(false);
  });

  test("can cancel at awaiting_quotes", () => {
    const result = cancelQuery(makeHtlcQuery());
    expect(result.ok).toBe(true);
  });

  test("can cancel at processing", () => {
    const result = cancelQuery(makeHtlcQuery({ status: "processing" }));
    expect(result.ok).toBe(true);
  });

  test("cannot cancel at verifying", () => {
    const result = cancelQuery(makeHtlcQuery({ status: "verifying" }));
    expect(result.ok).toBe(false);
  });
});
