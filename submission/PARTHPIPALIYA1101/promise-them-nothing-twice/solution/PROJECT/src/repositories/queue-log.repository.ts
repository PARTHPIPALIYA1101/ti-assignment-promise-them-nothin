import { QueueLog } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export interface CreateQueueLogData {
  customerId: string;
  plan?: string;
  tokensRemaining?: number;
  burstRemaining?: number;
  waitTimeMs?: number;
  queueWaitMs?: number;
  status: 'ACCEPTED' | 'REJECTED';
}

export class QueueLogRepository {
  constructor(private readonly prismaService: PrismaService) {}

  public async createLog(data: CreateQueueLogData): Promise<QueueLog> {
    return this.prismaService.client.queueLog.create({
      data: {
        customerId: data.customerId,
        waitTimeMs: data.waitTimeMs ?? data.queueWaitMs ?? 0,
        status: data.status,
      },
    });
  }

  public async createManyLogs(logs: CreateQueueLogData[]): Promise<number> {
    const records = logs.map((l) => ({
      customerId: l.customerId,
      waitTimeMs: l.waitTimeMs ?? l.queueWaitMs ?? 0,
      status: l.status,
    }));
    const res = await this.prismaService.client.queueLog.createMany({
      data: records,
    });
    return res.count;
  }

  public async findLogsByCustomerId(customerId: string, limit = 50): Promise<QueueLog[]> {
    return this.prismaService.client.queueLog.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
