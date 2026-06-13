import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { coordinateSigning } from "./frost-signing-coordinator.ts";
import type { FrostNodeConfig } from "./frost-config.ts";

const nodeConfig: FrostNodeConfig = {
  signer_index: 1,
  total_signers: 3,
  threshold: 2,
  key_package: { signer: 1 },
  pubkey_package: { group: "test" },
  group_pubkey: "aabb".repeat(16),
  peers: [
    { signer_index: 1, endpoint: "https://self.oracle.example" },
    {
      signer_index: 2,
      endpoint: "https://peer-two.oracle.example",
      api_key: "peer-two-key",
    },
    {
      signer_index: 3,
      endpoint: "https://peer-three.oracle.example",
      api_key: "peer-three-key",
    },
  ],
};

function inputUrl(input: string | URL | Request): string {
  return input instanceof Request ? input.url : String(input);
}

function commandOutput(args: string[]): string {
  switch (args[0]) {
    case "sign-round1":
      return JSON.stringify({
        commitments: { local: "commitment-1" },
        nonces: { local: "nonce-1" },
      });
    case "sign-round2":
      return JSON.stringify({ signature_share: "share-1" });
    case "aggregate":
      return JSON.stringify({ signature: "aa".repeat(64) });
    default:
      throw new Error(`unexpected frost command: ${args[0] ?? ""}`);
  }
}

describe("coordinateSigning injectable transport", () => {
  test("routes all peer round HTTP calls through fetchImpl", async () => {
    const originalCommand = Object.getOwnPropertyDescriptor(Deno, "Command");
    const originalStatSync = Deno.statSync;
    const originalFetch = globalThis.fetch;
    const globalFetchCalls: string[] = [];
    const globalFetchSpy: typeof globalThis.fetch = (input) => {
      globalFetchCalls.push(inputUrl(input));
      return Promise.reject(new Error("global fetch should not be called"));
    };
    const missingStatSync: typeof Deno.statSync = () => {
      throw new Deno.errors.NotFound("not found");
    };
    class FakeCommand {
      constructor(
        readonly command: string | URL,
        readonly options: Deno.CommandOptions = {},
      ) {}

      outputSync() {
        return {
          code: 0,
          stdout: new TextEncoder().encode("/tmp/frost-signer\n"),
          stderr: new Uint8Array(),
        };
      }

      spawn() {
        const args = this.options.args ?? [];
        return {
          stdout: new Blob([commandOutput(args)]).stream(),
          stderr: new Blob([""]).stream(),
          status: Promise.resolve({ success: true, code: 0, signal: null }),
          kill() {},
        };
      }
    }

    Object.defineProperty(Deno, "Command", {
      configurable: true,
      value: FakeCommand,
    });
    Deno.statSync = missingStatSync;
    globalThis.fetch = globalFetchSpy;

    const peerCalls: string[] = [];
    const fetchImpl: typeof fetch = (input) => {
      const url = inputUrl(input);
      peerCalls.push(url);
      if (url.endsWith("/frost/signer/round1")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              commitments: { peer: "commitment-2" },
              nonce_id: "nonce-2",
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ signature_share: "share-2" }),
          { status: 200 },
        ),
      );
    };

    try {
      const result = await coordinateSigning(
        {
          nodeConfig,
          peerTimeoutMs: 100,
          fetchImpl,
          requirement: { kind: "unit" },
          input: { passed: true },
          escrowToken: "token",
        },
        "ff".repeat(32),
      );

      expect(result).toEqual({
        signature: "aa".repeat(64),
        signers_participated: [1, 2],
      });
      expect(peerCalls).toEqual([
        "https://peer-two.oracle.example/frost/signer/round1",
        "https://peer-two.oracle.example/frost/signer/round2",
      ]);
      expect(globalFetchCalls).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.statSync = originalStatSync;
      if (originalCommand) {
        Object.defineProperty(Deno, "Command", originalCommand);
      }
    }
  });
});
