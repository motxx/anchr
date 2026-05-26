import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import * as cashuAdapter from "@anchr/sdk/adapters/cashu";
import * as payments from "@anchr/sdk/payments";

describe("payments public surface", () => {
  test("keeps the concrete Cashu client under the Cashu adapter surface", () => {
    expect("createCashuClient" in payments).toBe(false);
    expect(typeof cashuAdapter.createCashuClient).toBe("function");
  });
});
