import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { haversineKm } from "./geo";

test("haversineKm returns 0 for same point", () => {
  expect(haversineKm(35.6762, 139.6503, 35.6762, 139.6503)).toBe(0);
});

test("haversineKm calculates Tokyo to Osaka ~400km", () => {
  const dist = haversineKm(35.6762, 139.6503, 34.6937, 135.5023);
  expect(dist).toBeGreaterThan(390);
  expect(dist).toBeLessThan(410);
});

test("haversineKm handles negative coordinates", () => {
  // New York to London
  const dist = haversineKm(40.7128, -74.006, 51.5074, -0.1278);
  expect(dist).toBeGreaterThan(5500);
  expect(dist).toBeLessThan(5600);
});
