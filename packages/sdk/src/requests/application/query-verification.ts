import type { Oracle, OracleAttestation } from "../domain/oracle-types.ts";
import type { BlossomKeyMap } from "../../values.ts";
import type {
  OracleAttestationRecord,
  Query,
  QueryResult,
  VerificationDetail,
} from "../domain/types.ts";

export interface QuorumVerificationResult {
  passed: boolean;
  attestations: OracleAttestationRecord[];
  verification: VerificationDetail;
}

/** Resolver callback — abstracts OracleRegistry / fallback singleton. */
export type OracleResolver = (
  oracleId: string | undefined,
  acceptableIds: string[] | undefined,
) => Oracle | null;

/** Multi-oracle resolver (for quorum verification). */
export type MultiOracleResolver = (
  acceptableIds: string[] | undefined,
  count: number,
) => Oracle[];

export function toAttestationRecord(
  a: OracleAttestation,
): OracleAttestationRecord {
  return {
    oracle_id: a.oracle_id,
    passed: a.passed,
    checks: a.checks,
    failures: a.failures,
    attested_at: a.attested_at,
    tlsn_verified: a.tlsn_verified,
  };
}

export async function verifyWithQuorum(
  query: Query,
  result: QueryResult,
  resolveOracle: OracleResolver,
  resolveMultiple?: MultiOracleResolver,
  blossomKeys?: BlossomKeyMap,
  oracleId?: string,
): Promise<QuorumVerificationResult> {
  // CTF-1: When query has no acceptable oracle list, ignore provider-supplied oracleId.
  // Otherwise a provider can register a malicious oracle and force its use.
  const effectiveOracleId = query.oracle_ids?.length ? oracleId : undefined;

  if (!query.quorum) {
    return verifySingleOracle(
      query,
      result,
      resolveOracle,
      effectiveOracleId,
      blossomKeys,
    );
  }

  return verifyQuorum(query, result, resolveMultiple, blossomKeys);
}

async function verifySingleOracle(
  query: Query,
  result: QueryResult,
  resolveOracle: OracleResolver,
  effectiveOracleId: string | undefined,
  blossomKeys?: BlossomKeyMap,
): Promise<QuorumVerificationResult> {
  const oracle = resolveOracle(effectiveOracleId, query.oracle_ids);
  if (!oracle) {
    return {
      passed: false,
      attestations: [],
      verification: {
        passed: false,
        checks: [],
        failures: [
          effectiveOracleId
            ? `Oracle "${effectiveOracleId}" is not available or not accepted for this query`
            : "No oracle available for this query",
        ],
      },
    };
  }
  const att = await oracle.verify(query, result, blossomKeys);
  const record = toAttestationRecord(att);
  return {
    passed: att.passed,
    attestations: [record],
    verification: {
      passed: att.passed,
      checks: att.checks,
      failures: att.failures,
      tlsn_verified: att.tlsn_verified,
    },
  };
}

async function verifyQuorum(
  query: Query,
  result: QueryResult,
  resolveMultiple: MultiOracleResolver | undefined,
  blossomKeys?: BlossomKeyMap,
): Promise<QuorumVerificationResult> {
  if (!resolveMultiple) {
    return {
      passed: false,
      attestations: [],
      verification: {
        passed: false,
        checks: [],
        failures: ["No oracle registry with resolveMultiple support"],
      },
    };
  }
  const needed = query.quorum!.min_approvals + 2;
  const oracles = resolveMultiple(query.oracle_ids, needed);
  if (oracles.length < query.quorum!.min_approvals) {
    return {
      passed: false,
      attestations: [],
      verification: {
        passed: false,
        checks: [],
        failures: [
          `Need ${
            query.quorum!.min_approvals
          } oracles but only ${oracles.length} available`,
        ],
      },
    };
  }

  const rawAtts = await Promise.all(
    oracles.map((o) => o.verify(query, result, blossomKeys)),
  );
  const records: OracleAttestationRecord[] = rawAtts.map(toAttestationRecord);

  const passCount = records.filter((a) => a.passed).length;
  const passed = passCount >= query.quorum!.min_approvals;
  const firstPass = records.find((a) => a.passed);
  const allChecks = records.flatMap((a) => a.checks);
  const allFailures = records.flatMap((a) => a.failures);

  return {
    passed,
    attestations: records,
    verification: {
      passed,
      checks: allChecks,
      failures: allFailures,
      tlsn_verified: firstPass?.tlsn_verified,
    },
  };
}
