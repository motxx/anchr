/**
 * Shared protocol test helpers for HTLC query lifecycle tests.
 *
 * Used by protocol-attacks.test.ts, protocol-trustless.test.ts, protocol-exploits.test.ts.
 */

import { getEncodedToken, getDecodedToken } from "@cashu/cashu-ts";
import { createOracleRegistry } from "../infrastructure/oracle/registry";
import { createPreimageStore, type PreimageStore } from "../infrastructure/cashu/preimage-store";
import type { Oracle, OracleAttestation } from "../domain/oracle-types";
import type { EscrowProvider } from "../application/escrow-port";
import { createQueryService, createQueryStore } from "../application/query-service";
import type { Query, QueryResult } from "../domain/types";

/** Mock EscrowProvider that decodes Cashu tokens for amount verification in tests. */
export function createMockEscrowProvider(): EscrowProvider {
  return {
    async createHold() { return { escrow_ref: "mock_ref" }; },
    async bindWorker() { return { escrow_ref: "mock_ref_bound" }; },
    async verify(ref, expected_sats) {
      try {
        const decoded = getDecodedToken(ref);
        const total = decoded.proofs.reduce((sum, p) => sum + p.amount, 0);
        if (total < expected_sats) {
          return { valid: false, amount_sats: total, error: `Insufficient amount: got ${total}, expected ${expected_sats}` };
        }
        return { valid: true, amount_sats: total };
      } catch {
        return { valid: false, error: "Invalid token" };
      }
    },
    async verifyLock(ref, payment_hash, worker_pubkey) {
      try {
        const decoded = getDecodedToken(ref);
        for (const proof of decoded.proofs) {
          let secret: unknown;
          try { secret = JSON.parse(proof.secret); } catch { continue; }
          if (!Array.isArray(secret) || secret[0] !== "HTLC") continue;

          if (secret[1]?.data !== payment_hash) {
            return { ok: false, message: "HTLC hash mismatch: token hashlock does not match query" };
          }
          const tags: string[][] | undefined = secret[1]?.tags;
          const pubkeyTag = tags?.find((t: string[]) => t[0] === "pubkeys");
          if (pubkeyTag) {
            const lockedKeys = pubkeyTag.slice(1);
            const workerHex = worker_pubkey.startsWith("02") || worker_pubkey.startsWith("03")
              ? worker_pubkey : `02${worker_pubkey}`;
            if (!lockedKeys.includes(worker_pubkey) && !lockedKeys.includes(workerHex)) {
              return { ok: false, message: "HTLC token not locked to selected worker" };
            }
          }
        }
        return { ok: true };
      } catch {
        return { ok: true }; // Non-decodable tokens pass (backward compat)
      }
    },
    async settle() { return { settled: true }; },
    async cancel() { return { cancelled: true }; },
  };
}

/** Create a fake Cashu token string with the given amount. */
export function makeFakeToken(amountSats: number): string {
  return getEncodedToken({
    mint: "https://mint.example.com",
    proofs: [{ amount: amountSats, id: "test", secret: "s", C: "C" }],
  });
}

/** Create a mock Oracle with optional pass/fail function. */
export function makeMockOracle(
  id: string,
  passFn?: (query: Query, result: QueryResult) => boolean,
): Oracle {
  return {
    info: { id, name: `Mock ${id}`, fee_ppm: 0 },
    async verify(query: Query, result: QueryResult): Promise<OracleAttestation> {
      const passed = passFn ? passFn(query, result) : true;
      return {
        oracle_id: id,
        query_id: query.id,
        passed,
        checks: passed ? ["mock check passed"] : [],
        failures: passed ? [] : ["mock check failed"],
        attested_at: Date.now(),
      };
    },
  };
}

/** Create a QueryService with a fresh store, registry, and preimage store. */
export function makeServiceWithPreimage(opts?: { mockOracle?: Oracle; mockOracles?: Oracle[] }) {
  const store = createQueryStore();
  const registry = createOracleRegistry({ skipBuiltIn: true });
  if (opts?.mockOracles) {
    for (const o of opts.mockOracles) registry.register(o);
  } else {
    const oracle = opts?.mockOracle ?? makeMockOracle("test-oracle");
    registry.register(oracle);
  }
  const preimageStore = createPreimageStore();
  const escrowProvider = createMockEscrowProvider();
  return {
    service: createQueryService({
      store,
      oracleRegistry: registry,
      preimageStore,
      escrowProvider,
    }),
    store,
    registry,
    preimageStore,
  };
}

/** Generate an HTLC info object and corresponding preimage store entry. */
export function makeHtlcInfo(preimageStore: PreimageStore) {
  const entry = preimageStore.create();
  return {
    htlcInfo: {
      hash: entry.hash,
      oracle_pubkey: "oracle_pub",
      requester_pubkey: "requester_pub",
      locktime: Math.floor(Date.now() / 1000) + 3600,
    },
    entry,
  };
}

/** Drive query through: create -> quote -> select -> ready for result submission. */
export async function driveToProcessing(
  service: ReturnType<typeof createQueryService>,
  preimageStore: PreimageStore,
  opts?: { workerPubkey?: string; bountyAmount?: number; oracleIds?: string[]; quorum?: { min_approvals: number } },
) {
  const workerPub = opts?.workerPubkey ?? "worker_pub";
  const bounty = opts?.bountyAmount ?? 100;
  const oracleIds = opts?.oracleIds ?? ["test-oracle"];
  const { htlcInfo, entry } = makeHtlcInfo(preimageStore);
  const query = service.createQuery(
    { description: "Protocol test" },
    { htlc: htlcInfo, bounty: { amount_sats: bounty }, oracleIds, quorum: opts?.quorum },
  );
  service.recordQuote(query.id, {
    worker_pubkey: workerPub,
    quote_event_id: "evt_1",
    received_at: Date.now(),
  });
  const token = makeFakeToken(bounty);
  await service.selectWorker(query.id, workerPub, token);
  return { query, entry, workerPub, htlcInfo };
}

/**
 * Create a QueryService with multiple independent Oracle operators and quorum support.
 * This models the FROST threshold Oracle architecture where t-of-n neutral Oracles verify.
 */
export function makeQuorumService(opts: {
  oracleIds: string[];
  passFns?: Record<string, (q: Query, r: QueryResult) => boolean>;
}) {
  const store = createQueryStore();
  const registry = createOracleRegistry({ skipBuiltIn: true });
  for (const id of opts.oracleIds) {
    const passFn = opts.passFns?.[id];
    registry.register(makeMockOracle(id, passFn));
  }
  const preimageStore = createPreimageStore();
  const escrowProvider = createMockEscrowProvider();
  return {
    service: createQueryService({ store, oracleRegistry: registry, preimageStore, escrowProvider }),
    store,
    registry,
    preimageStore,
  };
}

/** Drive a quorum query through to processing. */
export async function driveQuorumToProcessing(
  service: ReturnType<typeof createQueryService>,
  preimageStore: PreimageStore,
  oracleIds: string[],
  minApprovals: number,
) {
  const workerPub = "worker_pub";
  const bounty = 100;
  const { htlcInfo, entry } = makeHtlcInfo(preimageStore);
  const query = service.createQuery(
    { description: "Quorum protocol test" },
    { htlc: htlcInfo, bounty: { amount_sats: bounty }, oracleIds, quorum: { min_approvals: minApprovals } },
  );
  service.recordQuote(query.id, { worker_pubkey: workerPub, quote_event_id: "evt_1", received_at: Date.now() });
  await service.selectWorker(query.id, workerPub, makeFakeToken(bounty));
  return { query, entry, workerPub, htlcInfo };
}
