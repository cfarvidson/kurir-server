import { describe, it, expect } from "vitest";
import { defaultQueryOptions, createQueryClient } from "@/lib/query-client";

describe("query client defaults", () => {
  it("disables refetch-on-window-focus and caches by default", () => {
    expect(defaultQueryOptions?.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaultQueryOptions?.queries?.staleTime).toBeGreaterThanOrEqual(30_000);
    expect(defaultQueryOptions?.queries?.gcTime).toBeGreaterThan(0);
    expect(defaultQueryOptions?.queries?.retry).toBe(2);
  });

  it("creates a QueryClient carrying those defaults", () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.queries?.staleTime).toBeGreaterThanOrEqual(30_000);
  });
});
