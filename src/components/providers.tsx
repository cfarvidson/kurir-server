"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";

export function Providers({
  children,
  defaultTheme,
  userId,
}: {
  children: React.ReactNode;
  defaultTheme?: string;
  userId?: string;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 2,
            staleTime: 0,
            gcTime: 0,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={defaultTheme ?? "system"}
      storageKey={userId ? `theme-${userId}` : "theme"}
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
