import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger.config.js';

export class PrismaService {
  private static instance: PrismaService;
  public readonly client: PrismaClient;

  constructor() {
    this.client = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
    });
  }

  public static getInstance(): PrismaService {
    if (!PrismaService.instance) {
      PrismaService.instance = new PrismaService();
    }
    return PrismaService.instance;
  }

  public async connect(): Promise<void> {
    try {
      await this.client.$connect();
      logger.info('Successfully connected to PostgreSQL database via Prisma');
    } catch (error) {
      logger.error({ error }, 'Failed to connect to PostgreSQL database');
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.client.$disconnect();
      logger.info('Disconnected from PostgreSQL database');
    } catch (error) {
      logger.error({ error }, 'Error disconnecting from PostgreSQL database');
    }
  }

  public async checkHealth(): Promise<{
    status: 'up' | 'down';
    latencyMs?: number;
    error?: string;
  }> {
    const startTime = performance.now();
    try {
      // 2000ms strict timeout race wrapper
      const queryPromise = this.client.$queryRaw`SELECT 1`;
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('PostgreSQL ping timed out after 2000ms')), 2000),
      );

      await Promise.race([queryPromise, timeoutPromise]);
      const latencyMs = Math.round(performance.now() - startTime);
      return { status: 'up', latencyMs };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown database error';
      logger.error({ error }, 'PostgreSQL health check failed');
      return { status: 'down', error: errorMessage };
    }
  }
}
