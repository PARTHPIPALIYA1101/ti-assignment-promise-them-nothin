# Distributed Rate Limiter & Load Harness Solution

This repository contains a complete, production-grade **Enterprise Rate Limiter Infrastructure** paired with a **k6 Load Harness** to simulate high-concurrency workloads and verify traffic rate limiting under various load scenarios.

---

## Project Structure

```
.
├── PROJECT/             # Fastify + TypeScript + Redis + PostgreSQL Rate Limiter Server
└── LOAD HARNESS/        # Node.js + k6 CLI Load Generator & Metrics Harness
```

### 1. [`PROJECT`](./PROJECT)
An enterprise-grade, distributed rate-limiting microservice built with **Node.js, TypeScript, Fastify, Redis, PostgreSQL, and Prisma ORM**.
- **Core Algorithm**: Token Bucket Engine with burst allowance and 15-minute sliding window inactivity expiration via atomic Redis Lua scripts.
- **Queueing & Resilience**: In-memory FIFO queue (up to 150 requests, 5s timeout), background queue worker, 10s PostgreSQL bucket state persistence, Redis outage DB fallback, and auto-recovery sync.
- **Auditing**: Asynchronous audit logging (`queue_logs` table).

### 2. [`LOAD HARNESS`](./LOAD%20HARNESS)
A modular terminal CLI harness powered by **Node.js and k6** to stress test rate limiters across 5 testing modes: `Constant`, `Ramp`, `Spike`, `Stress`, and `Soak`. Features real-time terminal progress metrics and formatted final summary reports.

---

## Quick Start Guide

### Step 1: Start Infrastructure & API Server (`PROJECT`)

```bash
cd PROJECT

# 1. Start PostgreSQL & Redis services via Docker
docker-compose up -d

# 2. Install dependencies & run Prisma migrations
npm install
npx prisma migrate dev --name init
npm run seed

# 3. Start development server (runs on http://localhost:3000)
npm run dev
```

### Step 2: Run Tests & Verification (`PROJECT`)

```bash
cd PROJECT

# Run full Vitest suite (94 test cases)
npm test

# Run code linting and formatting checks
npm run lint
npm run type-check
```

### Step 3: Launch Load Harness (`LOAD HARNESS`)

```bash
cd "../LOAD HARNESS"

# Install dependencies
npm install

# Run Interactive CLI Mode
npm start

# Or run Non-Interactive CLI Mode
node index.js --customer-id=bd116379-909c-4caf-85dd-a7a83f1f72dd --rpm=600 --duration=1m --mode=constant --yes
```

---

## Documentation Links

- [PROJECT Documentation & API Specification](./PROJECT/README.md)
- [LOAD HARNESS Documentation & Options](./LOAD%20HARNESS/README.md)
