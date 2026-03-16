import { expect, test, describe } from "bun:test";
import {
  buildHtlcInitialOptions,
  buildHtlcFinalOptions,
} from "./escrow";

const WORKER_PUB = "0000000000000000000000000000000000000000000000000000000000000001";
const REQUESTER_PUB = "0000000000000000000000000000000000000000000000000000000000000002";
const HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("HTLC escrow (NUT-14)", () => {
  test("buildHtlcInitialOptions returns null (Phase 1 uses plain proofs)", () => {
    const opts = buildHtlcInitialOptions({
      hash: HASH,
      requesterPubkey: REQUESTER_PUB,
      locktimeSeconds: 1700000000,
    });

    // Phase 1: no conditions — plain proofs held locally
    expect(opts).toBeNull();
  });

  test("buildHtlcFinalOptions creates hashlock + P2PK(Worker) for Phase 2", () => {
    const opts = buildHtlcFinalOptions({
      hash: HASH,
      workerPubkey: WORKER_PUB,
      requesterRefundPubkey: REQUESTER_PUB,
      locktimeSeconds: 1700000000,
    });

    // Phase 2: HTLC with hashlock + Worker lock
    expect(opts.hashlock).toBe(HASH);
    expect(opts.locktime).toBe(1700000000);
    expect(opts.sigFlag).toBe("SIG_ALL");
    const pubkeys = Array.isArray(opts.pubkey) ? opts.pubkey : [opts.pubkey];
    expect(pubkeys).toContain(`02${WORKER_PUB}`);
    const refundKeys = Array.isArray(opts.refundKeys) ? opts.refundKeys : [opts.refundKeys];
    expect(refundKeys).toContain(`02${REQUESTER_PUB}`);
  });

  test("Phase 1 is plain, Phase 2 adds HTLC conditions", () => {
    const initial = buildHtlcInitialOptions({
      hash: HASH,
      requesterPubkey: REQUESTER_PUB,
      locktimeSeconds: 1700000000,
    });
    const final = buildHtlcFinalOptions({
      hash: HASH,
      workerPubkey: WORKER_PUB,
      requesterRefundPubkey: REQUESTER_PUB,
      locktimeSeconds: 1700000000,
    });

    // Phase 1: no conditions
    expect(initial).toBeNull();

    // Phase 2: hashlock + Worker lock
    expect(final.hashlock).toBe(HASH);
    const finalPubkeys = Array.isArray(final.pubkey) ? final.pubkey : [final.pubkey];
    expect(finalPubkeys).toContain(`02${WORKER_PUB}`);
  });
});
