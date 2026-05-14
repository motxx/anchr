/**
 * Auto-Claim Agent - User / Provider
 *
 * Runs on the user's device. It listens for NIP-90 job requests over Nostr,
 * offers on auto-claim predicates it can satisfy, then waits until the
 * predicate becomes true before generating a TLSNotary proof.
 *
 * There is no Anchr server in this flow. The only long-running process here is
 * the Provider itself, because it must receive requests and produce proofs.
 *
 * Usage:
 *   NOSTR_RELAYS=ws://localhost:7777 \
 *   CASHU_MINT_URL=http://localhost:3338 \
 *   ORACLE_PUBKEY=<oracle-pubkey-hex-or-npub> \
 *   AUTO_CLAIM_PROVIDER_PRIVKEY=<provider-nsec-or-hex> \
 *   deno run --allow-env --allow-net --allow-read --allow-write --allow-run --env example/auto-claim/agent.ts
 */

import {
  createCashuClient,
  createProvider,
  createRelayClient,
  DEFINED_SCHEMAS,
  type ProviderRequestEvent,
} from "anchr-sdk";
import { spawn } from "@anchr/core-runtime";

const relays = listEnv("NOSTR_RELAYS", ["ws://localhost:7777"]);
const mint = requiredEnv("CASHU_MINT_URL");
const oraclePubkey = requiredEnv("ORACLE_PUBKEY");
const privKey = requiredEnv("AUTO_CLAIM_PROVIDER_PRIVKEY");

const VERIFIER_HOST = Deno.env.get("TLSN_VERIFIER_HOST") ?? "localhost:7046";
const CHECK_INTERVAL_MS = Number(Deno.env.get("CHECK_INTERVAL_MS") ?? "10000");
const PRODUCE_TIMEOUT_MS = Number(
  Deno.env.get("PRODUCE_TIMEOUT_MS") ?? "3600000",
);
const OFFER_SATS = Number(Deno.env.get("AUTO_CLAIM_OFFER_SATS") ?? "10000");

interface Condition {
  type: string;
  expression: string;
  expected?: string;
  description?: string;
}

interface TlsnPredicate {
  targetUrl: string;
  conditions?: Condition[];
  maxAttestationAgeSeconds?: number;
}

const provider = createProvider({
  oracles: [oraclePubkey],
  relays,
  mint,
  privKey,
  cashuClient: createCashuClient({ mintUrl: mint }),
  relayClient: createRelayClient(relays),
  notary: Deno.env.get("TLSN_NOTARY_URL") ?? undefined,
  selectionTimeoutMs: Number(Deno.env.get("SELECTION_TIMEOUT_MS") ?? "120000"),
  preimageTimeoutMs: Number(Deno.env.get("PREIMAGE_TIMEOUT_MS") ?? "300000"),
});

console.log("=== Auto-Claim Agent / Provider ===\n");
console.log(`Provider: ${provider.pubkey}`);
console.log(`Relays:   ${relays.join(", ")}`);
console.log(`Mint:     ${mint}`);
console.log(`Oracle:   ${oraclePubkey}`);
console.log(`Verifier: ${VERIFIER_HOST}`);
console.log("\nListening for auto-claim requests...\n");

const stop = () => {
  void provider.stop();
};
Deno.addSignalListener("SIGINT", stop);
Deno.addSignalListener("SIGTERM", stop);

await provider.serve(async (request: ProviderRequestEvent) => {
  if (request.spec.schema !== DEFINED_SCHEMAS.TLSN_HTTPS_V1) return null;
  const predicate = parsePredicate(request.spec.predicate);
  if (!predicate) return null;
  if (!request.spec.description?.startsWith("Auto-claim:")) return null;

  console.log(`Matched request from ${request.customerPubkey}`);
  console.log(`  Target: ${predicate.targetUrl}`);
  console.log(`  Offer:  ${Math.min(OFFER_SATS, request.maxAmountSats)} sats`);

  return {
    amountSats: Math.min(OFFER_SATS, request.maxAmountSats),
    produce: async () => {
      const observed = await waitForTriggeredPredicate(predicate);
      console.log("  Generating TLSNotary proof...");
      const proof = await generateProof(predicate.targetUrl);
      return {
        data: {
          targetUrl: predicate.targetUrl,
          observedAt: new Date().toISOString(),
          body: observed.body,
          checks: observed.details,
        },
        proof,
      };
    },
  };
});

