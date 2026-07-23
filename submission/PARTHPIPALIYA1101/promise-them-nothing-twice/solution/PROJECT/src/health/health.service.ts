import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

export interface ComponentHealthStatus {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  services: {
    api: ComponentHealthStatus;
    postgres: ComponentHealthStatus;
    redis: ComponentHealthStatus;
  };
}

export class HealthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  public async getHealth(): Promise<HealthCheckResult> {
    // Run database and redis health checks concurrently
    const [postgresHealth, redisHealth] = await Promise.all([
      this.prismaService.checkHealth(),
      this.redisService.checkHealth(),
    ]);

    const isHealthy = postgresHealth.status === 'up' && redisHealth.status === 'up';

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        api: {
          status: 'up',
        },
        postgres: postgresHealth,
        redis: redisHealth,
      },
    };
  }
}
