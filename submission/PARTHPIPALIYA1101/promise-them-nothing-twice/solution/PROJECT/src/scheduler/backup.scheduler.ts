import { BucketRedisService } from '../redis/bucket.redis.service.js';
import { CustomerRepository } from '../repositories/customer.repository.js';
import { BackupRepository } from '../repositories/backup.repository.js';
import { logger } from '../config/logger.config.js';

export class BackupScheduler {
  private timerId: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly bucketRedisService: BucketRedisService,
    private readonly customerRepository: CustomerRepository,
    private readonly backupRepository: BackupRepository,
    private readonly intervalMs: number = 10000, // Default 10 seconds
  ) {}

  public isRunning(): boolean {
    return this.timerId !== null;
  }

  /**
   * Start 10-second background backup worker (Idempotent: prevents duplicate workers)
   */
  public start(): void {
    if (this.timerId !== null) {
      logger.warn(
        'BackupScheduler.start() called while already running. Duplicate worker ignored.',
      );
      return;
    }

    this.timerId = setInterval(() => {
      this.performBackup().catch((err) => {
        logger.error({ err }, 'Unexpected error in BackupScheduler tick handler');
      });
    }, this.intervalMs);

    logger.info({ intervalMs: this.intervalMs }, 'BackupScheduler started successfully');
  }

  /**
   * Stop background worker cleanly.
   * If runFinalBackup is true (e.g. process shutdown hook), executes a synchronous final backup cycle before exit.
   */
  public async stop(runFinalBackup = false): Promise<void> {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    if (runFinalBackup) {
      logger.info('Executing final bucket backup before process shutdown...');
      await this.performBackup().catch((err) => {
        logger.error({ err }, 'Error executing final bucket backup on shutdown');
      });
    }

    this.isProcessing = false;
    logger.info('BackupScheduler stopped cleanly');
  }

  /**
   * Tick handler backing up Redis token bucket states to PostgreSQL bucket_backup table
   * Returns total number of backed up customer buckets
   */
  public async performBackup(): Promise<number> {
    // Re-entrancy Lock: Prevent a new backup tick from starting if previous tick is still running
    if (this.isProcessing) {
      logger.debug('Previous BackupScheduler tick is still processing. Skipping tick.');
      return 0;
    }

    this.isProcessing = true;
    let backedUpCount = 0;

    try {
      // Fetch all customer IDs from database
      const customers = await this.customerRepository.findAll(1, 1000);
      if (customers.items.length === 0) {
        return 0;
      }

      // Sync each customer's Redis token bucket state to PostgreSQL bucket_backup
      for (const customer of customers.items) {
        try {
          const redisBucket = await this.bucketRedisService.getBucket(customer.id);
          if (!redisBucket) {
            continue;
          }

          const lastRefillDate = new Date(redisBucket.lastRefill);

          await this.backupRepository.upsertBackup(
            customer.id,
            redisBucket.tokens,
            redisBucket.burstTokens,
            lastRefillDate,
          );

          backedUpCount++;
        } catch (err) {
          // Per-Customer Fault Isolation: An error backing up Customer A will not stop Customer B
          logger.error({ err, customerId: customer.id }, 'Error backing up bucket for customer');
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return backedUpCount;
  }
}
