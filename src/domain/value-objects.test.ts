import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  validateGpsCoord,
  validateBountyInfo,
  validateHtlcLocktime,
  validateQueryInput,
  validateQuoteInfo,
} from "./value-objects";

describe("validateGpsCoord", () => {
  // --- Valid ---
  test("origin (0, 0)", () => {
    expect(validateGpsCoord({ lat: 0, lon: 0 })).toBeNull();
  });
  test("equator", () => {
    expect(validateGpsCoord({ lat: 0, lon: 139.6917 })).toBeNull();
  });
  test("north pole", () => {
    expect(validateGpsCoord({ lat: 90, lon: 0 })).toBeNull();
  });
  test("south pole", () => {
    expect(validateGpsCoord({ lat: -90, lon: 0 })).toBeNull();
  });
  test("date line east", () => {
    expect(validateGpsCoord({ lat: 0, lon: 180 })).toBeNull();
  });
  test("date line west", () => {
    expect(validateGpsCoord({ lat: 0, lon: -180 })).toBeNull();
  });
  test("typical Tokyo coord", () => {
    expect(validateGpsCoord({ lat: 35.6762, lon: 139.6503 })).toBeNull();
  });
  test("negative lat/lon", () => {
    expect(validateGpsCoord({ lat: -33.8688, lon: -70.6693 })).toBeNull();
  });

  // --- Invalid ---
  test("lat > 90", () => {
    expect(validateGpsCoord({ lat: 91, lon: 0 })).toContain("lat");
  });
  test("lat < -90", () => {
    expect(validateGpsCoord({ lat: -91, lon: 0 })).toContain("lat");
  });
  test("lon > 180", () => {
    expect(validateGpsCoord({ lat: 0, lon: 181 })).toContain("lon");
  });
  test("lon < -180", () => {
    expect(validateGpsCoord({ lat: 0, lon: -181 })).toContain("lon");
  });
  test("lat = 999", () => {
    expect(validateGpsCoord({ lat: 999, lon: 0 })).toContain("lat");
  });
  test("lat = NaN", () => {
    expect(validateGpsCoord({ lat: NaN, lon: 0 })).toContain("finite");
  });
  test("lon = NaN", () => {
    expect(validateGpsCoord({ lat: 0, lon: NaN })).toContain("finite");
  });
  test("lat = Infinity", () => {
    expect(validateGpsCoord({ lat: Infinity, lon: 0 })).toContain("finite");
  });
  test("lon = -Infinity", () => {
    expect(validateGpsCoord({ lat: 0, lon: -Infinity })).toContain("finite");
  });
});

describe("validateBountyInfo", () => {
  test("valid amount", () => {
    expect(validateBountyInfo({ amount_sats: 100 })).toBeNull();
  });
  test("valid amount with token", () => {
    expect(validateBountyInfo({ amount_sats: 1, cashu_token: "tok" })).toBeNull();
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

describe("validateHtlcLocktime", () => {
  const minSecs = 600;

  test("exactly at minimum", () => {
    expect(validateHtlcLocktime(1600, 1000, minSecs)).toBeNull();
  });
  test("well above minimum", () => {
    expect(validateHtlcLocktime(2000, 1000, minSecs)).toBeNull();
  });
  test("1 second short of minimum", () => {
    expect(validateHtlcLocktime(1599, 1000, minSecs)).toContain("600s");
  });
  test("already expired", () => {
    expect(validateHtlcLocktime(500, 1000, minSecs)).toContain("600s");
  });
  test("equal to now (0s remaining)", () => {
    expect(validateHtlcLocktime(1000, 1000, minSecs)).toContain("600s");
  });
  test("NaN locktime", () => {
    expect(validateHtlcLocktime(NaN, 1000, minSecs)).toContain("finite");
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
      expected_gps: { lat: 35.6, lon: 139.7 },
      max_gps_distance_km: 10,
      tlsn_requirements: { target_url: "https://example.com/api" },
    })).toBeNull();
  });
  test("empty description", () => {
    expect(validateQueryInput({ description: "" })).toContain("description");
  });
  test("whitespace-only description", () => {
    expect(validateQueryInput({ description: "   " })).toContain("description");
  });
  test("invalid expected_gps", () => {
    expect(validateQueryInput({
      description: "Photo",
      expected_gps: { lat: 999, lon: 0 },
    })).toContain("expected_gps");
  });
  test("invalid GPS NaN lat", () => {
    expect(validateQueryInput({
      description: "Photo",
      expected_gps: { lat: NaN, lon: 0 },
    })).toContain("expected_gps");
  });
  test("max_gps_distance_km = 0", () => {
    expect(validateQueryInput({
      description: "Photo",
      max_gps_distance_km: 0,
    })).toContain("max_gps_distance_km");
  });
  test("max_gps_distance_km negative", () => {
    expect(validateQueryInput({
      description: "Photo",
      max_gps_distance_km: -5,
    })).toContain("max_gps_distance_km");
  });
  test("max_gps_distance_km NaN", () => {
    expect(validateQueryInput({
      description: "Photo",
      max_gps_distance_km: NaN,
    })).toContain("max_gps_distance_km");
  });
  test("empty tlsn target_url", () => {
    expect(validateQueryInput({
      description: "Photo",
      tlsn_requirements: { target_url: "" },
    })).toContain("target_url");
  });
  test("invalid tlsn target_url", () => {
    expect(validateQueryInput({
      description: "Photo",
      tlsn_requirements: { target_url: "not-a-url" },
    })).toContain("target_url");
  });
  test("valid tlsn target_url", () => {
    expect(validateQueryInput({
      description: "Photo",
      tlsn_requirements: { target_url: "https://api.example.com/data" },
    })).toBeNull();
  });
});

describe("validateQuoteInfo", () => {
  test("valid quote", () => {
    expect(validateQuoteInfo({
      worker_pubkey: "abc123",
      quote_event_id: "evt_1",
      received_at: Date.now(),
    })).toBeNull();
  });
  test("empty worker_pubkey", () => {
    expect(validateQuoteInfo({
      worker_pubkey: "",
      quote_event_id: "evt_1",
      received_at: Date.now(),
    })).toContain("worker_pubkey");
  });
  test("whitespace worker_pubkey", () => {
    expect(validateQuoteInfo({
      worker_pubkey: "  ",
      quote_event_id: "evt_1",
      received_at: Date.now(),
    })).toContain("worker_pubkey");
  });
  test("empty quote_event_id", () => {
    expect(validateQuoteInfo({
      worker_pubkey: "abc",
      quote_event_id: "",
      received_at: Date.now(),
    })).toContain("quote_event_id");
  });
  test("whitespace quote_event_id", () => {
    expect(validateQuoteInfo({
      worker_pubkey: "abc",
      quote_event_id: "  ",
      received_at: Date.now(),
    })).toContain("quote_event_id");
  });
});
