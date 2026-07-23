import { CreateQueueLogData, QueueLogRepository } from '../repositories/queue-log.repository.js';
import { logger } from '../config/logger.config.js';

export class RequestLoggerService {
  constructor(private readonly queueLogRepository: QueueLogRepository) {}

  /**
   * Log request audit entry asynchronously in non-blocking fashion with error isolation
   */
  public logRequest(entry: CreateQueueLogData): void {
    // Dispatch async write without awaiting to avoid HTTP latency penalties
    Promise.resolve()
      .then(() => this.queueLogRepository.createLog(entry))
      .catch((err) => {
        // Failure Resilience: Logging errors never crash or block HTTP response handling
        logger.warn(
          { err, customerId: entry.customerId },
          'Error recording request log entry in PostgreSQL queue_logs',
        );
      });
  }
}
