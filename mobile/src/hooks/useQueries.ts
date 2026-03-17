import { useQuery } from "@tanstack/react-query";
import { fetchQueries, fetchQueryDetail } from "../api/client";
import { isTerminalStatus } from "../utils/time";
import type { QuerySummary, QueryDetail } from "../api/types";

export function useQueries() {
  return useQuery<QuerySummary[]>({
    queryKey: ["queries"],
    queryFn: fetchQueries,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
}

export function useQueryDetail(id: string) {
  const query = useQuery<QueryDetail>({
    queryKey: ["query", id],
    queryFn: () => fetchQueryDetail(id),
    refetchInterval: (q) => {
      // Stop polling once the query reaches a terminal state
      if (q.state.data && isTerminalStatus(q.state.data.status)) return false;
      return 5000;
    },
    enabled: !!id,
  });
  return query;
}
