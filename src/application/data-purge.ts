import type { QueryService } from "./query-service.ts";

export async function purgeExpiredQueries(service: QueryService): Promise<number> {
  const expired = service.purgeExpiredFromStore();
  return expired.length;
}
