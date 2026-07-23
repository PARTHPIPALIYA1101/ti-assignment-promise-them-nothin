import { BucketRedisService } from '../redis/bucket.redis.service.js';
import { BackupRepository } from '../repositories/backup.repository.js';
import { logger } from '../config/logger.config.js';

export interface RecoveryResult {
  syncedCount: number;
  failedCount: number;
  verified: boolean;
}

export class RedisRecoveryManager {
  constructor(
    private readonly bucketRedisService: BucketRedisService,
    private readonly backupRepository: BackupRepository,
  ) {}

  /**
   * Recovers bucket states from PostgreSQL back to Redis with partial failure resilience
   */
  public async recoverRedisData(): Promise<RecoveryResult> {
    let syncedCount = 0;
    let failedCount = 0;

    const backups = await this.backupRepository.findAllBackups();
    if (backups.length === 0) {
      return { syncedCount: 0, failedCount: 0, verified: true };
    }

    // Step 1: Restore each customer bucket into Redis (Partial failure resilience)
    for (const backup of backups) {
      try {
        await this.bucketRedisService.saveBucket(backup.customerId, {
          tokens: backup.tokens,
          burstTokens: backup.burstTokens,
          lastRefill: backup.lastRefill.getTime(),
        });
        syncedCount++;
      } catch (err) {
        failedCount++;
        logger.error(
          { err, customerId: backup.customerId },
          'Error restoring Redis bucket state for customer during recovery',
        );
      }
    }

    // Step 2: Synchronization Verification Check
    const verified = await this.verifySynchronization();

    logger.info(
      { syncedCount, failedCount, verified },
      'RedisRecoveryManager completed bucket state recovery',
    );

    return {
      syncedCount,
      failedCount,
      verified: verified && failedCount === 0,
    };
  }

  /**
   * Verifies that Redis data matches PostgreSQL backups
   */
  public async verifySynchronization(): Promise<boolean> {
    try {
      const backups = await this.backupRepository.findAllBackups();
      for (const backup of backups) {
        const redisBucket = await this.bucketRedisService.getBucket(backup.customerId);
        if (!redisBucket) {
          logger.warn(
            { customerId: backup.customerId },
            'Verification failed: Redis missing bucket after recovery',
          );
          return false;
        }
      }
      return true;
    } catch (err) {
      logger.error({ err }, 'Error during synchronization verification');
      return false;
    }
  }
}
