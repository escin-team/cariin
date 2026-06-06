import { serve } from '@hono/node-server';
import { app } from './bootstrap/app.js';
import { env } from './bootstrap/env-validation.js';
import { disconnectAll } from './db/client.js';
import { scheduleTokenCleanup } from './jobs/token-cleanup.job.js';

/**
 * Server Entry Point
 *
 * Env validation runs at import time (env-validation.ts).
 * If any env is missing/invalid, process.exit(1) happens before server starts.
 */

const port = parseInt(env.PORT, 10);

console.log(`
╔═══════════════════════════════════════════╗
║         CARIIN BACKEND API                ║
║         Environment: ${env.NODE_ENV.padEnd(16)}    ║
║         Port: ${String(port).padEnd(21)}    ║
╚═══════════════════════════════════════════╝
`);

const server = serve(
  {
    fetch: app.fetch,
    port,
  },
  async (info) => {
    console.log(`🚀 Server running at http://localhost:${info.port}`);
    console.log(`📋 Health check: http://localhost:${info.port}/health`);
    console.log(`💰 Wallet topup: POST http://localhost:${info.port}/v1/wallet/topup`);
    
    // Start background jobs
    await scheduleTokenCleanup();
    console.log("⚙️  Background jobs started");
  }
);

// Graceful shutdown
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n⚡ Received ${signal}. Shutting down gracefully...`);

  try {
    await disconnectAll();
    console.log('✅ Database connections closed.');
  } catch (err) {
    console.error('❌ Error during shutdown:', err);
  }

  server.close(() => {
    console.log('✅ Server closed.');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('⚠️ Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
