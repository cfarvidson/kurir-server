export async function register() {
  // Only run on the Node.js server, not during build or in edge runtime
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Auto-generate missing secrets (NEXTAUTH_SECRET, ENCRYPTION_KEY, VAPID)
    const { generateSecrets } = await import("@/lib/generate-secrets");
    await generateSecrets();

    // Validate all required config is present
    const { validateConfig, resetConfig } = await import("@/lib/config");
    resetConfig(); // re-parse env after secret generation
    validateConfig();

    const { startBackgroundSync, stopBackgroundSync } =
      await import("@/lib/mail/background-sync");
    startBackgroundSync();

    // Graceful shutdown: stop BullMQ workers + IDLE connections
    process.on("SIGTERM", () => {
      console.log("[instrumentation] SIGTERM received, shutting down...");
      stopBackgroundSync().catch(console.error);
    });
  }
}
