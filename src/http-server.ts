import { getRuntimeConfig } from "./config";
import { purgeExpiredQueries } from "./data-purge";
import { expireQueries } from "./query-service";
import { startReferenceApp } from "./reference-app";

const config = getRuntimeConfig();

setInterval(async () => {
  const expired = expireQueries();
  if (expired > 0) {
    console.error(`[scheduler] Expired ${expired} query(s)`);
  }
  const purged = await purgeExpiredQueries();
  if (purged > 0) {
    console.error(`[scheduler] Purged ${purged} expired query(s) and their data`);
  }
}, config.querySweepIntervalMs);

await startReferenceApp();
