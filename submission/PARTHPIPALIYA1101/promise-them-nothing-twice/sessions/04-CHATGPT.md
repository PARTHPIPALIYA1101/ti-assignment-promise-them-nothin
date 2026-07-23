# Distributed Rate Limiter Phases

**User:** Anonymous  
**Created:** 7/23/2026 14:51:52  
**Updated:** 7/23/2026 14:52:12  
**Exported:** 7/24/2026 1:00:46  
**Link:** [https://chatgpt.com/c/6a61dd2b-f758-83e8-9b3f-9c85d2cd279c](https://chatgpt.com/c/6a61dd2b-f758-83e8-9b3f-9c85d2cd279c)  

## Prompt:
7/23/2026, 2:51:42 PM

I would build it in phases so that every phase is independently testable. Don't start with Redis failover or queues—first get a correct rate limiter working, then add features.

# Phase 1 — Project Setup

```
Spring Boot / Node / Java
        │
PostgreSQL
        │
Redis
```

Tasks

* Create project
* Connect PostgreSQL
* Connect Redis
* Health endpoint
* Docker Compose

---

# Phase 2 — Database

Tables

```
customers

plans

bucket_backup

queue_logs
```

Implement

* Customer CRUD (or seed data)
* Tier configuration
* Enterprise custom limits

Example

```
Basic ->100 RPM

Premium ->300 RPM

Enterprise ->Custom
```

---

# Phase 3 — Read Customer

Every request

```
Client

↓

Read X-Customer-ID

↓

Find customer

↓

Load plan

↓

Return RPM
```

If customer not found

```
401/404
```

---

# Phase 4 — Redis Integration

Store

```
customer:1:tokens

customer:1:last_refill

customer:1:burst
```

Create helper methods

```
getBucket()

saveBucket()

refill()

consume()
```

---

# Phase 5 — Token Bucket (Core)

Implement

```
Current Tokens

Last Refill Time

Capacity

Refill Rate
```

Flow

```
Receive Request

↓

Refill Tokens

↓

Enough Tokens?

↓

YES

↓

Consume

↓

Allow

↓

NO

↓

Reject
```

Test

```
300 RPM

Send 301 requests

300 pass

1 fail
```

---

# Phase 6 — Burst Bucket

When customer doesn't consume all tokens

```
Unused

↓

Burst Bucket
```

Example

```
300 RPM

Uses 50

↓

250 goes to burst

↓

Max Burst =300

↓

Expires after15 min
```

Flow

```
Normal Bucket Empty

↓

Burst Available?

↓

Yes

↓

Consume Burst

↓

Allow
```

---

# Phase 7 — Queue

Create in-memory or Redis queue.

Properties

```
Max Size =150

Wait =5 sec
```

Flow

```
No Token

↓

No Burst

↓

Queue

↓

Wait

↓

Token Comes

↓

Allow

Else

↓

429
```

---

# Phase 8 — Queue Scheduler

Background worker

```
Every100ms

↓

Check Queue

↓

Any Token?

↓

Release Request
```

---

# Phase 9 — PostgreSQL Backup

Every

```
10-15 seconds
```

Save

```
Customer

Tokens

Burst

Last Refill
```

Table

```
bucket_backup
```

---

# Phase 10 — Redis Health Check

Every few seconds

```
Ping Redis
```

If

```
Healthy

↓

Continue
```

Else

```
Switch Mode

↓

Database
```

---

# Phase 11 — Database Mode

Instead of Redis

```
Read Bucket

↓

Update Bucket

↓

Save Bucket
```

Everything works exactly like Redis.

---

# Phase 12 — Redis Recovery

When Redis returns

```
Read Latest Bucket

↓

Restore Redis

↓

Switch Nodes

↓

Redis Active
```

---

# Phase 13 — Logging

Log

```
Customer ID

Tier

Token Left

Burst Left

Queue Time

Rejected

Accepted
```

Store in PostgreSQL.

---

# Phase 14 — Testing

Test cases

```
✓ 100 RPM customer

✓ 300 RPM customer

✓ Enterprise customer

✓ Burst bucket

✓ Burst expiry

✓ Queue success

✓ Queue timeout

✓ Queue full

✓ Redis down

✓ Redis recovery

✓ Concurrent requests

✓ Invalid Customer ID

✓ Missing Header
```

---

# Recommended implementation order

```
1. Project setup
2. PostgreSQL
3. Customer lookup
4. Redis
5. Token bucket
6. Burst bucket
7. Queue
8. Queue worker
9. Backup to PostgreSQL
10. Redis health check
11. DB fallback
12. Redis recovery
13. Logging
14. Testing & optimization
```

This order minimizes complexity. By the end of **Phase 5**, you'll already have a working distributed rate limiter. Everything after that (burst tokens, queueing, failover, recovery) adds resilience and advanced behavior without requiring major redesign.

give whole prompt

## Response:
7/23/2026, 2:51:53 PM

Use this as a single master prompt for an AI coding assistant.

---

# Master Prompt — Build a Distributed Rate Limiter (Spring Boot + PostgreSQL + Redis)

You are a senior backend engineer. Your task is to build a production-style distributed rate limiter using **Java 21**, **Spring Boot 3**, **PostgreSQL**, and **Redis**.

The project must be built **incrementally in phases**. Do **not** skip ahead. Every phase should compile, run, and be independently testable before moving to the next phase.

Use clean architecture, SOLID principles, dependency injection, proper package structure, and production-quality code.

---

# Tech Stack

- Java 21
- Spring Boot 3
- Spring Web
- Spring Data JPA
- Spring Data Redis
- PostgreSQL
- Redis
- Docker Compose
- Maven
- Lombok
- Actuator

Project structure should be:

```
src/main/java
    controller
    service
    repository
    entity
    dto
    config
    exception
    util
    scheduler
```

---

# General Rules

- Build only the current phase.
- Do not implement future phases early.
- After every phase:
    - Explain what was built.
    - Show the folder structure.
    - Show every file.
    - Explain how to run it.
    - Explain how to test it.
- Code must compile.
- Keep business logic inside services.
- Use constructor injection only.
- Handle exceptions properly.
- Use REST conventions.
- Keep code readable.

---

# Phase 1 — Project Setup

## Goal

Create the project and connect all infrastructure.

Architecture

```
Spring Boot
      │
PostgreSQL
      │
Redis
```

### Tasks

Create Spring Boot project.

Add dependencies.

Configure

```
Spring Web
Spring Data JPA
PostgreSQL Driver
Spring Data Redis
Lombok
Actuator
```

Create

```
application.properties
```

Configure

PostgreSQL

Redis

Create Docker Compose containing

```
postgres
redis
```

Create

```
GET /health
```

Return

```json
{
    "status":"UP"
}
```

Verify

- PostgreSQL connected
- Redis connected
- Application starts successfully

Stop after Phase 1.

---

# Phase 2 — Database

Create tables.

```
customers

plans

bucket_backup

queue_logs
```

Plan example

```
Basic
100 RPM

Premium
300 RPM

Enterprise
Custom
```

Customer

```
id

name

plan_id

custom_limit(optional)
```

bucket_backup

```
customer_id

tokens

burst_tokens

last_refill

updated_at
```

queue_logs

```
customer_id

queued_at

released_at

wait_time

status
```

Implement

Repositories

Entities

Seed initial plans

Seed sample customers

Create CRUD for customers.

Stop after Phase 2.

---

# Phase 3 — Customer Lookup

Every request must follow

```
Client

↓

Read X-Customer-ID Header

↓

Find Customer

↓

Load Plan

↓

Determine RPM
```

If customer has custom limit

Use custom limit.

Otherwise

Use plan limit.

If customer missing

Return

```
404
```

If header missing

Return

```
400
```

Implement service only.

Do not build rate limiting yet.

Stop.

---

# Phase 4 — Redis Integration

Create Redis bucket storage.

Keys

```
customer:{id}:tokens

customer:{id}:last_refill

customer:{id}:burst
```

Implement helper methods

```
getBucket()

saveBucket()

refill()

consume()
```

No rate limiting yet.

Just read/write bucket state.

Stop.

---

# Phase 5 — Token Bucket (Core Rate Limiter)

Implement Token Bucket algorithm.

Bucket contains

```
Capacity

Current Tokens

Last Refill

Refill Rate
```

Flow

```
Receive Request

↓

Load Bucket

↓

Refill Tokens

↓

Enough Tokens?

↓

YES

↓

Consume Token

↓

Allow Request

↓

NO

↓

Reject Request
```

Return

```
200
```

or

```
429 Too Many Requests
```

Testing

Customer

```
300 RPM
```

Send

```
301 requests
```

Expected

```
300 success

1 rejected
```

Stop.

---

# Phase 6 — Burst Bucket

Implement burst token storage.

Unused tokens move into burst bucket.

Example

```
Capacity

300

Customer uses

50

↓

250 stored

↓

Maximum burst

300

↓

Expire after

15 minutes
```

Flow

```
Normal Bucket Empty

↓

Burst Exists?

↓

Yes

↓

Consume Burst

↓

Allow
```

Stop.

---

# Phase 7 — Queue

If both buckets empty

Place request into queue.

Use

Redis List

or

In-memory queue.

Queue configuration

```
Maximum Size

150
```

Maximum wait

```
5 seconds
```

Flow

```
No Tokens

↓

No Burst

↓

Queue Request

↓

Wait

↓

Token Available

↓

Release

↓

Success

Else

↓

429
```

Stop.

---

# Phase 8 — Queue Scheduler

Background worker.

Runs every

```
100 milliseconds
```

Flow

```
Check Queue

↓

Token Available?

↓

Release Waiting Request
```

Update queue logs.

Stop.

---

# Phase 9 — PostgreSQL Backup

Every

```
10–15 seconds
```

Persist Redis bucket state.

Save

```
Customer

Tokens

Burst Tokens

Last Refill
```

Store inside

```
bucket_backup
```

Stop.

---

# Phase 10 — Redis Health Check

Background scheduler.

Every few seconds

```
Ping Redis
```

If healthy

Continue.

If Redis unavailable

Switch application into

```
Database Mode
```

Stop.

---

# Phase 11 — Database Fallback Mode

When Redis unavailable

Instead of Redis

Use PostgreSQL.

Flow

```
Read Bucket

↓

Refill

↓

Consume

↓

Save Bucket
```

Behavior must remain identical.

No code duplication.

Stop.

---

# Phase 12 — Redis Recovery

When Redis becomes healthy

Read latest bucket data from PostgreSQL.

Restore Redis.

Switch application back.

Flow

```
Redis Healthy

↓

Read bucket_backup

↓

Restore Redis

↓

Redis Active
```

Stop.

---

# Phase 13 — Logging

Store request logs.

Fields

```
Customer ID

Plan

Remaining Tokens

Burst Tokens

Queue Time

Accepted

Rejected

Timestamp
```

Persist into PostgreSQL.

Provide endpoint to fetch logs.

Stop.

---

# Phase 14 — Testing

Create integration tests.

Test

```
✓ Basic Plan

✓ Premium Plan

✓ Enterprise Plan

✓ Custom Limit

✓ Missing Header

✓ Invalid Customer

✓ Token Bucket

✓ Burst Bucket

✓ Burst Expiry

✓ Queue Success

✓ Queue Timeout

✓ Queue Full

✓ Redis Down

✓ Redis Recovery

✓ Database Mode

✓ Concurrent Requests

✓ Scheduler

✓ Backup Job
```

Use concurrent request testing.

Verify thread safety.

---

# Recommended Build Order

```
1. Project Setup

2. PostgreSQL

3. Customer Lookup

4. Redis

5. Token Bucket

6. Burst Bucket

7. Queue

8. Queue Scheduler

9. PostgreSQL Backup

10. Redis Health Check

11. Database Fallback

12. Redis Recovery

13. Logging

14. Testing & Optimization
```

---

# Expected Deliverables for Every Phase

For each phase, always provide:

1. Explanation of what is being built.
2. Updated folder structure.
3. Complete source code for every new or modified file.
4. Configuration changes (`application.properties`, `docker-compose.yml`, etc.).
5. Database schema or migrations (if applicable).
6. Commands to run the application.
7. Commands or requests to test the feature (e.g., using Postman or curl).
8. Common errors and how to fix them.
9. Do not continue to the next phase until the current phase is complete and verified.

The objective is to end with a **production-ready distributed rate limiter** that supports plan-based limits, enterprise custom limits, Redis-backed token buckets, burst capacity, queueing, PostgreSQL backup, automatic Redis failover and recovery, detailed logging, and comprehensive testing.



---
Powered by [ChatGPT Exporter](https://www.chatgptexporter.com)