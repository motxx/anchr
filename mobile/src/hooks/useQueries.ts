import { useQuery } from "@tanstack/react-query";
import { fetchQueries, fetchQueryDetail } from "../api/client";
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
  return useQuery<QueryDetail>({
    queryKey: ["query", id],
    queryFn: () => fetchQueryDetail(id),
    refetchInterval: 5000,
    enabled: !!id,
  });
}
