import type { ProofCondition } from "./airdrop-criteria.ts";

export function identityPathForAirdropCondition(condition: ProofCondition): string | undefined {
  if (condition.type === "twitter_followers") return "data.id";
  if (condition.type.startsWith("github_")) return "id";
  return undefined;
}
