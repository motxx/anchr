import { dirname } from "node:path";
import {
  createCashuTokenBankProofGateSettlementProvider,
  createProofGateService,
  openSqliteProofGateStore,
} from "@anchr/bounty/claim-gate";
import { loadKatashiroRuntimeConfig, assertMainnetReleaseConfig } from "./src/release-config.ts";
import { buildKatashiroApp } from "./src/server-routes.ts";
import { identityPathForKatashiroCondition } from "./src/katashiro-policy.ts";
import type { ProofCondition } from "./src/airdrop-criteria.ts";

const config = loadKatashiroRuntimeConfig();
assertMainnetReleaseConfig(config);

if (config.dbPath !== ":memory:") {
  await Deno.mkdir(dirname(config.dbPath), { recursive: true });
}

const store = openSqliteProofGateStore<ProofCondition>(config.dbPath);
const settlementProvider = config.settlement
  ? createCashuTokenBankProofGateSettlementProvider<ProofCondition>(config.settlement)
  : undefined;
const service = createProofGateService<ProofCondition>({
  store,
  nullifierSecret: config.nullifierSecret,
  identityPathForCondition: identityPathForKatashiroCondition,
  accountAgeConditionTypes: new Set(["github_account_age"]),
  settlementProvider,
});
const app = buildKatashiroApp({
  service,
  adminToken: config.adminToken,
  productionReady: config.productionReady,
});

if (config.warnings.length > 0) {
  console.warn("[katashiro] not mainnet-ready:", config.warnings.join("; "));
}
console.log(`[katashiro] listening on :${config.port}`);
Deno.serve({ port: config.port }, app.fetch);
