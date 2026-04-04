import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { queryTemplates } from "./query-templates";
import type { QueryInput } from "./types";

// --- photoProof ---

test("photoProof sets description and location_hint", () => {
  const input = queryTemplates.photoProof("Shibuya crossing");
  expect(input.description).toBe("Photo proof: Shibuya crossing");
  expect(input.location_hint).toBe("Shibuya crossing");
});

test("photoProof returns valid QueryInput (no extra fields)", () => {
  const input = queryTemplates.photoProof("X");
  const keys = Object.keys(input).sort();
  expect(keys).toEqual(["description", "location_hint"]);
});

// --- storeStatus ---

test("storeStatus uses storeName as location_hint when location omitted", () => {
  const input = queryTemplates.storeStatus("Seven Eleven");
  expect(input.description).toBe("Store status check: Seven Eleven");
  expect(input.location_hint).toBe("Seven Eleven");
});

test("storeStatus uses explicit location when provided", () => {
  const input = queryTemplates.storeStatus("Seven Eleven", "Tokyo Station");
  expect(input.description).toBe("Store status check: Seven Eleven");
  expect(input.location_hint).toBe("Tokyo Station");
});

// --- eventVerification ---

test("eventVerification has undefined location_hint when location omitted", () => {
  const input = queryTemplates.eventVerification("Concert at Budokan");
  expect(input.description).toBe("Event verification: Concert at Budokan");
  expect(input.location_hint).toBeUndefined();
});

test("eventVerification uses explicit location when provided", () => {
  const input = queryTemplates.eventVerification("Concert at Budokan", "Chiyoda");
  expect(input.description).toBe("Event verification: Concert at Budokan");
  expect(input.location_hint).toBe("Chiyoda");
});

test("all templates conform to QueryInput", () => {
  // Type-check: assign each result to QueryInput
  const a: QueryInput = queryTemplates.photoProof("X");
  const b: QueryInput = queryTemplates.storeStatus("X");
  const c: QueryInput = queryTemplates.eventVerification("X");
  // Ensure all have description
  expect(a.description).toBeTruthy();
  expect(b.description).toBeTruthy();
  expect(c.description).toBeTruthy();
});
