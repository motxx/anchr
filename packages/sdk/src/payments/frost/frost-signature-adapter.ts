/**
 * Production FrostSignaturePort adapter.
 *
 * Wires the application-layer FrostSignaturePort to coordinateSigning: it
 * derives the signing message from the query id, rebuilds the verification
 * requirement/evidence each peer re-checks independently, and runs the FROST
 * round-1/round-2 handshake across this node's configured peers. The
 * aggregated signature is returned as hex, or null when the threshold cannot
 * be reached.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  requestToRequirement,
  resultToVerificationInput,
} from "../../requests/application/query-verifier.ts";
import type { FrostSignaturePort } from "../../requests/application/ports.ts";
import type { FrostNodeConfig } from "./frost-config.ts";
import { coordinateSigning } from "./frost-signing-coordinator.ts";

export function createFrostSignatureAdapter(
  nodeConfig: FrostNodeConfig,
): FrostSignaturePort {
  return {
    async requestSignature(query, result, blossomKeys) {
      const messageHex = bytesToHex(
        sha256(new TextEncoder().encode(`anchr:sign:${query.id}`)),
      );
      const sigResult = await coordinateSigning(
        {
          nodeConfig,
          requirement: requestToRequirement(query),
          input: resultToVerificationInput(result),
          blossomKeys,
        },
        messageHex,
      );
      return sigResult?.signature ?? null;
    },
  };
}
