import { cleanupExpiredData } from "../db";
import { config } from "../config";

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startCleanupJob() {
  // 立即执行一次清理
  runCleanup();

  // 每小时执行一次清理
  cleanupInterval = setInterval(runCleanup, 60 * 60 * 1000);

  console.log(`Cleanup job started (retention: ${config.emailRetentionHours} hours)`);
}

export function stopCleanupJob() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log("Cleanup job stopped");
  }
}

function runCleanup() {
  try {
    console.log("Running cleanup...");
    cleanupExpiredData();
    console.log("Cleanup completed");
  } catch (error) {
    console.error("Cleanup error:", error);
  }
}
