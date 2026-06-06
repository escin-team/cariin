import { Queue, Worker } from "bullmq";
import { env } from "../bootstrap/env-validation.js";

// Gunakan connection string langsung untuk menghindari konflik versi ioredis
const connection = {
  url: env.REDIS_URL,
};

// Queue untuk token cleanup
export const tokenCleanupQueue = new Queue("token-cleanup", {
  connection,
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 5,
  },
});

// Lazy import untuk mendapatkan tokenService
async function getTokenService() {
  const { tokenService } = await import("../modules/auth/token.service.js");
  return tokenService;
}

// Worker yang proses cleanup
new Worker(
  "token-cleanup",
  async (job) => {
    const tokenService = await getTokenService();
    const result = await tokenService.deleteExpiredTokens();
    console.log(`[TokenCleanup] Deleted ${result.deletedCount} expired tokens`);
    return result;
  },
  { connection },
);

// Jadwalkan cleanup setiap hari jam 03:00
export async function scheduleTokenCleanup() {
  // Hapus jadwal lama jika ada
  await tokenCleanupQueue.removeRepeatable("daily-cleanup", {
    pattern: "0 3 * * *",
  });

  await tokenCleanupQueue.add(
    "daily-cleanup",
    {},
    { repeat: { pattern: "0 3 * * *" } },
  );

  console.log("[TokenCleanup] Scheduled: daily at 03:00");
}
