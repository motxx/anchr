import type { Oracle, OracleInfo } from "../domain/oracle-types.ts";

export interface OracleRegistry {
  get(id: string): Oracle | null;
  list(): OracleInfo[];
  register(oracle: Oracle): void;
  resolve(oracleId: string | undefined, acceptableIds: string[] | undefined): Oracle | null;
  resolveMultiple(acceptableIds: string[] | undefined, count: number): Oracle[];
}
