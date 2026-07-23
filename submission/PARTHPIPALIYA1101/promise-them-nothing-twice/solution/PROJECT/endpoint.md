# API Endpoint & Request / Response Payload Specification

This document details all HTTP API endpoints, authentication headers, request bodies, query parameters, and JSON response payloads for the Enterprise Rate Limiter Infrastructure.

---

## Global Base URL & Headers

- **Base URL**: `http://localhost:3000`
- **Content-Type**: `application/json`

---

## 1. System Health Endpoint

### `GET /health`
Retrieves system operational status, PostgreSQL database connection, and Redis cache health.

- **Headers**: None
- **Request Body**: None

#### Success Response (200 OK)
```json
{
  "success": true,
  "message": "System health check retrieved",
  "data": {
    "status": "healthy",
    "timestamp": "2026-07-23T23:23:30.000Z",
    "uptime": 124.5,
    "checks": {
      "database": "up",
      "redis": "up"
    }
  }
}
```

---

## 2. Rate Limit Plan Endpoints

### `GET /api/v1/plans`
Retrieves a paginated list of rate limiting plans (`BASIC`, `PREMIUM`, `ENTERPRISE`).

- **Query Parameters**:
  - `page` *(optional)*: Page number (default: `1`)
  - `limit` *(optional)*: Results per page (default: `10`)

