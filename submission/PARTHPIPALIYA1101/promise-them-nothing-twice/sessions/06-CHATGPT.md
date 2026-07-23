# Burst Bucket Mechanism

**User:** Anonymous  
**Created:** 7/23/2026 15:17:10  
**Updated:** 7/23/2026 15:40:27  
**Exported:** 7/24/2026 1:01:10  
**Link:** [https://chatgpt.com/c/6a61e30b-db64-83ee-b2db-621621761a8d](https://chatgpt.com/c/6a61e30b-db64-83ee-b2db-621621761a8d)  

## Prompt:
7/23/2026, 3:17:01 PM

Phase 6 — Burst Bucket
When customer doesn't consume all tokens
Unused
↓
Burst Bucket
Example
300 RPM
Uses 50
↓
250 goes to burst
↓
Max Burst =300
↓
Expires after15 min
Flow
Normal Bucket Empty
↓
Burst Available?
↓
Yes
↓
Consume Burst
↓
Allow

## Response:
7/23/2026, 3:17:12 PM

## Phase 6 — Burst Bucket

### Goal
Add a burst bucket so customers can temporarily use unused capacity from previous minutes. This allows short traffic spikes without permanently increasing their rate limit.

### Example

Customer plan:
- Rate Limit: **300 requests/minute**
- Token Bucket Capacity: **300**
- Maximum Burst Capacity: **300**
- Burst Expiry: **15 minutes**

Scenario:
1. Customer receives **300 tokens**.
2. They make only **50 requests** during the minute.
3. **250 unused tokens** are moved to the Burst Bucket.
4. Burst Bucket now contains **250 tokens**.
5. If the Burst Bucket already has tokens, do not exceed the maximum capacity of **300**.
6. Any burst tokens older than **15 minutes** are removed automatically.

---

### Flow

```
Incoming Request
       │
       ▼
Check Normal Bucket
       │
       ├── Tokens Available?
       │        │
       │       Yes
       │        │
       │   Consume Token
       │        │
       │      Allow
       │
       ▼
Normal Bucket Empty
       │
       ▼
Check Burst Bucket
       │
       ├── Burst Tokens Available?
       │        │
       │       Yes
       │        │
       │ Consume Burst Token
       │        │
       │      Allow
       │
       ▼
       No
       │
       ▼
Reject Request
```

---

### Redis Keys

```
customer:{id}:burst_tokens
customer:{id}:burst_last_updated
```

---

### Implementation Tasks

1. Create Burst Bucket storage in Redis.
2. At the end of each refill period, calculate unused tokens.
3. Move unused tokens to the Burst Bucket.
4. Ensure Burst Bucket never exceeds its maximum capacity.
5. Remove burst tokens that are older than 15 minutes.
6. When the normal bucket has no tokens, consume from the Burst Bucket.
7. If both buckets are empty, reject the request.

---

### Test Cases

**Test 1: Store Unused Tokens**
- Limit: 300 RPM
- Send 50 requests
- Expect Burst Bucket = 250

**Test 2: Use Burst Tokens**
- Normal Bucket = 0
- Burst Bucket = 200
- Send 100 requests
- All 100 requests should be allowed using burst tokens.

**Test 3: Burst Capacity**
- Burst Bucket already has 250 tokens.
- 100 unused tokens are added.
- Burst Bucket should remain at 300 (maximum capacity).

**Test 4: Expiry**
- Wait 15 minutes without using burst tokens.
- Expired burst tokens should be removed automatically.

**Test 5: Both Buckets Empty**
- Normal Bucket = 0
- Burst Bucket = 0
- Incoming request should receive **HTTP 429 Too Many Requests**.

## Prompt:
7/23/2026, 3:21:26 PM

Phase 7 — Queue
Create in-memory or Redis queue.
Properties
Max Size =150
Wait =5 sec
Flow
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

## Response:
7/23/2026, 3:21:36 PM

## Phase 7 — Waiting Queue

### Goal
When both the Normal Bucket and Burst Bucket are empty, don't reject the request immediately. Instead, place it in a short waiting queue. If a token becomes available within the wait time, process the request. Otherwise, return **HTTP 429 Too Many Requests**.

---

### Queue Configuration

- Queue Type: In-memory (`BlockingQueue`) or Redis (`Redis List` / `Redis Stream`)
- Maximum Queue Size: **150 requests**
- Maximum Wait Time: **5 seconds**
- Queue Order: **FIFO (First In, First Out)**

---

### Flow

```text
Incoming Request
       │
       ▼
Normal Bucket Has Token?
       │
   ┌───┴───┐
   │       │
 Yes      No
   │       │
Allow      ▼
      Burst Bucket Has Token?
             │
        ┌────┴────┐
        │         │
       Yes       No
        │         │
      Allow       ▼
            Queue Full?
               │
        ┌──────┴──────┐
        │             │
       Yes           No
        │             │
     Return 429   Add to Queue
                      │
                      ▼
                 Wait 5 Seconds
                      │
              Token Available?
                │          │
               Yes        No
                │          │
             Consume    Return 429
             Token
                │
             Allow
```

---

### Redis Keys (if using Redis)

```text
rate_limit:queue
rate_limit:queue:waiting
```

For an in-memory implementation, use a `BlockingQueue<RequestContext>`.

---

### Implementation Tasks

1. Create a FIFO queue.
2. Set the maximum queue size to **150**.
3. Before adding a request, check if the queue is full.
4. If the queue is full, immediately return **HTTP 429**.
5. Otherwise, enqueue the request.
6. Wait up to **5 seconds** for a token to become available.
7. If a token becomes available within the timeout:
   - Remove the request from the queue.
   - Consume the token.
   - Allow the request.
8. If no token becomes available within **5 seconds**:
   - Remove the request from the queue.
   - Return **HTTP 429 Too Many Requests**.

---

### Test Cases

**Test 1: Queue Request**
- Normal Bucket = 0
- Burst Bucket = 0
- Queue has space
- Request should enter the queue.

**Test 2: Token Available**
- Request waits in queue.
- A token is refilled after 2 seconds.
- Request should be processed successfully.

**Test 3: Timeout**
- No tokens become available within 5 seconds.
- Request should return **HTTP 429 Too Many Requests**.

**Test 4: Queue Full**
- Queue already contains 150 waiting requests.
- New request should be rejected immediately with **HTTP 429**.

**Test 5: FIFO Order**
- Queue contains Request A, Request B, and Request C.
- When a token becomes available, Request A should be processed first, followed by B, then C.

## Prompt:
7/23/2026, 3:27:44 PM

Phase 8 — Queue Scheduler
Background worker
Every100ms
↓
Check Queue
↓
Any Token?
↓
Release Request

## Response:
7/23/2026, 3:27:53 PM

## Phase 8 — Queue Scheduler

### Goal
Create a background scheduler that periodically checks the waiting queue. Whenever tokens become available, it releases queued requests in FIFO order.

---

### Scheduler Configuration

- Type: Background Worker / Scheduled Task
- Execution Interval: **100 ms**
- Queue Order: **FIFO**
- Runs Continuously

---

### Flow

```text
Scheduler Starts
       │
       ▼
Runs Every 100 ms
       │
       ▼
Is Queue Empty?
       │
   ┌───┴───┐
   │       │
  Yes      No
   │       │
 Sleep   Peek First Request
              │
              ▼
      Refill Customer Bucket
              │
              ▼
      Token Available?
         │          │
        Yes        No
         │          │
 Consume Token     Skip
         │
 Remove Request
         │
 Notify Waiting Thread
         │
 Continue Until
 No Tokens or Queue Empty
```

---

### Responsibilities

1. Run every **100 milliseconds**.
2. Check whether the waiting queue contains requests.
3. Peek at the first request (FIFO).
4. Refill the customer's token bucket if needed.
5. If a token is available:
   - Consume one token.
   - Remove the request from the queue.
   - Resume the waiting request.
6. Continue processing queued requests while tokens are available.
7. If no token is available, leave the request in the queue for the next scheduler run.

---

### Implementation Tasks

1. Create a scheduled background worker.
2. Configure it to execute every **100 ms**.
3. Read requests from the waiting queue.
4. Check token availability for each queued request.
5. Release requests when tokens become available.
6. Wake the blocked request (or complete its future/promise).
7. Stop processing when either:
   - The queue is empty, or
   - No more tokens are available.

---

### Test Cases

**Test 1: Empty Queue**
- Queue is empty.
- Scheduler should do nothing.

**Test 2: Single Waiting Request**
- One request is waiting.
- One token becomes available.
- Scheduler releases the request.

**Test 3: Multiple Waiting Requests**
- Queue contains 10 requests.
- 5 tokens become available.
- Scheduler releases the first 5 requests in FIFO order.

**Test 4: No Tokens**
- Queue contains waiting requests.
- No tokens are available.
- Requests remain queued until a future scheduler run.

**Test 5: Continuous Processing**
- Requests continue arriving while the scheduler is running.
- Scheduler processes them in FIFO order as tokens become available.

## Prompt:
7/23/2026, 3:33:12 PM

Phase 9 — PostgreSQL Backup
Every
10-15 seconds
Save
Customer
Tokens
Burst
Last Refill
Table
bucket_backup

## Response:
7/23/2026, 3:33:21 PM

## Phase 9 — PostgreSQL Backup

### Goal
Periodically back up the in-memory/Redis state of each customer's rate limiter to PostgreSQL. This allows recovery if Redis is lost or the application restarts.

---

### Backup Configuration

- Frequency: **Every 10–15 seconds**
- Destination: **PostgreSQL**
- Table: **bucket_backup**

---

### Data to Save

For each customer, store:

- Customer ID
- Current Tokens
- Current Burst Tokens
- Last Refill Timestamp
- Last Backup Timestamp

---

### Flow

```text
Background Backup Worker
          │
          ▼
Runs Every 10–15 Seconds
          │
          ▼
Read Bucket State from Redis
          │
          ▼
Update bucket_backup Table
          │
          ▼
Repeat
```

---

### Example Table

| Column | Type |
|---------|------|
| customer_id | BIGINT |
| tokens | INT |
| burst_tokens | INT |
| last_refill | TIMESTAMP |
| updated_at | TIMESTAMP |

---

### Responsibilities

1. Run a scheduled backup task every **10–15 seconds**.
2. Read the latest token bucket state from Redis.
3. Save:
   - Customer ID
   - Current Tokens
   - Burst Tokens
   - Last Refill Time
4. If the customer already exists in `bucket_backup`, update the existing row.
5. Otherwise, insert a new row.
6. Continue until all active customers are backed up.

---

### Implementation Tasks

1. Create the `bucket_backup` table.
2. Implement a scheduled backup worker.
3. Fetch active customer bucket data from Redis.
4. Insert or update (`UPSERT`) the backup record in PostgreSQL.
5. Log backup success or failures for monitoring.

---

### Test Cases

**Test 1: First Backup**
- Customer exists in Redis but not in PostgreSQL.
- A new row should be inserted.

**Test 2: Update Existing Record**
- Customer already exists in `bucket_backup`.
- Latest token and burst values should overwrite the previous values.

**Test 3: Multiple Customers**
- 100 active customers exist in Redis.
- All should be backed up during the scheduled run.

**Test 4: Redis State Changes**
- Customer consumes tokens.
- The next backup should persist the updated token count.

**Test 5: Application Recovery**
- Simulate Redis data loss.
- Restore bucket state from the latest records in `bucket_backup` and continue rate limiting without resetting all customers.

## Prompt:
7/23/2026, 3:37:01 PM

Phase 10 — Redis Health Check
Every few seconds
Ping Redis
If
Healthy
↓
Continue
Else
Switch Mode
↓
Database

## Response:
7/23/2026, 3:37:10 PM

## Phase 10 — Redis Health Check & Failover

### Goal
Continuously monitor Redis. If Redis becomes unavailable, automatically switch the rate limiter to PostgreSQL using the latest backed-up bucket state. When Redis is healthy again, switch back.

---

### Health Check Configuration

- Check Interval: **Every 3–5 seconds**
- Health Check: **Redis PING**
- Primary Storage: **Redis**
- Fallback Storage: **PostgreSQL (`bucket_backup`)**

---

### Flow

```text
Background Health Checker
          │
          ▼
Runs Every 3–5 Seconds
          │
          ▼
Ping Redis
          │
     ┌────┴────┐
     │         │
 Healthy    Unhealthy
     │         │
Continue   Switch to
 Redis      Database Mode
                │
                ▼
      Read/Write bucket_backup
                │
                ▼
       Retry Redis Health Check
                │
      Redis Healthy Again?
           │          │
          No         Yes
           │          │
      Stay in DB   Switch Back
         Mode       to Redis
```

---

### Responsibilities

1. Create a scheduled health checker that runs every **3–5 seconds**.
2. Send a **PING** command to Redis.
3. If Redis responds successfully:
   - Keep using Redis for rate limiting.
4. If Redis is unavailable:
   - Switch to **Database Mode**.
   - Read and update bucket state from the `bucket_backup` table.
5. Continue checking Redis while in Database Mode.
6. When Redis is healthy again:
   - Synchronize the latest bucket state back to Redis.
   - Switch all new requests back to Redis.

---

### Implementation Tasks

1. Create a scheduled Redis health checker.
2. Implement a global `StorageMode` (e.g., `REDIS` or `DATABASE`).
3. Switch storage mode automatically based on Redis health.
4. Use PostgreSQL as the fallback storage.
5. Restore Redis state when it becomes available again.
6. Log all failover and recovery events.

---

### Test Cases

**Test 1: Redis Healthy**
- Redis responds to `PING`.
- Requests should use Redis normally.

**Test 2: Redis Failure**
- Stop the Redis server.
- Health check detects failure.
- Application switches to Database Mode.

**Test 3: Database Fallback**
- While Redis is down, requests continue using `bucket_backup`.
- Rate limiting should still work.

**Test 4: Redis Recovery**
- Restart Redis.
- Health check detects recovery.
- Bucket state is synchronized back to Redis.
- New requests use Redis again.

**Test 5: Multiple Failovers**
- Redis goes down and recovers multiple times.
- Application should switch modes without losing bucket state or crashing.



---
Powered by [ChatGPT Exporter](https://www.chatgptexporter.com)