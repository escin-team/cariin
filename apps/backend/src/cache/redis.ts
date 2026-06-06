import { Redis } from "ioredis";
import { env } from "../bootstrap/env-validation.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 3000),
  enableOfflineQueue: false,
  lazyConnect: false,
});

redis.on("error", (err) => {
  console.error("[Redis Error]", err.message);
  // Jangan throw — app tetap jalan tanpa cache
});
