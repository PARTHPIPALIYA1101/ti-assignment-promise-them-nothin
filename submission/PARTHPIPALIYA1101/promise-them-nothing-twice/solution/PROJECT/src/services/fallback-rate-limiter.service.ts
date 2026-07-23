import { BucketRedisService } from '../redis/bucket.redis.service.js';
import { DatabaseRateLimiterService } from './database-rate-limiter.service.js';
import { RedisHealthMonitor } from '../health/redis-health.monitor.js';
import { ConsumeResult } from '../redis/bucket.types.js';
import { logger } from '../config/logger.config.js';

export class FallbackRateLimiterService {
  constructor(
    private readonly bucketRedisService: BucketRedisService,
    private readonly databaseRateLimiterService: DatabaseRateLimiterService,
    private readonly redisHealthMonitor: RedisHealthMonitor = RedisHealthMonitor.getInstance(),
  ) {}

  public async consumeToken(
    customerId: string,
    effectiveRpm: number,
    effectiveBurst: number,
    nowMs: number = Date.now(),
  ): Promise<ConsumeResult> {
    const currentMode = this.redisHealthMonitor.getMode();

    if (currentMode === 'REDIS') {
      try {
        return await this.bucketRedisService.consumeToken(
          customerId,
          effectiveRpm,
          effectiveBurst,
          nowMs,
        );
      } catch (error) {
        logger.warn(
          { error, customerId },
          'Redis evaluation failed mid-request. Falling back to Database Mode.',
        );
        await this.redisHealthMonitor.transitionToDatabaseMode();
        return this.databaseRateLimiterService.consumeToken(
          customerId,
          effectiveRpm,
          effectiveBurst,
          nowMs,
        );
      }
    }

    return this.databaseRateLimiterService.consumeToken(
      customerId,
      effectiveRpm,
      effectiveBurst,
      nowMs,
    );
  }
}
