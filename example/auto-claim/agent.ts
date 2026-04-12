/**
 * Auto-Claim Agent
 *
 * Runs on the user's device (CLI demo; browser extension in production).
 * Discovers insurance bounties, monitors target URLs, evaluates conditions
 * locally, and auto-submits TLSNotary proofs when a claim is triggered.
 *
 * The user installs the extension and browses normally.
 * When a claimable event occurs, proof is generated and submitted
 * without user action. Money they're already owed is auto-recovered.
 *
 * Usage:
 *   ANCHR_URL=http://localhost:3000 \
 *   deno run --allow-all --env example/auto-claim/agent.ts
 */

// Published package: import { Anchr } from "anchr-sdk";
import { Anchr } from "../../packages/sdk/src/index.ts";
import { spawn } from "../../src/runtime/mod.ts";

const SERVER_URL = Deno.env.get("ANCHR_URL") ?? "http://localhost:3000";
const VERIFIER_HOST = Deno.env.get("TLSN_VERIFIER_HOST") ?? "localhost:7046";
const CHECK_INTERVAL_MS = Number(Deno.env.get("CHECK_INTERVAL_MS") ?? "10000");
const USER_PUBKEY = Deno.env.get("USER_PUBKEY") ?? "user-auto-claim";

const anchr = new Anchr({ serverUrl: SERVER_URL });
const claimed = new Set<string>();  // successfully claimed
const attempted = new Set<string>(); // proof attempted (avoid retry spam)

// --- Local condition evaluation ---
// Mirrors server-side evaluateCondition() to avoid unnecessary proof generation.
// Only generate proof when conditions are locally confirmed.

interface Condition {
  type: string;
  expression: string;
  expected?: string;
  description?: string;
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
        details.push(`${ok ? "✓" : "✗"} contains "${cond.expression}"`);
        if (!ok) return { passed: false, details };
        break;
      }
      case "regex": {
        const match = new RegExp(cond.expression).exec(body);
        details.push(
          `${match ? "✓" : "✗"} regex → ${match ? match[0] : "no match"}`,
        );
        if (!match) return { passed: false, details };
        break;
      }
      case "jsonpath": {
        try {
          const obj = JSON.parse(body);
          const value = cond.expression
            .split(".")
            .reduce((o: Record<string, unknown>, k: string) => (o as Record<string, unknown>)?.[k] as Record<string, unknown>, obj);
          const actual = String(value);
          if (cond.expected !== undefined) {
            const ok = actual === cond.expected;
            details.push(
              `${ok ? "✓" : "✗"} ${cond.expression} = "${actual}" (expected "${cond.expected}")`,
            );
            if (!ok) return { passed: false, details };
          } else {
            details.push(`✓ ${cond.expression} = "${actual}"`);
          }
        } catch {
          details.push("✗ JSON parse failed");
          return { passed: false, details };
        }
        break;
      }
    }
  }

  return { passed: true, details };
}

// --- Proof generation ---

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
  try { await Deno.remove(outPath); } catch { /* ignore */ }
  return btoa(String.fromCharCode(...proofBytes));
}

// --- Display helpers ---

function formatFlight(body: string): string {
  try {
    const d = JSON.parse(body);
    if (d.flight) {
      return `${d.flight} → ${d.status}${d.delay_minutes > 0 ? ` (${d.delay_minutes} min delay)` : ""}`;
    }
  } catch { /* not flight JSON */ }
  return "";
}

// --- Main loop ---

console.log("=== Auto-Claim Agent ===\n");
console.log(`Server:         ${SERVER_URL}`);
console.log(`Check interval: ${CHECK_INTERVAL_MS / 1000}s`);
console.log(`\nScanning for claimable bounties...\n`);

while (true) {
  try {
    const queries = await anchr.listOpenQueries();
    const policies = queries.filter((q) =>
      q.description.startsWith("Auto-claim:")
    );

    if (policies.length === 0) {
      console.log(`[${new Date().toISOString()}] No active policies found`);
    }

    for (const policy of policies) {
      if (claimed.has(policy.id) || attempted.has(policy.id)) continue;

      const reqs = policy.tlsn_requirements as {
        target_url: string;
        conditions?: Condition[];
      } | undefined;

      if (!reqs?.target_url) continue;

      // 1. Fetch target (lightweight, no proof yet)
      let body: string;
      try {
        const resp = await fetch(reqs.target_url);
        body = await resp.text();
      } catch (err) {
        console.log(
          `[${new Date().toISOString()}] Fetch error: ${err}`,
        );
        continue;
      }

      // 2. Evaluate conditions locally
      const conditions = reqs.conditions ?? [];
      const { passed, details } = evaluateLocally(body, conditions);
      const display = formatFlight(body) || reqs.target_url;

      if (!passed) {
        console.log(
          `[${new Date().toISOString()}] ${display} — no claim`,
        );
        continue;
      }

      // 3. Conditions met — claim!
      console.log(
        `\n[${new Date().toISOString()}] ${display} — CLAIM TRIGGERED!`,
      );
      for (const d of details) console.log(`  ${d}`);
      console.log(`  Bounty: ${policy.bounty?.amount_sats ?? 0} sats`);

      // 4. Generate TLSNotary proof and submit
      try {
        console.log("  Generating TLSNotary proof...");
        const proof = await generateProof(reqs.target_url);
        console.log("  Submitting claim...");
        const result = await anchr.submitPresentation(
          policy.id,
          proof,
          USER_PUBKEY,
        );
        if (result.ok) {
          console.log(`  ✓ Claim accepted! ${result.message}`);
          claimed.add(policy.id);
        } else {
          console.log(`  ✗ Claim rejected: ${result.message}`);
        }
      } catch (err) {
        console.log(`  ✗ Proof generation failed: ${err}`);
        console.log(
          "  (In production, the browser extension handles this automatically)",
        );
        attempted.add(policy.id);
      }
      console.log();
    }
  } catch (err) {
    console.error(`Error: ${err}`);
  }

  await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
}
