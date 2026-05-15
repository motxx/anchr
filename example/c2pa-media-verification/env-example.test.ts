const requiredKeys = [
  "NOSTR_RELAYS",
  "CASHU_MINT_URL",
  "ORACLE_ENDPOINT",
  "ORACLE_PUBKEY",
  "C2PA_PROVIDER_PRIVKEY",
  "C2PA_PHOTO_PATH",
  "C2PA_SOURCE_PROOFS_JSON",
  "C2PA_LOCATION_HINT",
  "C2PA_EXPECTED_LAT",
  "C2PA_EXPECTED_LON",
  "C2PA_MAX_DISTANCE_KM",
  "C2PA_FRESHNESS_SECONDS",
  "C2PA_MAX_SATS",
  "C2PA_OFFER_SATS",
] as const;

Deno.test("C2PA env example documents required non-secret config", async () => {
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
