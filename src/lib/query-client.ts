import { QueryClient, type QueryClientConfig } from "@tanstack/react-query";

/**
 * Global React Query defaults.
 *
 * Previously `staleTime: 0`, `gcTime: 0`, `refetchOnWindowFocus: true` — which
 * caused a refetch storm on the PWA every time the window/tab regained focus
 * (and never cached anything). Mail freshness is driven by AutoSync (SSE +
 * router.refresh) and explicit `invalidateQueries` after mutations, not by
 * focus-refetch, so we can afford sane caching here. Queries that need tighter
 * freshness (e.g. the message list, sync polling) override these locally.
 */
export const defaultQueryOptions: QueryClientConfig["defaultOptions"] = {
  queries: {
    retry: 2,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  },
};

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: defaultQueryOptions });
}
