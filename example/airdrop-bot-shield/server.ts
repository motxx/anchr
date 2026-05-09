import { dirname } from "node:path";
import {
  createCashuTokenBankProofGateSettlementProvider,
  createProofGateService,
  openSqliteProofGateStore,
} from "@anchr/bounty/claim-gate";
import {
  assertMainnetReleaseConfig,
  loadAirdropBotShieldRuntimeConfig,
} from "./src/release-config.ts";
import { buildAirdropBotShieldApp } from "./src/server-routes.ts";
import { identityPathForAirdropCondition } from "./src/identity-policy.ts";
import type { ProofCondition } from "./src/airdrop-criteria.ts";

const config = loadAirdropBotShieldRuntimeConfig();
assertMainnetReleaseConfig(config);

if (config.dbPath !== ":memory:") {
  await Deno.mkdir(dirname(config.dbPath), { recursive: true });
}

const store = openSqliteProofGateStore<ProofCondition>(config.dbPath);
const settlementProvider = config.settlement
  ? createCashuTokenBankProofGateSettlementProvider<ProofCondition>(
    config.settlement,
  )
  : undefined;
const service = createProofGateService<ProofCondition>({
  store,
  nullifierSecret: config.nullifierSecret,
  identityPathForCondition: identityPathForAirdropCondition,
  accountAgeConditionTypes: new Set(["github_account_age"]),
  settlementProvider,
});
const app = buildAirdropBotShieldApp({
  service,
  adminToken: config.adminToken,
  productionReady: config.productionReady,
});

if (config.warnings.length > 0) {
  console.warn(
    "[airdrop-bot-shield] not mainnet-ready:",
    config.warnings.join("; "),
  );
}
console.log(`[airdrop-bot-shield] listening on :${config.port}`);
Deno.serve({ port: config.port }, app.fetch);
