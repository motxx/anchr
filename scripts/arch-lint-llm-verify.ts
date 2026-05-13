#!/usr/bin/env -S deno run --allow-read --allow-run --allow-env
/**
 * arch-lint-llm-verify — pre-ship verification hook.
 *
 * Runs as a Claude Code PreToolUse hook for Bash commands. When the
 * command is a "shipping" action (`git push`, `gh pr create`), the hook:
 *
 *   1. Computes the set of in-scope files in the current branch's diff
 *      (TypeScript under `src/(domain|application|infrastructure|ui)/`
 *      or `packages/<pkg>/src/`, ≥150 lines).
 *   2. Hashes the contents of those files (SHA-256 of the concatenated
 *      diff). The hash uniquely identifies "this exact set of changes".
 *   3. Reads `.arch-lint-llm-verified.json` at the repo root, which the
 *      arch-lint-llm skill writes after a clean review.
 *   4. If the stored hash matches → allow. The reviewed diff is
 *      exactly what is being shipped.
 *   5. If the hash differs (or no record exists) → deny with a list
 *      of the files needing review.
 *
 * Why diff-content hashing rather than a time-window marker:
 *   - A "fresh within N minutes" window lets unreviewed edits ride
 *     along after a stale review. Hashing the diff binds the
 *     verification to *the exact change set being shipped*: any new
 *     edit invalidates the record automatically.
 *
 * Why per-repo state rather than a global marker:
 *   - Multi-repo workflows. A review of repo A should not vouch for
 *     a push from repo B.
 *
 * Out of scope by design:
 *   - Local commits / staging. The hook only fires on commands that
 *     leave the local workspace.
 *   - Files under 150 lines. Cohesion / SRP / domain-leakage smells
 *     need substance; small files are usually one-purpose helpers
 *     where these patterns do not manifest.
 *   - Test files, type defs, scripts, examples, dist.
 *
 * Configuration (via env vars):
 *   - `ARCH_BASE`     — base ref to diff against (default: `origin/main`)
 *   - `ARCH_RECORD`   — path to the verification record (default:
 *                       `<repo>/.arch-lint-llm-verified.json`)
 *
 * Hook payload (stdin JSON):
 *   { "tool_name": "Bash", "tool_input": { "command": "..." } }
 *
 * Hook output (stdout JSON):
 *   PreToolUse hookSpecificOutput with permissionDecision when denying,
 *   or additionalContext acknowledging when allowing. Silent (exit 0
 *   with empty stdout) when out of scope.
 */

const SHIPPING_VERBS = [
  { head: "git", arg: "push" },
  { head: "gh", arg: "pr" },
] as const;

const IN_SCOPE_RE =
  /^(src\/(domain|application|infrastructure|ui)|packages\/[^/]+\/src)\/.+\.(ts|tsx)$/;

const MIN_LINES = 150;

interface HookInput {
  tool_name?: string;
  tool_input?: { command?: string };
}

interface VerificationRecord {
  diff_sha256: string;
  reviewed_at: string;
  files: string[];
}

// ── Command parsing ────────────────────────────────────────────────

function commandSegments(command: string): string[] {
  const out: string[] = [];
  const buf: string[] = [];
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1] ?? "";
    if ((c === "&" && next === "&") || (c === "|" && next === "|")) {
      out.push(buf.join(""));
      buf.length = 0;
      i++;
      continue;
    }
    if (c === ";" || c === "|" || c === "\n") {
      out.push(buf.join(""));
      buf.length = 0;
      continue;
    }
    buf.push(c);
  }
  out.push(buf.join(""));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

function extractHead(segment: string): { head: string; args: string[] } {
  const tokens = segment.split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    const eq = tok.indexOf("=");
    if (eq > 0) {
      const name = tok.slice(0, eq);
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        i++;
        continue;
      }
    }
    break;
  }
  if (i >= tokens.length) return { head: "", args: [] };
  const head = tokens[i].split("/").pop() ?? tokens[i];
  return { head, args: tokens.slice(i + 1) };
}

export function isShippingCommand(command: string): boolean {
  for (const seg of commandSegments(command)) {
    const { head, args } = extractHead(seg);
    if (!head) continue;
    for (const verb of SHIPPING_VERBS) {
      if (head === verb.head && args[0] === verb.arg) return true;
    }
  }
  return false;
}

