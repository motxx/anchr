import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = join(import.meta.dir, "..");
const pidFile = join(rootDir, ".local", "run", "reference-app.pid");

try {
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (Number.isFinite(pid) && pid > 0) {
    try {
      process.kill(pid);
    } catch {
      // already stopped
    }
  }
} catch {
  // pid file does not exist
}

rmSync(pidFile, { force: true });

const result = spawnSync("docker", ["compose", "-f", "docker-compose.localstack.yml", "down"], {
  cwd: rootDir,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("stopped local environment");
