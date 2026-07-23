# Enterprise Rate Limiter Infrastructure

An enterprise-grade, distributed Rate Limiting and Traffic Management system built with **Node.js, TypeScript, Fastify, Redis, PostgreSQL, and Prisma ORM**. Designed to handle high-concurrency workloads with sub-millisecond execution, atomic token refilling, burst traffic scaling, FIFO request queueing, automatic database fallback, and recovery synchronization.

---

## Architecture & System Features

- **Atomic Redis Token Bucket Engine**: Single source of truth atomic Lua script executing fractional refills, 15-minute sliding window burst resets, token consumption, and `Retry-After` calculations inside Redis atomically.
- **Burst Bucket & 15-Min Inactivity Expiration**: Automatically accumulates excess base tokens into burst capacity (up to 5,000 burst tokens) and resets inactive burst tokens after 15 minutes.
- **In-Memory FIFO Request Queue**: Queues requests when buckets are empty (up to 150 request capacity) with 5-second wait timeouts, duplicate request ID prevention, and TCP socket client disconnect cleanup.
- **Background Queue Scheduler Worker**: 100-millisecond background worker evaluating token availability and releasing queued items in strict FIFO order with re-entrancy locks and fault isolation.
- **PostgreSQL Bucket Backup**: 10-second background worker persisting Redis bucket states (`tokens`, `burstTokens`, `lastRefill`) into PostgreSQL `bucket_backup` table via Prisma `upsert`.
- **Redis Health Monitor & Database Fallback Mode**: Pings Redis every 5 seconds. Automatically switches to Database Mode on Redis outage without request loss or HTTP 500 errors.
- **Redis Recovery Manager**: Automatically restores PostgreSQL bucket backups into Redis and verifies data synchronization before returning to Redis Mode.
- **Audit Request Logging**: Non-blocking asynchronous logging persistence into PostgreSQL `queue_logs` table (`customerId`, `plan`, `tokensRemaining`, `burstRemaining`, `queueWaitMs`, `status`, `createdAt`).

---

## Tech Stack

- **Runtime**: Node.js (v22+)
- **Language**: TypeScript (v5+)
- **Web Framework**: Fastify (v5+)
- **Primary Cache**: Redis (v7+ via `ioredis`)
- **Database**: PostgreSQL (v16+ via Prisma ORM)
- **Logging**: Pino (Structured JSON logging)
- **Validation**: Zod (Environment & API input schema validation)
- **Testing**: Vitest & Autocannon (Real TCP HTTP load testing)

---

## Getting Started

### 1. Prerequisites

Make sure you have installed:
- Node.js (v22 or higher)
- Docker & Docker Compose
- Git

### 2. Environment Configuration

Copy the example environment file `.env.example` to `.env`:

```bash
cp .env.example .env
```

Ensure your `.env` contains:

```env
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

DATABASE_URL="postgresql://postgres:postgres@localhost:5432/fastify_db?schema=public"

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

### 3. Start Infrastructure Services via Docker

Launch PostgreSQL and Redis containers:

```bash
docker-compose up -d
```

### 4. Install Dependencies & Run Database Migrations

```bash
# Install NPM dependencies
npm install

# Generate Prisma Client & Run Database Migrations
npx prisma migrate dev --name init

# Seed Default Plans (Basic, Premium, Enterprise) & Demo Customers
npm run seed
```

### 5. Start the Application

```bash
# Development Mode (Hot Reload)
npm run dev

# Production Build & Start
npm run build
npm start
```

The Fastify server will start on `http://localhost:3000`.

---

## API Documentation & Headers

### Core Endpoints

| Method | Endpoint | Description | Auth Header |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Server, PostgreSQL & Redis health status | None |
| `GET` | `/api/v1/plans` | List rate limit plans (Paginated) | None |
| `GET` | `/api/v1/customers` | List customers (Paginated) | None |
| `POST` | `/api/v1/customers` | Create new customer | None |
| `GET` | `/api/v1/protected/ping` | Rate-limited protected test route | `X-Customer-ID: <UUID>` |

### Standard Response Headers

Every rate-limited HTTP response injects standard spec headers:

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Burst-Remaining: 50
```

When rate limits are exceeded (HTTP 429 Too Many Requests):

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Burst-Remaining: 0
Retry-After: 3
```

---

## Running Test & Verification Suites

### Complete Test Matrix (94 Vitest Tests)

Run all unit, integration, stress, failure, and E2E tests:

```bash
npm test
```

### Code Quality & Static Analysis

```bash
# TypeScript strict type check
npm run type-check

# ESLint audit & fix
npm run lint
npm run lint:fix

# Prettier format check & fix
npm run format:check
npm run format
```

### Real HTTP Network Load Benchmark (Autocannon)

Run a real TCP network HTTP stress test simulating concurrent connections across 50, 100, 250, and 500 connections:

```bash
npm run load-test
```

---

## Project Directory Structure

```
├── prisma/
│   └── schema.prisma            # Prisma PostgreSQL Models
├── src/
│   ├── app.ts                   # Fastify Application Factory & Lifecycle Hooks
│   ├── server.ts                # Application Entrypoint
│   ├── config/                  # Environment (Zod) & Pino Logger Configs
│   ├── database/                # Prisma Client Singleton & Health Check
│   ├── redis/                   # Redis Client & Atomic Lua Script Service
│   ├── repositories/            # Plan, Customer, Backup & QueueLog Repositories
│   ├── services/                # Plan, Customer, Database & Logger Services
│   ├── middleware/              # Customer Lookup & Rate Limiter Middlewares
│   ├── scheduler/               # Queue Scheduler (100ms) & Backup Scheduler (10s)
│   ├── health/                  # Health Controller, Service, Monitor & Recovery
│   ├── queue/                   # Request Queue Manager (FIFO, Timeout, Disconnect)
│   ├── routes/                  # API Routes (Health, Plan, Customer, Protected)
│   └── utils/                   # Custom AppError Hierarchy & Response Utilities
├── tests/                       # 14 Test Suites (Vitest)
└── scripts/                     # Seed Script & Autocannon Load Tester
```
