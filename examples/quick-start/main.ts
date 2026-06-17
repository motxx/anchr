/**
 * CLI entry: NOSTR_RELAYS=wss://... deno run --allow-net --allow-env main.ts
 */

import { createRelayClient } from "@anchr/sdk";
import { runQuickStart } from "./mod.ts";

const relays = (Deno.env.get("NOSTR_RELAYS") ?? Deno.args[0] ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

if (relays.length === 0) {
  console.error(
    "Usage: NOSTR_RELAYS=wss://your-relay deno run --allow-net --allow-env examples/quick-start/main.ts",
  );
  Deno.exit(2);
}

const relayClient = createRelayClient(relays);
try {
  const result = await runQuickStart(relayClient);
  console.log(`Request Notice published: ${result.eventId}`);
  console.log(`accepted by:             ${result.acceptedBy.join(", ")}`);
  console.log(`echoed back query_id:    ${result.echoed.query_id}`);
  console.log(
    `public fields only:      schema=${result.echoed.schema} max=${result.echoed.max_amount_sats} sats`,
  );
} finally {
  relayClient.close();
}
