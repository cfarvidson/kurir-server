export async function register() {
  // Only run on the Node.js server, not during build or in edge runtime
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundSync } = await import("@/lib/mail/background-sync");
    startBackgroundSync();
  }
}
