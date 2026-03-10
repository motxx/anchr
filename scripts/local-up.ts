import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const rootDir = join(import.meta.dir, "..");
const runDir = join(rootDir, ".local", "run");
const pidFile = join(runDir, "reference-app.pid");
const logFile = join(runDir, "reference-app.log");
const referencePort = Number(process.env.REFERENCE_APP_PORT ?? "3000");
const localstackEndpoint = "http://localhost:4566";
const localstackBucket = "anchr";
const localstackHealthUrl = `${localstackEndpoint}/_localstack/health`;
const referenceHealthUrl = `http://localhost:${referencePort}/health`;

const appBootstrap = [
  'process.env.DB_PATH ??= ".local/queries.db";',
  `process.env.REFERENCE_APP_PORT ??= "${referencePort}";`,
  'process.env.ATTACHMENT_STORAGE ??= "localstack";',
  'process.env.LOCALSTACK_ENDPOINT ??= "http://localhost:4566";',
  'process.env.LOCALSTACK_BUCKET ??= "anchr";',
  'process.env.LOCALSTACK_PUBLIC_BASE_URL ??= "http://localhost:4566/anchr";',
  'const { startReferenceApp } = await import("./src/reference-app.ts");',
  "await startReferenceApp();",
  "await new Promise(() => {});",
].join(" ");

function ensureLocalstack() {
  const result = spawnSync("docker", ["compose", "-f", "docker-compose.localstack.yml", "up", "-d"], {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureS3Bucket() {
  spawnSync("aws", [
    "--endpoint-url", localstackEndpoint,
    "s3", "mb", `s3://${localstackBucket}`,
  ], {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      AWS_DEFAULT_REGION: "us-east-1",
    },
  });
}

function readExistingPid(): number | null {
  try {
    return Number(readFileSync(pidFile, "utf8").trim());
  } catch {
    return null;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(url: string, label: string, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await Bun.sleep(250);
  }

  console.error(`${label} did not become ready: ${url}`);
  process.exit(1);
}

mkdirSync(runDir, { recursive: true });

ensureLocalstack();
await waitFor(localstackHealthUrl, "localstack", 15_000);
ensureS3Bucket();

const existingPid = readExistingPid();
if (existingPid && isRunning(existingPid)) {
  console.log(`reference app already running (pid ${existingPid})`);
} else {
  rmSync(pidFile, { force: true });
  const logFd = openSync(logFile, "a");
  const child = spawn(process.execPath, ["-e", appBootstrap], {
    cwd: rootDir,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
}

await waitFor(referenceHealthUrl, "reference app", 10_000);

console.log(`reference app: http://localhost:${referencePort}`);
console.log("localstack s3: http://localhost:4566");
console.log(`log: ${logFile}`);
