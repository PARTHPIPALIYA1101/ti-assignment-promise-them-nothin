import { RedisService } from '../redis/redis.service.js';
import { BucketRedisService } from '../redis/bucket.redis.service.js';
import { BackupRepository } from '../repositories/backup.repository.js';
import { RedisRecoveryManager } from './redis-recovery.manager.js';
import { logger } from '../config/logger.config.js';

export type OperatingMode = 'REDIS' | 'DATABASE';

export class RedisHealthMonitor {
  private static instance: RedisHealthMonitor;
  private mode: OperatingMode = 'REDIS';
  private isTransitioning = false;
  private timerId: NodeJS.Timeout | null = null;
  private recoveryManager?: RedisRecoveryManager;

  constructor(
    private readonly redisService: RedisService = RedisService.getInstance(),
    bucketRedisService?: BucketRedisService,
    backupRepository?: BackupRepository,
    private readonly intervalMs: number = 5000,
  ) {
    if (bucketRedisService && backupRepository) {
      this.recoveryManager = new RedisRecoveryManager(bucketRedisService, backupRepository);
    }
  }

  public static getInstance(): RedisHealthMonitor {
    if (!RedisHealthMonitor.instance) {
      RedisHealthMonitor.instance = new RedisHealthMonitor();
    }
    return RedisHealthMonitor.instance;
  }

  public getMode(): OperatingMode {
    return this.mode;
  }

  public isTransitionInProgress(): boolean {
    return this.isTransitioning;
  }

  public start(): void {
    if (this.timerId !== null) return;

    this.timerId = setInterval(() => {
      this.checkHealth().catch((err) => {
        logger.error({ err }, 'Error during RedisHealthMonitor health check tick');
      });
    }, this.intervalMs);

    logger.info({ intervalMs: this.intervalMs }, 'RedisHealthMonitor started successfully');
  }

  public stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
      logger.info('RedisHealthMonitor stopped cleanly');
    }
  }

  /**
   * Ping Redis and trigger atomic mode transitions
   */
  public async checkHealth(): Promise<boolean> {
    const redisHealth = await this.redisService.checkHealth();
    const isHealthy = redisHealth.status === 'up';

    if (!isHealthy && this.mode === 'REDIS') {
      await this.transitionToDatabaseMode();
    } else if (isHealthy && this.mode === 'DATABASE') {
      await this.transitionToRedisMode();
    }

    return isHealthy;
  }

  public async transitionToDatabaseMode(): Promise<void> {
    if (this.isTransitioning || this.mode === 'DATABASE') return;

    this.isTransitioning = true;
    try {
      logger.warn('🚨 Redis outage detected. Atomically switching operating mode to DATABASE...');
      this.mode = 'DATABASE';
    } finally {
      this.isTransitioning = false;
    }
  }

  public async transitionToRedisMode(): Promise<void> {
    if (this.isTransitioning || this.mode === 'REDIS') return;

    this.isTransitioning = true;
    try {
      logger.info(
        '🔄 Redis recovery detected. Synchronizing PostgreSQL bucket backups to Redis...',
      );

      // Recovery Synchronization via RedisRecoveryManager
      if (this.recoveryManager) {
        const recoveryResult = await this.recoveryManager.recoverRedisData();

        if (recoveryResult.verified && recoveryResult.failedCount === 0) {
          this.mode = 'REDIS';
          logger.info(
            { syncedCount: recoveryResult.syncedCount },
            '✅ Atomically switched operating mode back to REDIS',
          );
        } else {
          logger.warn(
            { syncedCount: recoveryResult.syncedCount, failedCount: recoveryResult.failedCount },
            '⚠️ Partial recovery detected. Deferring mode switch to REDIS until full recovery passes.',
          );
        }
      } else {
        this.mode = 'REDIS';
      }
    } catch (err) {
      logger.error(
        { err },
        'Error synchronizing PostgreSQL backup state back to Redis on recovery',
      );
    } finally {
      this.isTransitioning = false;
    }
  }
}
