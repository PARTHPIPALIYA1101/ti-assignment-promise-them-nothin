import autocannon from 'autocannon';
import { createApp } from '../src/app.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';

interface ScalingResult {
  connections: number;
  totalRequests: number;
  reqPerSec: number;
  p50: number;
  p95: number;
  p99: number;
  status2xx: number;
  status429: number;
}

async function runBenchmark(): Promise<void> {
  console.log('🚀 Initializing application for High-Concurrency TCP HTTP Benchmark...');

  const prismaService = PrismaService.getInstance();
  const redisService = RedisService.getInstance();

  await prismaService.connect().catch(() => {});
  await redisService.connect().catch(() => {});

  const redisClient = redisService.getClient();

  // Fetch or seed a test customer
  let customer = await prismaService.client.customer.findFirst({
    include: { plan: true },
  });

  if (!customer) {
    const basicPlan = await prismaService.client.plan.upsert({
      where: { name: 'BASIC' },
      update: {},
      create: { name: 'BASIC', rpmLimit: 100, burstLimit: 100 },
    });
    customer = await prismaService.client.customer.create({
      data: {
        name: 'Benchmark Customer',
        email: 'benchmark@example.com',
        planId: basicPlan.id,
      },
      include: { plan: true },
    });
  }

  const app = await createApp();
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  console.log(`✅ Server listening at ${address}`);

  const customerId = customer.id;
  const connectionLevels = [50, 100, 250, 500];
  const resultsTable: ScalingResult[] = [];

  console.log(`\n=====================================================`);
  console.log(`🔥 HIGH-CONCURRENCY SCALING BENCHMARK (50, 100, 250, 500 connections)`);
  console.log(`=====================================================\n`);

  for (const connections of connectionLevels) {
    console.log(`▶ Running benchmark with ${connections} concurrent TCP connections...`);

    // Measure pre-benchmark Redis command stats
    const redisStatsPre = await redisClient.info('commandstats').catch(() => '');

    const result = await new Promise<autocannon.Result>((resolve) => {
      const instance = autocannon({
        url: `${address}/api/v1/protected/ping`,
        connections,
        amount: 1000,
        headers: {
          'x-customer-id': customerId,
        },
      });

      autocannon.track(instance, { renderProgressBar: false });
      instance.on('done', resolve);
    });

    // Measure post-benchmark Redis info
    const redisStatsPost = await redisClient.info('commandstats').catch(() => '');

    resultsTable.push({
      connections,
      totalRequests: result.requests.total,
      reqPerSec: Math.round(result.requests.average),
      p50: result.latency.p50,
      p95: result.latency.p95 || result.latency.p90,
      p99: result.latency.p99,
      status2xx: result['2xx'] || 0,
      status429: result['4xx'] || 0,
    });

    console.log(`   ✔ Completed ${connections} connections: ${Math.round(result.requests.average)} req/sec | p50: ${result.latency.p50}ms | p99: ${result.latency.p99}ms`);
  }

  console.log('\n========================================================================================');
  console.log('📊 CONCURRENCY SCALING PERFORMANCE RESULTS TABLE');
  console.log('========================================================================================');
  console.table(resultsTable);

  console.log('\n🔍 REDIS PERFORMANCE & BOTTLENECK AUDIT');
  const redisInfo = await redisClient.info('clients').catch(() => '');
  console.log('Redis Clients Info:', redisInfo.trim());
  console.log('========================================================================================\n');

  await app.close();
  await prismaService.disconnect();
  await redisService.disconnect();

  process.exit(0);
}

runBenchmark().catch((err) => {
  console.error('Fatal load test error:', err);
  process.exit(1);
});
