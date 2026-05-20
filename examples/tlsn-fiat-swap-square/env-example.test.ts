const requiredKeys = [
  "NOSTR_RELAYS",
  "CASHU_MINT_URL",
  "FIAT_SWAP_ORACLE_ENDPOINT",
  "FIAT_SWAP_ORACLE_PUBKEY",
  "FIAT_SWAP_PROVIDER_PRIVKEY",
  "FIAT_SWAP_SOURCE_PROOFS_JSON",
  "SQUARE_PAYMENT_LINK",
  "SQUARE_ACCESS_TOKEN",
  "FIAT_SWAP_PAYMENT_ID",
  "FIAT_SWAP_PROOF_FILE",
  "FIAT_SWAP_AMOUNT_SATS",
  "FIAT_SWAP_FIAT_AMOUNT_MINOR",
  "FIAT_SWAP_FIAT_CURRENCY",
] as const;

Deno.test("fiat swap env example documents required non-secret config", async () => {
  const text = await Deno.readTextFile(
    new URL("./.env.example", import.meta.url),
  );
  const keys = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    keys.add(trimmed.slice(0, separator));
  }

  for (const key of requiredKeys) {
    if (!keys.has(key)) {
      throw new Error(`.env.example must include ${key}`);
    }
  }

  if (text.includes("cashuA")) {
    throw new Error(".env.example must not include a real Cashu token");
  }
});
