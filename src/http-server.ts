import { getRuntimeConfig } from "./config";
import { expireQueries } from "./query-service";
import { startReferenceApp } from "./reference-app";

const config = getRuntimeConfig();

setInterval(() => {
  const expired = expireQueries();
  if (expired > 0) {
    console.error(`[scheduler] Expired ${expired} query(s)`);
  }
}, config.querySweepIntervalMs);

await startReferenceApp();
