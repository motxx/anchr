import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  createCustomer,
  CustomerConfigError,
  generateQueryId,
  OracleWhitelistMismatchError,
  pickOracleForRequest,
  selectCheapestQuote,
  validateCustomerOptions,
} from "./customer.ts";
import { CashuMintError } from "./cashu.ts";
import { InvalidSchemaUriError } from "./schema.ts";
import type { OracleClient } from "./oracle.ts";
import type {
  BindProviderParams,
  BuildHtlcLockParams,
  CashuClient,
  CashuToken,
  RedeemHtlcParams,
  RedeemResult,
} from "./cashu.ts";
import type { CustomerOptions, Quote } from "./types.ts";

// --- Test doubles ---

const ORACLE_A = "a".repeat(64);
const ORACLE_B = "b".repeat(64);
const HASH_HEX = "deadbeef".repeat(8);

function makeOracleClient(overrides?: Partial<OracleClient> & { fixedOracle?: string; fixedHash?: string }): OracleClient {
  return {
    requestHash: overrides?.requestHash ?? (
      async (_queryId: string) => ({
        hash: overrides?.fixedHash ?? HASH_HEX,
        oraclePubkey: overrides?.fixedOracle ?? ORACLE_A,
      })
    ),
  };
}

function makeCashuClient(overrides?: Partial<CashuClient>): CashuClient {
  return {
    mintUrl: overrides?.mintUrl ?? "https://mint.example.org",
    buildHtlcLock: overrides?.buildHtlcLock ?? (
      async (_p: BuildHtlcLockParams): Promise<CashuToken> => ({
        token: "cashuBfake",
        amountSats: _p.amountSats,
        proofs: [],
      })
    ),
    bindProvider: overrides?.bindProvider ?? (
      async (_p: BindProviderParams): Promise<CashuToken> => ({
        token: "cashuBbound",
        amountSats: 0,
        proofs: [],
      })
    ),
    redeemHtlc: overrides?.redeemHtlc ?? (
      async (_p: RedeemHtlcParams): Promise<RedeemResult> => ({
        proofs: [],
        amountSats: 0,
      })
    ),
  };
}

const validOptions = (): CustomerOptions => ({
  oracles: [ORACLE_A, ORACLE_B],
  relays: ["wss://relay.example.org"],
  mint: "https://mint.example.org",
  oracleClient: makeOracleClient(),
  cashuClient: makeCashuClient(),
});

// --- Validation ---

test("validateCustomerOptions accepts a well-formed options object", () => {
  expect(() => validateCustomerOptions(validOptions())).not.toThrow();
});

test("validateCustomerOptions rejects empty oracles array", () => {
  expect(() => validateCustomerOptions({ ...validOptions(), oracles: [] }))
    .toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects empty oracle entries", () => {
  expect(() => validateCustomerOptions({ ...validOptions(), oracles: [""] }))
    .toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects empty relays array", () => {
  expect(() => validateCustomerOptions({ ...validOptions(), relays: [] }))
    .toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects missing mint", () => {
  expect(() => validateCustomerOptions({ ...validOptions(), mint: "" }))
    .toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects missing oracleClient", () => {
  const opts: Record<string, unknown> = { ...validOptions() };
  delete opts.oracleClient;
  expect(() => validateCustomerOptions(opts)).toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects missing cashuClient", () => {
  const opts: Record<string, unknown> = { ...validOptions() };
  delete opts.cashuClient;
  expect(() => validateCustomerOptions(opts)).toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects a non-object input", () => {
  expect(() => validateCustomerOptions(null)).toThrow(CustomerConfigError);
  expect(() => validateCustomerOptions(42)).toThrow(CustomerConfigError);
  expect(() => validateCustomerOptions("string")).toThrow(CustomerConfigError);
});

// --- Constructor ---

test("createCustomer exposes oracles / relays / mint as readonly copies", () => {
  const opts = validOptions();
  const customer = createCustomer(opts);
  expect([...customer.oracles]).toEqual(opts.oracles);
  expect([...customer.relays]).toEqual(opts.relays);
  expect(customer.mint).toEqual(opts.mint);
});

test("createCustomer copies arrays so mutating the original does not affect the client", () => {
  const oracles = [ORACLE_A, ORACLE_B];
  const customer = createCustomer({ ...validOptions(), oracles });
  oracles.push("c".repeat(64));
  expect(customer.oracles).toHaveLength(2);
});

// --- Request flow ---

