import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createFrostSignatureAdapter } from "./frost-signature-adapter.ts";
import type { FrostNodeConfig } from "./frost-config.ts";
import type {
  AttachmentRef,
  Query,
  QueryResult,
} from "../../requests/domain/types.ts";

/** Minimal FrostNodeConfig with no real key material and unreachable peers. */
const nodeConfig: FrostNodeConfig = {
  signer_index: 1,
  total_signers: 3,
  threshold: 2,
  key_package: {},
  pubkey_package: {},
  group_pubkey: "aabb".repeat(16),
  peers: [
    { signer_index: 1, endpoint: "http://127.0.0.1:14501", api_key: "test" },
    { signer_index: 2, endpoint: "http://127.0.0.1:14502", api_key: "test" },
    { signer_index: 3, endpoint: "http://127.0.0.1:14503", api_key: "test" },
  ],
};

function makeQuery(id: string): Query {
  return {
    id,
    status: "verifying",
    description: "test",
    verification_requirements: ["ai_check"],
    created_at: Date.now(),
    expires_at: Date.now() + 60_000,
    payment_status: "escrow_swapped",
  };
}

const makeResult = (): QueryResult => ({ attachments: [] as AttachmentRef[] });

describe("createFrostSignatureAdapter", () => {
  test("returns null when the signer quorum cannot be reached", async () => {
    const adapter = createFrostSignatureAdapter(nodeConfig);

    // No real key material and no reachable peers: the coordinator cannot
    // assemble a threshold of shares, so the port surfaces a clear failure.
    const signature = await adapter.requestSignature(
      makeQuery("q-frost-adapter"),
      makeResult(),
    );

    expect(signature).toBeNull();
  });
});
