import { BucketBackup } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export class BackupRepository {
  constructor(private readonly prismaService: PrismaService) {}

  public async upsertBackup(
    customerId: string,
    tokens: number,
    burstTokens: number,
    lastRefill: Date,
  ): Promise<BucketBackup> {
    return this.prismaService.client.bucketBackup.upsert({
      where: { customerId },
      update: {
        tokens,
        burstTokens,
        lastRefill,
      },
      create: {
        customerId,
        tokens,
        burstTokens,
        lastRefill,
      },
    });
  }

  public async findByCustomerId(customerId: string): Promise<BucketBackup | null> {
    return this.prismaService.client.bucketBackup.findUnique({
      where: { customerId },
    });
  }

  public async findAllBackups(): Promise<BucketBackup[]> {
    return this.prismaService.client.bucketBackup.findMany({
      orderBy: { updatedAt: 'desc' },
    });
  }
}
