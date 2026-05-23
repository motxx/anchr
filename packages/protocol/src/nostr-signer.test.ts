import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  createKeypairSigner,
  createNip07Signer,
  generateKeypair,
  type Nip07Provider,
  Nip07UnavailableError,
} from "./nostr.ts";

test("createKeypairSigner signs events", async () => {
  const identity = generateKeypair();
  const signer = createKeypairSigner(identity);
  const event = await signer.signEvent({
    kind: 1,
    created_at: 1,
    content: "hello",
    tags: [],
  });

  expect(await signer.getPublicKey()).toBe(identity.publicKey);
  expect(event.pubkey).toBe(identity.publicKey);
  expect(event.id).toMatch(/^[0-9a-f]{64}$/);
});

test("createNip07Signer delegates to an injected browser signer", async () => {
  const provider: Nip07Provider = {
    getPublicKey: () => Promise.resolve("a".repeat(64)),
    signEvent: (template) =>
      Promise.resolve({
        ...template,
        id: "b".repeat(64),
        pubkey: "a".repeat(64),
        sig: "c".repeat(128),
      }),
  };

  const signer = createNip07Signer(provider);
  const event = await signer.signEvent({
    kind: 1,
    created_at: 1,
    content: "hello",
    tags: [],
  });

  expect(await signer.getPublicKey()).toBe("a".repeat(64));
  expect(event.id).toBe("b".repeat(64));
});

test("createNip07Signer rejects runtimes without a NIP-07 provider", () => {
  expect(() => createNip07Signer()).toThrow(Nip07UnavailableError);
});
