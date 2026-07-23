import path from 'node:path';
import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { env } from './config/env.config.js';
import { errorHandler } from './middleware/error.middleware.js';
import { PrismaService } from './database/prisma.service.js';
import { RedisService } from './redis/redis.service.js';
import { BucketRedisService } from './redis/bucket.redis.service.js';
import { RequestQueueManager } from './queue/request.queue.js';
import { QueueScheduler } from './scheduler/queue.scheduler.js';
import { BackupScheduler } from './scheduler/backup.scheduler.js';
import { RedisHealthMonitor } from './health/redis-health.monitor.js';
import { DatabaseRateLimiterService } from './services/database-rate-limiter.service.js';
import { FallbackRateLimiterService } from './services/fallback-rate-limiter.service.js';
import { RequestLoggerService } from './services/request-logger.service.js';
import { HealthService } from './health/health.service.js';
import { HealthController } from './health/health.controller.js';
import { healthRoutes } from './health/health.routes.js';
import { PlanRepository } from './repositories/plan.repository.js';
import { CustomerRepository } from './repositories/customer.repository.js';
import { BackupRepository } from './repositories/backup.repository.js';
import { QueueLogRepository } from './repositories/queue-log.repository.js';
import { PlanService } from './services/plan.service.js';
import { CustomerService } from './services/customer.service.js';
import { PlanController } from './controllers/plan.controller.js';
import { CustomerController } from './controllers/customer.controller.js';
import { planRoutes } from './routes/plan.routes.js';
import { customerRoutes } from './routes/customer.routes.js';
import { protectedRoutes } from './routes/protected.routes.js';

export async function createApp(): Promise<FastifyInstance> {
  const app = fastify({
    logger: false,
    disableRequestLogging: false,
  });

  // Security & CORS Middleware
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true });

  // Serve static dashboard UI
  await app.register(fastifyStatic, {
    root: path.resolve(process.cwd(), 'public'),
    prefix: '/',
  });

  // Global Error Handler
  app.setErrorHandler(errorHandler);

  // Core Singletons
  const prismaService = PrismaService.getInstance();
  const redisService = RedisService.getInstance();
  const bucketRedisService = new BucketRedisService(redisService);
  const requestQueueManager = RequestQueueManager.getInstance();

  // Repositories
  const planRepository = new PlanRepository(prismaService);
  const customerRepository = new CustomerRepository(prismaService);
  const backupRepository = new BackupRepository(prismaService);
  const queueLogRepository = new QueueLogRepository(prismaService);

  // Services
  const databaseRateLimiterService = new DatabaseRateLimiterService(backupRepository);
  const requestLoggerService = new RequestLoggerService(queueLogRepository);

  // Redis Health Monitor & Fallback Service
  const redisHealthMonitor = new RedisHealthMonitor(
    redisService,
    bucketRedisService,
    backupRepository,
    5000,
  );
  const fallbackRateLimiterService = new FallbackRateLimiterService(
    bucketRedisService,
    databaseRateLimiterService,
    redisHealthMonitor,
  );

  // Background Workers (Queue Scheduler 100ms & Backup Scheduler 10s)
  const queueScheduler = new QueueScheduler(
    bucketRedisService,
    customerRepository,
    requestQueueManager,
    100,
  );
  const backupScheduler = new BackupScheduler(
    bucketRedisService,
    customerRepository,
    backupRepository,
    10000,
  );

  app.addHook('onReady', async () => {
    redisHealthMonitor.start();
    queueScheduler.start();
    backupScheduler.start();
  });

  app.addHook('onClose', async () => {
    redisHealthMonitor.stop();
    await backupScheduler.stop(true);
    queueScheduler.stop();
    requestQueueManager.clearAllQueues();
  });

  // Services
  const planService = new PlanService(planRepository);
  const customerService = new CustomerService(customerRepository, planRepository);
  const healthService = new HealthService(prismaService, redisService);

  // Controllers
  const planController = new PlanController(planService);
  const customerController = new CustomerController(customerService);
  const healthController = new HealthController(healthService);

  // Routes
  await app.register(healthRoutes(healthController));
  await app.register(planRoutes(planController));
  await app.register(customerRoutes(customerController));

  // Protected / Development Routes
  if (env.NODE_ENV !== 'production') {
    await app.register(
      protectedRoutes(customerRepository, fallbackRateLimiterService, requestLoggerService),
    );
  }

  return app;
}