#### Success Response (200 OK)
```json
{
  "success": true,
  "message": "Plans retrieved successfully",
  "data": [
    {
      "id": "85e27689-04b4-4d8a-9181-6710340a2e71",
      "name": "BASIC",
      "rpmLimit": 100,
      "burstLimit": 50,
      "createdAt": "2026-07-23T16:04:08.000Z",
      "updatedAt": "2026-07-23T16:04:08.000Z"
    },
    {
      "id": "cf434538-f362-4268-bb74-028bca5f08fe",
      "name": "PREMIUM",
      "rpmLimit": 300,
      "burstLimit": 100,
      "createdAt": "2026-07-23T16:04:08.000Z",
      "updatedAt": "2026-07-23T16:04:08.000Z"
    },
    {
      "id": "61c7a445-78e2-4c16-b46e-040f40114688",
      "name": "ENTERPRISE",
      "rpmLimit": 500,
      "burstLimit": 250,
      "createdAt": "2026-07-23T16:04:08.000Z",
      "updatedAt": "2026-07-23T16:04:08.000Z"
    }
  ],
  "pagination": {
    "total": 3,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

---

### `GET /api/v1/plans/:id`
Retrieves details for a single plan by UUID.

- **Path Parameters**:
  - `id`: Plan UUID string

#### Success Response (200 OK)
```json
{
  "success": true,
  "message": "Plan details retrieved",
  "data": {
    "id": "85e27689-04b4-4d8a-9181-6710340a2e71",
    "name": "BASIC",
    "rpmLimit": 100,
    "burstLimit": 50,
    "createdAt": "2026-07-23T16:04:08.000Z",
    "updatedAt": "2026-07-23T16:04:08.000Z"
  }
}
```

---

### `POST /api/v1/plans`
Creates a new rate limit plan.

#### Request Body Payload
```json
{
  "name": "CUSTOM_PRO",
  "rpmLimit": 1500,
  "burstLimit": 750
}
```

#### Success Response (201 Created)
```json
{
  "success": true,
  "message": "Plan created successfully",
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "CUSTOM_PRO",
    "rpmLimit": 1500,
    "burstLimit": 750,
    "createdAt": "2026-07-23T23:23:30.000Z",
    "updatedAt": "2026-07-23T23:23:30.000Z"
  }
}
```

---

## 3. Customer Management Endpoints

### `GET /api/v1/customers`
Retrieves a paginated list of registered customer accounts.

- **Query Parameters**:
  - `page` *(optional)*: Page number (default: `1`)
  - `limit` *(optional)*: Results per page (default: `10`)

#### Success Response (200 OK)
```json
{
  "success": true,
  "message": "Customers retrieved successfully",
  "data": [
    {
      "id": "10000000-0000-4000-a000-000000000100",
      "name": "Alice Developer",
      "email": "alice.basic@example.com",
      "planId": "85e27689-04b4-4d8a-9181-6710340a2e71",
      "customRpmLimit": null,
      "customBurstLimit": null,
      "queueEnabled": true,
      "createdAt": "2026-07-23T16:04:08.000Z",
      "updatedAt": "2026-07-23T16:04:08.000Z",
      "plan": {
        "id": "85e27689-04b4-4d8a-9181-6710340a2e71",
        "name": "BASIC",
        "rpmLimit": 100,
        "burstLimit": 50
      }
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

---

### `GET /api/v1/customers/:id`
Retrieves details for a single customer by UUID.

- **Path Parameters**:
  - `id`: Customer UUID string

#### Success Response (200 OK)
```json
{
  "success": true,
  "message": "Customer details retrieved",
  "data": {
    "id": "10000000-0000-4000-a000-000000000100",
    "name": "Alice Developer",
    "email": "alice.basic@example.com",
    "planId": "85e27689-04b4-4d8a-9181-6710340a2e71",
    "customRpmLimit": null,
    "customBurstLimit": null,
    "queueEnabled": true,
    "plan": {
      "name": "BASIC",
      "rpmLimit": 100,
      "burstLimit": 50
    }
  }
}
```

---

### `POST /api/v1/customers`
Creates a new customer account with plan association and optional custom limit overrides.

#### Request Body Payload
```json
{
  "name": "David Startup",
  "email": "david.startup@example.com",
  "planId": "cf434538-f362-4268-bb74-028bca5f08fe",
  "customRpmLimit": 400,
  "customBurstLimit": 150,
  "queueEnabled": true
}
```

#### Success Response (201 Created)
```json
{
  "success": true,
  "message": "Customer created successfully",
  "data": {
    "id": "20000000-0000-4000-a000-000000000200",
    "name": "David Startup",
    "email": "david.startup@example.com",
    "planId": "cf434538-f362-4268-bb74-028bca5f08fe",
    "customRpmLimit": 400,
    "customBurstLimit": 150,
    "queueEnabled": true,
    "createdAt": "2026-07-23T23:23:30.000Z",
    "updatedAt": "2026-07-23T23:23:30.000Z"
  }
}
```

---

## 4. Rate-Limited Protected API Endpoint

### `GET /api/v1/protected/ping`
Protected demonstration endpoint evaluated by customer lookup middleware and token bucket rate limiter middleware.

- **Required Request Headers**:
  - `X-Customer-ID`: `<Valid Customer UUID>`

#### Success Response (200 OK)
```json
{
  "success": true,
  "message": "Protected endpoint test successful",
  "data": {
    "message": "Access granted. X-Customer-ID verified & rate limit evaluated.",
    "customerContext": {
      "id": "10000000-0000-4000-a000-000000000100",
      "name": "Alice Developer",
      "planName": "BASIC",
      "effectiveRpmLimit": 100,
      "effectiveBurstLimit": 50,
      "queueEnabled": true
    }
  }
}
```
**Injected Response Headers**:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Burst-Remaining: 50
```

---

### Rate Limiting & Authentication Error Payloads

#### 1. Rate Limit Exceeded (HTTP 429 Too Many Requests)
Returned when base tokens and burst capacity are exhausted:

```json
{
  "success": false,
  "message": "Rate limit exceeded. Maximum 100 RPM allowed for BASIC tier.",
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "details": {
      "effectiveRpmLimit": 100,
      "retryAfterSeconds": 3
    }
  }
}
```
**Injected Response Headers**:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Burst-Remaining: 0
Retry-After: 3
```

---

#### 2. Missing Header (HTTP 401 Unauthorized)
Returned when `X-Customer-ID` header is omitted:

```json
{
  "success": false,
  "message": "Missing required header: X-Customer-ID",
  "error": {
    "code": "UNAUTHORIZED"
  }
}
```

---

#### 3. Invalid UUID Format (HTTP 401 Unauthorized)
Returned when `X-Customer-ID` is not a valid UUID:

```json
{
  "success": false,
  "message": "Invalid X-Customer-ID format. Must be a valid UUID",
  "error": {
    "code": "UNAUTHORIZED"
  }
}
```

---

#### 4. Customer Account Not Found (HTTP 404 Not Found)
Returned when `X-Customer-ID` UUID does not match any registered customer account:

```json
{
  "success": false,
  "message": "Customer account not found for X-Customer-ID: 00000000-0000-0000-0000-000000000000",
  "error": {
    "code": "NOT_FOUND"
  }
}
```
