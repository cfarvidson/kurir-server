"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { createQueryClient } from "@/lib/query-client";

export function Providers({
  children,
  defaultTheme,
  userId,
}: {
  children: React.ReactNode;
  defaultTheme?: string;
  userId?: string;
}) {
  const [queryClient] = useState(createQueryClient);

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
