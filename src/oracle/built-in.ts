import { verify } from "../verification/verifier";
import type { Query, QueryResult } from "../types";
import type { Oracle, OracleAttestation, OracleInfo } from "./types";

export const BUILT_IN_ORACLE_ID = "built-in";

const info: OracleInfo = {
  id: BUILT_IN_ORACLE_ID,
  name: "Built-in Oracle",
  fee_ppm: 0,
};

export const builtInOracle: Oracle = {
  info,
  async verify(query: Query, result: QueryResult): Promise<OracleAttestation> {
    const detail = await verify(query, result);
    return {
      oracle_id: BUILT_IN_ORACLE_ID,
      query_id: query.id,
      passed: detail.passed,
      checks: detail.checks,
      failures: detail.failures,
      attested_at: Date.now(),
    };
  },
};
