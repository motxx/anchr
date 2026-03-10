import { expect, test } from "bun:test";
import { generateEphemeralIdentity } from "./identity";
import {
  buildOracleAttestationEvent,
  parseOracleAttestationPayload,
  toOracleAttestation,
  GT_ORACLE_ATTESTATION,
} from "./oracle-attestation";
import type { OracleAttestation } from "../oracle/types";

const oracleIdentity = generateEphemeralIdentity();

const attestation: OracleAttestation = {
  oracle_id: "test-oracle",
  query_id: "gt_123_abc",
  passed: true,
  checks: ["photo attachment present", "EXIF: camera identified"],
  failures: [],
  attested_at: 1710000001000,
};

test("buildOracleAttestationEvent creates valid event", () => {
  const event = buildOracleAttestationEvent(
    oracleIdentity,
    "query-event-id",
    "response-event-id",
    attestation,
  );

  expect(event.kind).toBe(GT_ORACLE_ATTESTATION);
  expect(event.pubkey).toBe(oracleIdentity.publicKey);

  // Tags
  const eTags = event.tags.filter((t) => t[0] === "e");
  expect(eTags.length).toBe(2);
  expect(eTags[0]![1]).toBe("query-event-id");
  expect(eTags[1]![1]).toBe("response-event-id");

  const dTag = event.tags.find((t) => t[0] === "d");
  expect(dTag?.[1]).toBe("gt_123_abc");

  const resultTag = event.tags.find((t) => t[0] === "result");
  expect(resultTag?.[1]).toBe("pass");
});

test("parseOracleAttestationPayload round-trips", () => {
  const event = buildOracleAttestationEvent(
    oracleIdentity,
    "qe-id",
    "re-id",
    attestation,
  );

  const parsed = parseOracleAttestationPayload(event.content);
  expect(parsed.oracle_id).toBe("test-oracle");
  expect(parsed.passed).toBe(true);
  expect(parsed.checks).toEqual(["photo attachment present", "EXIF: camera identified"]);
  expect(parsed.failures).toEqual([]);
});

test("toOracleAttestation converts payload", () => {
  const payload = parseOracleAttestationPayload(
    JSON.stringify({
      oracle_id: "o1",
      query_id: "q1",
      passed: false,
      checks: [],
      failures: ["bad image"],
      attested_at: 999,
    }),
  );

  const att = toOracleAttestation(payload);
  expect(att.oracle_id).toBe("o1");
  expect(att.passed).toBe(false);
  expect(att.failures).toEqual(["bad image"]);
});

test("failed attestation sets result tag to fail", () => {
  const failedAttestation: OracleAttestation = {
    ...attestation,
    passed: false,
    failures: ["GPS mismatch"],
  };

  const event = buildOracleAttestationEvent(
    oracleIdentity,
    "qe",
    "re",
    failedAttestation,
  );

  const resultTag = event.tags.find((t) => t[0] === "result");
  expect(resultTag?.[1]).toBe("fail");
});
