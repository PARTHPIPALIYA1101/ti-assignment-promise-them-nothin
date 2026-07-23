import { BucketRedisService } from '../redis/bucket.redis.service.js';
import { CustomerRepository } from '../repositories/customer.repository.js';
import { RequestQueueManager } from '../queue/request.queue.js';
import { logger } from '../config/logger.config.js';

export class QueueScheduler {
  private timerId: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly bucketRedisService: BucketRedisService,
    private readonly customerRepository: CustomerRepository,
    private readonly requestQueueManager: RequestQueueManager = RequestQueueManager.getInstance(),
    private readonly intervalMs: number = 100,
  ) {}

  public isRunning(): boolean {
    return this.timerId !== null;
  }

  /**
   * Start 100ms background queue scheduler worker (Idempotent: prevents duplicate workers)
   */
  public start(): void {
    if (this.timerId !== null) {
      logger.warn('QueueScheduler.start() called while already running. Duplicate worker ignored.');
      return;
    }

    this.timerId = setInterval(() => {
      this.processQueues().catch((err) => {
        logger.error({ err }, 'Unexpected error in QueueScheduler tick handler');
      });
    }, this.intervalMs);

    logger.info({ intervalMs: this.intervalMs }, 'QueueScheduler started successfully');
  }

  /**
   * Stop background worker cleanly
   */
  public stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
      this.isProcessing = false;
      logger.info('QueueScheduler stopped cleanly');
    }
  }

  /**
   * Tick handler processing all active customer queues
   * Returns total number of released requests in this tick
   */
  public async processQueues(): Promise<number> {
    // Re-entrancy Lock: Prevent a new tick from starting if previous tick is still running
    if (this.isProcessing) {
      logger.debug('Previous QueueScheduler tick is still processing. Skipping tick.');
      return 0;
    }

    this.isProcessing = true;
    let totalReleased = 0;

    try {
      const activeCustomerIds = this.requestQueueManager.getActiveCustomerIds();
      if (activeCustomerIds.length === 0) {
        return 0;
      }

      // Process each customer queue independently
      for (const customerId of activeCustomerIds) {
        try {
          const rateLimitContext =
            await this.customerRepository.findRateLimitContextById(customerId);
          if (!rateLimitContext) {
            continue;
          }

          const effectiveRpm = rateLimitContext.customRpmLimit ?? rateLimitContext.plan.rpmLimit;
          const effectiveBurst =
            rateLimitContext.customBurstLimit ?? rateLimitContext.plan.burstLimit;

          // Process queued items for this customer while tokens are available and queue has items
          while (this.requestQueueManager.getQueueSize(customerId) > 0) {
            const result = await this.bucketRedisService.consumeToken(
              customerId,
              effectiveRpm,
              effectiveBurst,
            );

            if (result.allowed) {
              const released = this.requestQueueManager.releaseNext(customerId);
              if (released) {
                totalReleased++;
              } else {
                break;
              }
            } else {
              // No tokens available for this customer -> stop processing this customer's queue
              break;
            }
          }
        } catch (err) {
          // Per-Customer Fault Tolerance: If processing one customer fails, continue processing others!
          logger.error({ err, customerId }, 'Error processing queue for customer');
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return totalReleased;
  }
}
