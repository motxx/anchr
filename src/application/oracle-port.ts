/**
 * OracleRegistry port — application-layer interface for oracle resolution.
 *
 * Decouples the application layer from the concrete oracle registry
 * implementation in infrastructure.
 */

import type { Oracle, OracleInfo } from "../domain/oracle-types";

export interface OracleRegistry {
  get(id: string): Oracle | null;
  list(): OracleInfo[];
  register(oracle: Oracle): void;
  resolve(oracleId: string | undefined, acceptableIds: string[] | undefined): Oracle | null;
  /** Resolve up to `count` oracles from the acceptable set (for quorum). */
  resolveMultiple(acceptableIds: string[] | undefined, count: number): Oracle[];
}
