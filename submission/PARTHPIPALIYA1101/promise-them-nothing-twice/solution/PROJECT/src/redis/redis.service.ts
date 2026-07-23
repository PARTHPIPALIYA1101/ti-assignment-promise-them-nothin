import Redis from 'ioredis';
import { env } from '../config/env.config.js';
import { logger } from '../config/logger.config.js';

export class RedisService {
  private static instance: RedisService;
  private readonly redisClient: Redis;

  constructor() {
    this.redisClient = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy(times: number): number {
        const delay = Math.min(times * 100, 3000);
        return delay;
      },
    });

    this.redisClient.on('error', (err) => {
      logger.error({ err }, 'Redis Client Error');
    });
  }

  public static getInstance(): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService();
    }
    return RedisService.instance;
  }

  public getClient(): Redis {
    return this.redisClient;
  }

  public async connect(): Promise<void> {
    try {
      await this.redisClient.connect();
      logger.info('Successfully connected to Redis cache');
    } catch (error) {
      logger.error({ error }, 'Failed to connect to Redis cache');
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.redisClient.quit();
      logger.info('Disconnected from Redis cache');
    } catch (error) {
      logger.error({ error }, 'Error disconnecting from Redis cache');
    }
  }

  public async checkHealth(): Promise<{
    status: 'up' | 'down';
    latencyMs?: number;
    error?: string;
  }> {
    const startTime = performance.now();
    try {
      // 2000ms strict timeout race wrapper
      const pingPromise = this.redisClient.ping();
      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Redis ping timed out after 2000ms')), 2000),
      );

      const pong = await Promise.race([pingPromise, timeoutPromise]);
      if (pong === 'PONG') {
        const latencyMs = Math.round(performance.now() - startTime);
        return { status: 'up', latencyMs };
      }
      return { status: 'down', error: 'Unexpected Redis ping response' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown Redis error';
      logger.error({ error }, 'Redis health check failed');
      return { status: 'down', error: errorMessage };
    }
  }
}
