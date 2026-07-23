import { BackupRepository } from '../repositories/backup.repository.js';
import { ConsumeResult } from '../redis/bucket.types.js';

export class DatabaseRateLimiterService {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly backupRepository: BackupRepository) {}

  /**
   * Concurrency-safe atomic lock per customer to prevent race conditions and database deadlocks
   */
  private async acquireLock(customerId: string): Promise<() => void> {
    while (this.locks.has(customerId)) {
      await this.locks.get(customerId);
    }

    let releaseLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.locks.set(customerId, lockPromise);

    return () => {
      this.locks.delete(customerId);
      releaseLock();
    };
  }

  /**
   * Evaluates token bucket state in PostgreSQL with identical logic to Redis Lua script
   */
  public async consumeToken(
    customerId: string,
    rpmLimit: number,
    burstLimit: number,
    nowMs: number = Date.now(),
  ): Promise<ConsumeResult> {
    const release = await this.acquireLock(customerId);

    try {
      const burstWindowMs = 900000; // 15 minutes
      const backupRecord = await this.backupRepository.findByCustomerId(customerId);

      let tokens = backupRecord ? backupRecord.tokens : rpmLimit;
      let burstTokens = backupRecord ? backupRecord.burstTokens : 0;
      let lastRefill = backupRecord ? backupRecord.lastRefill.getTime() : nowMs;

      if (backupRecord) {
        const elapsedMs = nowMs - lastRefill;
        if (elapsedMs > 0) {
          // 1. 15-Minute Sliding Window Burst Expiration
          if (elapsedMs >= burstWindowMs) {
            burstTokens = 0;
          }

          // 2. Base Token Refill
          const refill = (elapsedMs / 60000.0) * rpmLimit;
          const totalBase = tokens + refill;

          if (totalBase > rpmLimit) {
            const overflow = totalBase - rpmLimit;
            burstTokens = Math.min(burstLimit, burstTokens + overflow);
            tokens = rpmLimit;
          } else {
            tokens = totalBase;
          }
          lastRefill = nowMs;
        }
      }

      let allowed = false;
      let source: 'BASE' | 'BURST' | 'NONE' = 'NONE';

      // 3. Base-First Token Consumption
      if (tokens >= 1.0) {
        tokens -= 1.0;
        allowed = true;
        source = 'BASE';
      } else if (burstTokens >= 1.0) {
        burstTokens -= 1.0;
        allowed = true;
        source = 'BURST';
      }

      // 4. Persist updated state to PostgreSQL bucket_backup
      await this.backupRepository.upsertBackup(
        customerId,
        tokens,
        burstTokens,
        new Date(lastRefill),
      );

      let retryAfterMs: number | undefined;
      if (!allowed && rpmLimit > 0) {
        retryAfterMs = Math.ceil((1.0 / rpmLimit) * 60000);
      }

      return {
        allowed,
        source,
        tokensRemaining: tokens,
        burstRemaining: burstTokens,
        ...(retryAfterMs !== undefined && { retryAfterMs }),
      };
    } finally {
      release();
    }
  }
}
