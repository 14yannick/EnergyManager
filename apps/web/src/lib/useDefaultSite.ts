import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/** Phase 1 has exactly one auto-seeded site; the UI doesn't expose site switching yet. */
export function useDefaultSite() {
  const query = useQuery({ queryKey: ["sites"], queryFn: api.sites.list });
  return { site: query.data?.[0], isLoading: query.isLoading, error: query.error };
}
