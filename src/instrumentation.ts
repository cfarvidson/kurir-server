export async function register() {
  // Only run on the Node.js server, not during build or in edge runtime
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundSync, stopBackgroundSync } = await import(
      "@/lib/mail/background-sync"
    );
    startBackgroundSync();

    // Graceful shutdown: stop BullMQ workers + IDLE connections
    process.on("SIGTERM", () => {
      console.log("[instrumentation] SIGTERM received, shutting down...");
      stopBackgroundSync().catch(console.error);
    });
  }
}
