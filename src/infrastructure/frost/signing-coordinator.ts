/**
 * FROST signing coordinator — orchestrates distributed signing across peer Oracle nodes.
 *
 * Called when an Oracle verifies a query result and needs a FROST group signature.
 * Coordinates 2-round signing protocol via HTTP calls to peer signers.
 */

import type { FrostNodeConfig, PeerConfig } from "./config.ts";
import { signRound1, signRound2, aggregateSignatures } from "./frost-cli.ts";

export interface SigningCoordinatorConfig {
  /** This node's FROST config. */
  nodeConfig: FrostNodeConfig;
  /** Timeout for HTTP calls to peers (ms). */
  peerTimeoutMs?: number;
}

export interface SigningCoordinatorResult {
  signature: string;
  signers_participated: number[];
}

/**
 * Coordinate a FROST signing session across peer Oracle nodes.
 *
 * 1. This node + peers run sign-round1 → collect nonce commitments
 * 2. This node + peers run sign-round2 with all commitments → collect shares
 * 3. Aggregate shares into BIP-340 Schnorr signature
 */
export async function coordinateSigning(
  config: SigningCoordinatorConfig,
  messageHex: string,
): Promise<SigningCoordinatorResult | null> {
  const { nodeConfig } = config;
  const timeoutMs = config.peerTimeoutMs ?? 10_000;
  const keyPackageJson = JSON.stringify(nodeConfig.key_package);
  const pubkeyPackageJson = JSON.stringify(nodeConfig.pubkey_package);

  // --- Round 1: collect nonce commitments ---

  // This node's round 1
  const localR1 = await signRound1(keyPackageJson);
  if (!localR1.ok || !localR1.data) {
    console.error("[frost-coord] Local sign-round1 failed:", localR1.error);
    return null;
  }

  // Determine this node's FROST identifier (matches DKG index format)
  const localIdentifier = identifierFromIndex(nodeConfig.signer_index);

  // Collect commitments: start with local
  const commitments: Record<string, unknown> = {};
  commitments[localIdentifier] = localR1.data.commitments;
  const localNonces = JSON.stringify(localR1.data.nonces);

  const participatingPeers: PeerConfig[] = [];

  // Call peers for round 1
  for (const peer of nodeConfig.peers) {
    if (peer.signer_index === nodeConfig.signer_index) continue;

    try {
      const res = await fetchWithTimeout(
        `${peer.endpoint}/frost/signer/round1`,
        {
          method: "POST",
          headers: buildHeaders(peer.api_key),
          body: JSON.stringify({ message: messageHex }),
        },
        timeoutMs,
      );

      if (!res.ok) {
        console.error(`[frost-coord] Peer ${peer.signer_index} round1 failed: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const peerId = identifierFromIndex(peer.signer_index);
      commitments[peerId] = data.commitments;
      participatingPeers.push(peer);
    } catch (err) {
      console.error(`[frost-coord] Peer ${peer.signer_index} round1 error:`, err instanceof Error ? err.message : err);
    }

    // Stop once we have enough (threshold)
    if (Object.keys(commitments).length >= nodeConfig.threshold) break;
  }

  if (Object.keys(commitments).length < nodeConfig.threshold) {
    console.error(`[frost-coord] Only ${Object.keys(commitments).length}/${nodeConfig.threshold} commitments — below threshold`);
    return null;
  }

  const commitmentsJson = JSON.stringify(commitments);

  // --- Round 2: collect signature shares ---

  const shares: Record<string, unknown> = {};

  // This node's round 2
  const localR2 = await signRound2(keyPackageJson, localNonces, commitmentsJson, messageHex);
  if (!localR2.ok || !localR2.data) {
    console.error("[frost-coord] Local sign-round2 failed:", localR2.error);
    return null;
  }
  shares[localIdentifier] = localR2.data.signature_share;

  // Call participating peers for round 2
  for (const peer of participatingPeers) {
    try {
      const res = await fetchWithTimeout(
        `${peer.endpoint}/frost/signer/round2`,
        {
          method: "POST",
          headers: buildHeaders(peer.api_key),
          body: JSON.stringify({
            commitments: commitmentsJson,
            message: messageHex,
          }),
        },
        timeoutMs,
      );

      if (!res.ok) {
        console.error(`[frost-coord] Peer ${peer.signer_index} round2 failed: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const peerId = identifierFromIndex(peer.signer_index);
      shares[peerId] = data.signature_share;
    } catch (err) {
      console.error(`[frost-coord] Peer ${peer.signer_index} round2 error:`, err instanceof Error ? err.message : err);
    }
  }

  if (Object.keys(shares).length < nodeConfig.threshold) {
    console.error(`[frost-coord] Only ${Object.keys(shares).length}/${nodeConfig.threshold} shares — below threshold`);
    return null;
  }

  // --- Aggregate ---

  const agg = await aggregateSignatures(
    nodeConfig.group_pubkey,
    commitmentsJson,
    messageHex,
    JSON.stringify(shares),
    pubkeyPackageJson,
  );

  if (!agg.ok || !agg.data?.signature) {
    console.error("[frost-coord] Aggregation failed:", agg.error);
    return null;
  }

  const participated = [nodeConfig.signer_index, ...participatingPeers.map(p => p.signer_index)];
  return {
    signature: agg.data.signature as string,
    signers_participated: participated,
  };
}

/**
 * Convert a 1-based signer index to the FROST Identifier format.
 * frost-secp256k1-tr serializes Identifier as a 32-byte hex-encoded scalar.
 */
function identifierFromIndex(index: number): string {
  // FROST Identifier is a 32-byte big-endian scalar
  return index.toString(16).padStart(64, "0");
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) h["x-api-key"] = apiKey;
  return h;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
