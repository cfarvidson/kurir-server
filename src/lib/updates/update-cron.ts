import { db } from "@/lib/db";
import { checkForUpdates } from "@/lib/updates/version-checker";
import { startUpdate } from "@/lib/updates/update-executor";
import { CHECK_INTERVAL_MS } from "@/lib/updates/constants";

let intervalId: ReturnType<typeof setInterval> | null = null;

async function runCheck() {
  try {
    const settings = await db.systemSettings.findUnique({
      where: { id: "singleton" },
    });

    if (settings?.updateMode === "off") {
      return;
    }

    const result = await checkForUpdates();

    if (
      result.updateAvailable &&
      settings?.updateMode === "auto" &&
      result.latestVersion !== "unknown"
    ) {
      console.log(
        `[update-cron] Auto-applying update to v${result.latestVersion}`,
      );
      await startUpdate(result.latestVersion, "auto");
    }
  } catch (error) {
    console.warn("[update-cron] Check failed:", error);
  }
}

export function startUpdateChecker() {
  if (intervalId) return;

  console.log(
    `[update-cron] Starting update checker (interval: ${CHECK_INTERVAL_MS / 3_600_000}h)`,
  );

  // Run first check after a 30s delay (let the app fully start)
  setTimeout(() => {
    runCheck();
    intervalId = setInterval(runCheck, CHECK_INTERVAL_MS);
  }, 30_000);
}

export function stopUpdateChecker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[update-cron] Update checker stopped");
  }
}
