import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Anchr, AnchrError, QueryTimeoutError, VerificationFailedError } from "./index.ts";

describe("Anchr SDK", () => {
  test("constructor accepts config", () => {
    const anchr = new Anchr({ serverUrl: "http://localhost:3000" });
    expect(anchr).toBeInstanceOf(Anchr);
  });

  test("constructor trims trailing slash", () => {
    const anchr = new Anchr({ serverUrl: "http://localhost:3000/" });
    expect(anchr).toBeInstanceOf(Anchr);
  });

  test("error types", () => {
    const err = new AnchrError("test", "TEST_CODE");
    expect(err.code).toBe("TEST_CODE");
    expect(err.name).toBe("AnchrError");

    const timeout = new QueryTimeoutError("q1", 60);
    expect(timeout.code).toBe("TIMEOUT");

    const fail = new VerificationFailedError("q1", ["bad sig"]);
    expect(fail.code).toBe("VERIFICATION_FAILED");
  });
});