test("Customer.request rejects an invalid schema URI synchronously", async () => {
  const customer = createCustomer(validOptions());
  await expect(
    customer.request({
      spec: { schema: "not-a-valid-uri", predicate: {} },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(InvalidSchemaUriError);
});

test("Customer.request rejects non-positive maxAmount", async () => {
  const customer = createCustomer(validOptions());
  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 0 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(CustomerConfigError);
});

test("Customer.request calls oracleClient.requestHash", async () => {
  let receivedQueryId = "";
  const oracleClient = makeOracleClient({
    requestHash: async (queryId: string) => {
      receivedQueryId = queryId;
      return { hash: HASH_HEX, oraclePubkey: ORACLE_A };
    },
  });
  const customer = createCustomer({ ...validOptions(), oracleClient });

  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(); // wire flow continues but later steps not impl

  expect(receivedQueryId).toMatch(/^query_\d+_[a-z0-9]+$/);
});

test("Customer.request rejects when oracleClient returns a pubkey not matching the picked oracle", async () => {
  const oracleClient = makeOracleClient({ fixedOracle: ORACLE_B });
  // Customer's whitelist[0] is ORACLE_A; oracleClient claims to be ORACLE_B.
  const customer = createCustomer({
    ...validOptions(),
    oracles: [ORACLE_A],
    oracleClient,
  });

  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(OracleWhitelistMismatchError);
});

test("Customer.request calls cashuClient.buildHtlcLock with the oracle hash", async () => {
  // Wrapper object — TypeScript narrows property access through closures
  // more reliably than free `let` variables (which get stuck on the
  // initial-assignment type).
  const recorder: { params: BuildHtlcLockParams | null } = { params: null };
  const cashuClient = makeCashuClient({
    buildHtlcLock: async (params: BuildHtlcLockParams): Promise<CashuToken> => {
      recorder.params = params;
      return { token: "cashuBlocked", amountSats: params.amountSats, proofs: [] };
    },
  });
  const customer = createCustomer({ ...validOptions(), cashuClient });

  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 1234 },
      sourceProofs: [{ id: "proof1" }],
    }),
  ).rejects.toThrow(); // wire flow continues but later steps not impl

  expect(recorder.params).not.toBe(null);
  if (recorder.params === null) throw new Error("unreachable");
  expect(recorder.params.amountSats).toBe(1234);
  expect(recorder.params.hashHex).toBe(HASH_HEX);
  expect(recorder.params.customerPubkey).toMatch(/^[0-9a-f]{64}$/);
  expect(recorder.params.locktimeSeconds).toBeGreaterThan(Math.floor(Date.now() / 1000));
  expect(recorder.params.sourceProofs).toHaveLength(1);
});

test("Customer.request propagates CashuMintError from buildHtlcLock", async () => {
  const cashuClient = makeCashuClient({
    buildHtlcLock: () => Promise.reject(new CashuMintError("simulated mint failure")),
  });
  const customer = createCustomer({ ...validOptions(), cashuClient });

  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(CashuMintError);
});

test("Customer.request reaches the not-implemented marker for steps 5-11 when prior steps succeed", async () => {
  const customer = createCustomer(validOptions());
  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: { foo: "bar" } },
      payment: { maxAmount: 1000 },
      sourceProofs: [],
    }),
  ).rejects.toThrow(/wire flow steps 5-11 not implemented/);
});

// --- Pure helpers ---

test("pickOracleForRequest returns the first oracle by default (v0)", () => {
  expect(pickOracleForRequest([ORACLE_A, ORACLE_B])).toBe(ORACLE_A);
});

test("pickOracleForRequest throws on empty whitelist", () => {
  expect(() => pickOracleForRequest([])).toThrow(CustomerConfigError);
});

test("selectCheapestQuote returns null on empty input", () => {
  expect(selectCheapestQuote([])).toBe(null);
});

test("selectCheapestQuote picks the lowest amount", () => {
  const quotes: Quote[] = [
    { providerPubkey: "a", amountSats: 1000, quoteEventId: "ea", receivedAt: 1 },
    { providerPubkey: "b", amountSats: 500, quoteEventId: "eb", receivedAt: 2 },
    { providerPubkey: "c", amountSats: 750, quoteEventId: "ec", receivedAt: 3 },
  ];
  expect(selectCheapestQuote(quotes)?.providerPubkey).toBe("b");
});

test("generateQueryId produces unique identifiers", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 50; i++) ids.add(generateQueryId());
  expect(ids.size).toBe(50);
});

test("generateQueryId follows the documented shape", () => {
  expect(generateQueryId()).toMatch(/^query_\d+_[a-z0-9]+$/);
});