function parsePredicate(value: unknown): TlsnPredicate | null {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  if (typeof p.targetUrl !== "string") return null;
  const conditions = Array.isArray(p.conditions)
    ? p.conditions.filter(isCondition)
    : [];
  return {
    targetUrl: p.targetUrl,
    conditions,
    maxAttestationAgeSeconds: typeof p.maxAttestationAgeSeconds === "number"
      ? p.maxAttestationAgeSeconds
      : undefined,
  };
}

function isCondition(value: unknown): value is Condition {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return typeof c.type === "string" && typeof c.expression === "string";
}

function evaluateLocally(
  body: string,
  conditions: Condition[],
): { passed: boolean; details: string[] } {
  const details: string[] = [];

  for (const cond of conditions) {
    switch (cond.type) {
      case "contains": {
        const ok = body.includes(cond.expression);
        details.push(`${ok ? "ok" : "fail"} contains "${cond.expression}"`);
        if (!ok) return { passed: false, details };
        break;
      }
      case "regex": {
        const match = new RegExp(cond.expression).exec(body);
        details.push(`${match ? "ok" : "fail"} regex ${cond.expression}`);
        if (!match) return { passed: false, details };
        break;
      }
      case "jsonpath": {
        try {
          const obj = JSON.parse(body);
          const value = cond.expression
            .split(".")
            .reduce(
              (o: unknown, k: string) =>
                typeof o === "object" && o !== null
                  ? (o as Record<string, unknown>)[k]
                  : undefined,
              obj,
            );
          const actual = String(value);
          if (cond.expected !== undefined) {
            const ok = actual === cond.expected;
            details.push(
              `${
                ok ? "ok" : "fail"
              } ${cond.expression}=${actual} expected=${cond.expected}`,
            );
            if (!ok) return { passed: false, details };
          } else {
            details.push(`ok ${cond.expression}=${actual}`);
          }
        } catch {
          details.push("fail JSON parse");
          return { passed: false, details };
        }
        break;
      }
      default:
        details.push(`fail unsupported condition ${cond.type}`);
        return { passed: false, details };
    }
  }

  return { passed: true, details };
}

async function waitForTriggeredPredicate(
  predicate: TlsnPredicate,
): Promise<{ body: string; details: string[] }> {
  const deadline = Date.now() + PRODUCE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let body: string;
    try {
      const resp = await fetch(predicate.targetUrl);
      body = await resp.text();
    } catch (err) {
      console.log(`  Fetch failed: ${err}`);
      await delay(CHECK_INTERVAL_MS);
      continue;
    }

    const evaluated = evaluateLocally(body, predicate.conditions ?? []);
    if (evaluated.passed) {
      console.log("  Predicate triggered.");
      return { body, details: evaluated.details };
    }

    console.log(`  No claim yet (${new Date().toISOString()})`);
    await delay(CHECK_INTERVAL_MS);
  }
  throw new Error("Predicate did not trigger before produce timeout");
}

async function generateProof(targetUrl: string): Promise<string> {
  const outPath = `/tmp/auto-claim-proof-${Date.now()}.tlsn`;
  const proc = spawn(
    ["tlsn-prove", "--verifier", VERIFIER_HOST, targetUrl, "-o", outPath],
    { stdout: "pipe", stderr: "pipe" },
  );
  await proc.exited;
  if (proc.exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`tlsn-prove failed: ${stderr}`);
  }
  const proofBytes = await Deno.readFile(outPath);
  try {
    await Deno.remove(outPath);
  } catch {
    // best-effort cleanup
  }
  return base64Encode(proofBytes);
}

function base64Encode(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return btoa(out);
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function listEnv(name: string, fallback: string[]): string[] {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return fallback;
  return raw.split(",").map((v) => v.trim()).filter(Boolean);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
