import { logger } from '../config/logger.config.js';

export interface QueueItem {
  requestId: string;
  enqueuedAt: number;
  timer: NodeJS.Timeout;
  resolve: (value: boolean) => void;
}

export class RequestQueueManager {
  private static instance: RequestQueueManager;
  private readonly queues: Map<string, QueueItem[]> = new Map();
  private readonly maxQueueSize: number = 150;
  private readonly defaultTimeoutMs: number = 5000;

  public static getInstance(): RequestQueueManager {
    if (!RequestQueueManager.instance) {
      RequestQueueManager.instance = new RequestQueueManager();
    }
    return RequestQueueManager.instance;
  }

  public getQueueSize(customerId: string): number {
    const queue = this.queues.get(customerId);
    return queue ? queue.length : 0;
  }

  public getActiveCustomerIds(): string[] {
    const activeIds: string[] = [];
    for (const [customerId, queue] of this.queues.entries()) {
      if (queue.length > 0) {
        activeIds.push(customerId);
      }
    }
    return activeIds;
  }

  /**
   * Enqueue request into customer FIFO queue.
   * Returns Promise resolving to true if released with token, or false if timed out/removed.
   */
  public enqueue(
    customerId: string,
    requestId: string,
    timeoutMs: number = this.defaultTimeoutMs,
  ): Promise<boolean> {
    const queue = this.queues.get(customerId) ?? [];

    // 1. Capacity Check: Max 150 requests per customer queue
    if (queue.length >= this.maxQueueSize) {
      logger.warn(
        { customerId, requestId, currentSize: queue.length },
        'Request queue full. Enqueue rejected.',
      );
      return Promise.resolve(false);
    }

    // 2. Duplicate Check: Prevent duplicate queue entries for same request ID
    if (queue.some((item) => item.requestId === requestId)) {
      logger.warn({ customerId, requestId }, 'Duplicate request ID in queue ignored.');
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      // 5-second timeout handler
      const timer = setTimeout(() => {
        this.remove(customerId, requestId);
        logger.warn({ customerId, requestId }, 'Queued request timed out after 5 seconds');
        resolve(false);
      }, timeoutMs);

      const newItem: QueueItem = {
        requestId,
        enqueuedAt: Date.now(),
        timer,
        resolve,
      };

      queue.push(newItem);
      this.queues.set(customerId, queue);
    });
  }

  /**
   * Release the oldest queued request in strict FIFO order
   */
  public releaseNext(customerId: string): boolean {
    const queue = this.queues.get(customerId);
    if (!queue || queue.length === 0) {
      return false;
    }

    const item = queue.shift()!;
    clearTimeout(item.timer);
    if (queue.length === 0) {
      this.queues.delete(customerId);
    }

    item.resolve(true);
    return true;
  }

  /**
   * Remove specific request (e.g. on client disconnect or timeout)
   */
  public remove(customerId: string, requestId: string): boolean {
    const queue = this.queues.get(customerId);
    if (!queue) return false;

    const index = queue.findIndex((item) => item.requestId === requestId);
    if (index !== -1) {
      const [item] = queue.splice(index, 1);
      if (item) {
        clearTimeout(item.timer);
        item.resolve(false);
      }
      if (queue.length === 0) {
        this.queues.delete(customerId);
      }
      return true;
    }
    return false;
  }

  /**
   * Clear all queues safely on server shutdown / restart
   */
  public clearAllQueues(): void {
    for (const [customerId, queue] of this.queues.entries()) {
      for (const item of queue) {
        clearTimeout(item.timer);
        item.resolve(false);
      }
      this.queues.delete(customerId);
    }
    logger.info('All request queues cleared safely');
  }
}
