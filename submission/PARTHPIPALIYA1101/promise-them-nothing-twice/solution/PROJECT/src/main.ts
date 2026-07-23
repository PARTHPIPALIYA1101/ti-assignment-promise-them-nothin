import { createApp } from './app.js';
import { env } from './config/env.config.js';
import { logger } from './config/logger.config.js';
import { PrismaService } from './database/prisma.service.js';
import { RedisService } from './redis/redis.service.js';

async function bootstrap(): Promise<void> {
  const prismaService = PrismaService.getInstance();
  const redisService = RedisService.getInstance();

  try {
    logger.info('Initializing application infrastructure...');

    // Connect DB and Redis (non-blocking / gracefully handled if down at startup)
    await prismaService.connect().catch((err) => {
      logger.warn({ err }, 'PostgreSQL connection failed during startup (will retry on demand)');
    });

    await redisService.connect().catch((err) => {
      logger.warn({ err }, 'Redis connection failed during startup (will retry on demand)');
    });

    const app = await createApp();

    const address = await app.listen({
      port: env.PORT,
      host: env.HOST,
    });

    logger.info(`Server running at ${address} in ${env.NODE_ENV} mode`);

    // Graceful Shutdown Signals
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`Received ${signal}. Gracefully shutting down...`);
      try {
        await app.close();
        await prismaService.disconnect();
        await redisService.disconnect();
        logger.info('Application shut down cleanly');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during graceful shutdown');
        process.exit(1);
      }
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error) {
    logger.fatal({ error }, 'Fatal error during application startup');
    process.exit(1);
  }
}

void bootstrap();
