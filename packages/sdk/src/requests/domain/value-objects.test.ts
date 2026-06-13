import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  validateBountyInfo,
  validateEscrowLocktime,
  validateOfferInfo,
  validateQueryInput,
} from "./value-objects.ts";

describe("validateBountyInfo", () => {
  test("valid amount", () => {
    expect(validateBountyInfo({ amount_sats: 100 })).toBeNull();
  });
  test("valid amount with token", () => {
    expect(validateBountyInfo({ amount_sats: 1, escrow_token: "tok" }))
      .toBeNull();
  });
  test("zero", () => {
    expect(validateBountyInfo({ amount_sats: 0 })).toContain("positive");
  });
  test("negative", () => {
    expect(validateBountyInfo({ amount_sats: -10 })).toContain("positive");
  });
  test("decimal", () => {
    expect(validateBountyInfo({ amount_sats: 1.5 })).toContain("integer");
  });
  test("NaN", () => {
    expect(validateBountyInfo({ amount_sats: NaN })).toContain("finite");
  });
  test("Infinity", () => {
    expect(validateBountyInfo({ amount_sats: Infinity })).toContain("finite");
  });
});

describe("validateEscrowLocktime", () => {
  const minSecs = 600;

  test("exactly at minimum", () => {
    expect(validateEscrowLocktime(1600, 1000, minSecs)).toBeNull();
  });
  test("well above minimum", () => {
    expect(validateEscrowLocktime(2000, 1000, minSecs)).toBeNull();
  });
  test("1 second short of minimum", () => {
    expect(validateEscrowLocktime(1599, 1000, minSecs)).toContain("600s");
  });
  test("already expired", () => {
    expect(validateEscrowLocktime(500, 1000, minSecs)).toContain("600s");
  });
  test("equal to now (0s remaining)", () => {
    expect(validateEscrowLocktime(1000, 1000, minSecs)).toContain("600s");
  });
  test("NaN locktime", () => {
    expect(validateEscrowLocktime(NaN, 1000, minSecs)).toContain("finite");
  });
});

describe("validateQueryInput", () => {
  const validInput = { description: "Take a photo of Tokyo Tower" };

  test("valid minimal input", () => {
    expect(validateQueryInput(validInput)).toBeNull();
  });
  test("valid with all fields", () => {
    expect(validateQueryInput({
      description: "Photo",
      location_hint: "Tokyo",
      schema_requirement: { target_url: "https://example.com/api" },
      visibility: "public",
    })).toBeNull();
  });
  test("empty description", () => {
    expect(validateQueryInput({ description: "" })).toContain("description");
  });
  test("whitespace-only description", () => {
    expect(validateQueryInput({ description: "   " })).toContain("description");
  });
  test("opaque schema_requirement is accepted by generic validation", () => {
    expect(validateQueryInput({
      description: "Photo",
      schema_requirement: { target_url: "" },
    })).toBeNull();
  });
  test("schema_requirement does not require visibility", () => {
    expect(validateQueryInput({
      description: "Photo",
      schema_requirement: { target_url: "https://api.example.com/data" },
    })).toBeNull();
  });
});

describe("validateOfferInfo", () => {
  test("valid offer", () => {
    expect(validateOfferInfo({
      provider_pubkey: "abc123",
      offer_event_id: "evt_1",
      received_at: Date.now(),
    })).toBeNull();
  });
  test("empty provider_pubkey", () => {
    expect(validateOfferInfo({
      provider_pubkey: "",
      offer_event_id: "evt_1",
      received_at: Date.now(),
    })).toContain("provider_pubkey");
  });
  test("whitespace provider_pubkey", () => {
    expect(validateOfferInfo({
      provider_pubkey: "  ",
      offer_event_id: "evt_1",
      received_at: Date.now(),
    })).toContain("provider_pubkey");
  });
  test("empty offer_event_id", () => {
    expect(validateOfferInfo({
      provider_pubkey: "abc",
      offer_event_id: "",
      received_at: Date.now(),
    })).toContain("offer_event_id");
  });
  test("whitespace offer_event_id", () => {
    expect(validateOfferInfo({
      provider_pubkey: "abc",
      offer_event_id: "  ",
      received_at: Date.now(),
    })).toContain("offer_event_id");
  });
});