// ── Diff scope ─────────────────────────────────────────────────────

async function runGit(args: string[]): Promise<{ ok: boolean; out: string }> {
  const cmd = new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout } = await cmd.output();
  return { ok: code === 0, out: new TextDecoder().decode(stdout) };
}

async function inScopeChangedFiles(base: string): Promise<string[]> {
  const r = await runGit(["diff", "--name-only", `${base}...HEAD`]);
  if (!r.ok) return [];
  const files = r.out.split("\n").map((s) => s.trim()).filter(Boolean);
  const inScope: string[] = [];
  for (const f of files) {
    if (!IN_SCOPE_RE.test(f)) continue;
    if (
      f.endsWith(".test.ts") || f.endsWith(".test.tsx") || f.endsWith(".d.ts")
    ) {
      continue;
    }
    try {
      const text = await Deno.readTextFile(f);
      const lines = text.split("\n").length;
      if (lines >= MIN_LINES) inScope.push(f);
    } catch {
      // file deleted in HEAD; harmless, skip
    }
  }
  inScope.sort();
  return inScope;
}

async function diffHash(base: string, files: string[]): Promise<string> {
  if (files.length === 0) return "";
  const r = await runGit(["diff", `${base}...HEAD`, "--", ...files]);
  if (!r.ok) return "";
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(r.out),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Record I/O ─────────────────────────────────────────────────────

async function readRecord(path: string): Promise<VerificationRecord | null> {
  try {
    const raw = await Deno.readTextFile(path);
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.diff_sha256 === "string" &&
      typeof parsed?.reviewed_at === "string" &&
      Array.isArray(parsed?.files)
    ) {
      return parsed as VerificationRecord;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Hook output ────────────────────────────────────────────────────

function emitDeny(reason: string): void {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
}

function emitAllow(message: string): void {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: message,
    },
  }));
}

// ── Entry ──────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  const buf = new Uint8Array(4096);
  while (true) {
    const n = await Deno.stdin.read(buf);
    if (n === null) break;
    chunks.push(buf.slice(0, n));
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(out);
}

async function repoRoot(): Promise<string> {
  const r = await runGit(["rev-parse", "--show-toplevel"]);
  return r.ok ? r.out.trim() : Deno.cwd();
}

if (import.meta.main) {
  const raw = await readStdin();
  let payload: HookInput;
  try {
    payload = JSON.parse(raw);
  } catch {
    Deno.exit(0);
  }
  if (payload.tool_name !== "Bash") Deno.exit(0);
  const command = payload.tool_input?.command ?? "";
  if (!isShippingCommand(command)) Deno.exit(0);

  const base = Deno.env.get("ARCH_BASE") ?? "origin/main";
  const root = await repoRoot();
  const recordPath = Deno.env.get("ARCH_RECORD") ??
    `${root}/.arch-lint-llm-verified.json`;

  Deno.chdir(root);
  const files = await inScopeChangedFiles(base);
  if (files.length === 0) {
    Deno.exit(0);
  }

  const currentHash = await diffHash(base, files);
  const record = await readRecord(recordPath);

  if (record && record.diff_sha256 === currentHash) {
    emitAllow(
      `arch-lint-llm: this exact diff was reviewed at ${record.reviewed_at}; allowed.`,
    );
    Deno.exit(0);
  }

  const fileList = files.map((f) => `  - ${f}`).join("\n");
  const reason = record == null
    ? "Pre-ship architecture review needed.\n\n" +
      "The current branch modifies substantial layer files that the " +
      "arch-lint-llm skill has not reviewed:\n\n" +
      `${fileList}\n\n` +
      "Invoke /arch-lint-llm to scan for the six categories " +
      "(cohesion, hidden service locator, duplication, intimacy, SRP, domain leakage). " +
      "On a clean review the skill writes .arch-lint-llm-verified.json " +
      "with the diff hash and the push will proceed."
    : "Pre-ship architecture review stale.\n\n" +
      "The diff has changed since the last arch-lint-llm review " +
      `(reviewed ${record.reviewed_at}). Files currently in scope:\n\n` +
      `${fileList}\n\n` +
      "Re-invoke /arch-lint-llm to refresh the verification record.";
  emitDeny(reason);
  Deno.exit(0);
}

export { commandSegments, diffHash, extractHead, inScopeChangedFiles };
export type { HookInput, VerificationRecord };
