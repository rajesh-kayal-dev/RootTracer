# RootTracer — API Specification

**Version:** 1.0 draft · **Architecture:** microservices v2 · **Status:** Engineering contract proposal (implementation pending)

**Sources:** Approved [mvp-requirements.md](../product/mvp-requirements.md), [technical-requirements.md](../architecture/technical-requirements.md), [user-flows.md](../product/user-flows.md), and [data-model.md](data-model.md).

## 1. Scope and API boundaries

**MVP (deploy):** authentication, project management, ingest-only API keys, SDK ingestion, dashboard and incident APIs, on-demand Gemini investigation, and alert configuration. **Smart Recovery is out of scope for MVP.** Recovery approval endpoints are documented at the bottom as **future-phase design contracts only**, not active or promised APIs. GitHub analysis, AI-created PRs, business-impact tracking, payment/subscription, team membership and exports are also excluded.

| API boundary | Public URL prefix | Owning service | Authentication |
|---|---|---|---|
| Dashboard/control-plane BFF | `/api/v1` | Gateway routes to Identity, Incident, AI, Notification concerns | Redis session cookie, CSRF protection for state changes |
| Telemetry ingestion | `/ingest/v1` | Independent Ingestion Service | Project-scoped ingest-only API key |
| Internal service APIs | Private network, independently versioned routes | Owning service | Mutually authenticated service identity and least privilege |
| Recovery (future only) | `/api/v1/.../recovery-actions` | Future Recovery Service | Owner authorization + explicit approval, **not deployed in MVP** |

Only the Gateway/BFF and Ingestion Edge should be exposed publicly. Next.js calls BFF; it never connects directly to RabbitMQ, PostgreSQL, Redis, Gemini, or Resend.

### 1.1 Transport and contract conventions

- **HTTPS required** in staging/production; JSON UTF-8 requests and responses; ISO 8601 UTC times; UUID IDs as lowercase strings. `Content-Type: application/json` for request bodies.
- **Dashboard auth:** `Cookie: rt_sid=<opaque>` (session stored in Redis). Session cookies are `HttpOnly`, `Secure` in production and appropriately `SameSite`-restricted. All browser state-changing routes require `X-CSRF-Token`. Login/register/verification/reset are exempt from session auth but still rate-limited and origin-protected as appropriate.
- **SDK auth:** `Authorization: Bearer <project-ingest-api-key>` on ingest only. It cannot access dashboard, AI or recovery APIs. Never put SDK secrets in browser JavaScript.
- **Response correlation:** responses include `X-Request-ID`; API logs propagate IDs over internal REST/events without logging secrets.
- **Errors:** use one consistent envelope. Validation failures must identify safe field names, but not reveal passwords, session identifiers or raw ingest keys.
- **GET/DELETE bodies:** `None` unless explicitly shown as `{}`; DELETE ignores no-op `{}` and should not require a body. Query params are in URL. All POST/PATCH bodies must be schema-validated with Zod.
- **Pagination:** cursor-based, server-bound per project/query, deterministic ordering. `next_cursor: null` means no more data. `limit` defaults to 20, maximum 100.
- **Idempotency:** SDK assigns globally random `event_id` per captured event; ingest batches are atomically enqueued; incident worker deduplicates `(project_id,event_id)`. High-risk or job-creation actions accept an `Idempotency-Key` where specified.
- **Latency / availability:** `202 Accepted` confirms *durable queue acceptance*, not incident processing, email delivery, or AI completion. After `202`, poll read endpoints for states.
- **Rate limits:** `429` responds with optional `Retry-After`; `503` may do likewise. SDK retries with bounded exponential backoff and jitter. 4xx validation errors other than retryable `429` are not retried.
- **Project isolation:** every project-scoped route verifies owner access. Unknown and unauthorized project resources may return `404` to avoid existence disclosure; service-to-service calls must also carry validated authorization context.

**Canonical success envelope:** endpoint-specific JSON as defined below (no extra wrapper). **Canonical error envelope:**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "A safe, human-readable error message",
    "details": [{"field": "name", "reason": "Required"}],
    "request_id": "77777777-7777-4777-8777-777777777777"
  }
}
```

`details` is optional and should be omitted for non-validation errors. Never include stack traces, raw provider errors, API credentials, internal SQL or information about another tenant.

### 1.2 Generic HTTP status policy

| Status | Meaning |
|---|---|
| `200 OK` | Read/update complete; cached AI result may also return 200 |
| `201 Created` | New user, project or key created |
| `202 Accepted` | Batch/job queued; outcome is asynchronous |
| `400 Bad Request` | Validation / malformed JSON / unsupported filter |
| `401 Unauthorized` | Missing/expired session or invalid ingest key |
| `403 Forbidden` | CSRF failure, disabled project, forbidden action |
| `404 Not Found` | Resource absent or not owned |
| `409 Conflict` | Duplicate slug, stale status transition or active investigation |
| `413 Payload Too Large` | Ingest body/batch exceeds bounded size |
| `422 Unprocessable Content` | Valid structure, but future recovery action ineligible |
| `429 Too Many Requests` | Project/account quotas or AI rate limits exceeded |
| `503 Service Unavailable` | Broker/provider/service temporarily unavailable |

**Code stability:** error `code` strings are stable API identifiers; displayed messages may change. All examples contain fictional IDs, timestamps and payloads. Examples are normative in shape, not a claim of deployed endpoints.

## 2. Authentication endpoints

### POST `/api/v1/auth/register`

**Purpose:** Create an unverified developer account.  
**Headers:** `Content-Type: application/json`  
**Request JSON:**

```json
{
  "email": "dev@example.com",
  "password": "long-unique-password"
}
```

**Success — `201`:**

```json
{
  "user_id": "11111111-1111-4111-8111-111111111111",
  "email": "dev@example.com",
  "verification_required": true
}
```

**Error responses:** `400 VALIDATION_ERROR`, `409 EMAIL_ALREADY_REGISTERED`, `429 RATE_LIMITED`.

**Rules / failure handling:** Use generic public-facing responses where needed to prevent account enumeration; password never returned. Verification email dispatched asynchronously through Notification service.

### POST `/api/v1/auth/verify-email`

**Purpose:** Consume one-use email verification token.  
**Headers:** `Content-Type: application/json`  
**Request JSON:**

```json
{
  "token": "opaque-email-verification-token"
}
```

**Success — `200`:**

```json
{
  "email_verified": true
}
```

**Error responses:** `400 INVALID_OR_EXPIRED_TOKEN`, `409 TOKEN_ALREADY_USED`, `429 RATE_LIMITED`.

### POST `/api/v1/auth/login`

**Purpose:** Create Redis-backed server-side session.  
**Headers:** `Content-Type: application/json`  
**Request JSON:**

```json
{
  "email": "dev@example.com",
  "password": "long-unique-password"
}
```

**Success — `200`:**

```json
{
  "user": {
    "id": "11111111-1111-4111-8111-111111111111",
    "email": "dev@example.com"
  },
  "csrf_token": "opaque-csrf-value",
  "session_expires_at": "2026-11-23T12:00:00Z"
}
```

**Error responses:** `401 INVALID_CREDENTIALS`, `403 EMAIL_NOT_VERIFIED`, `429 RATE_LIMITED`.

**Rules / failure handling:** Response also sets `Set-Cookie: rt_sid=<opaque>; HttpOnly; Secure; SameSite=Lax; Path=/`. Example expiry is illustrative.

### POST `/api/v1/auth/logout`

**Purpose:** Invalidate Redis session.  
**Headers:** `Cookie: rt_sid=<opaque>; X-CSRF-Token: <token>; Content-Type: application/json`  
**Request JSON:**

```json
{}
```

**Success — `200`:**

```json
{
  "logged_out": true
}
```

**Error responses:** `401 UNAUTHENTICATED`, `403 CSRF_INVALID`.

### POST `/api/v1/auth/password/forgot`

**Purpose:** Request password reset email.  
**Headers:** `Content-Type: application/json`  
**Request JSON:**

```json
{
  "email": "dev@example.com"
}
```

**Success — `202`:**

```json
{
  "message": "If an account exists, reset instructions will be sent."
}
```

**Error responses:** `400 VALIDATION_ERROR`, `429 RATE_LIMITED`.

**Rules / failure handling:** Never disclose account existence.

### POST `/api/v1/auth/password/reset`

**Purpose:** Consume reset token and replace Argon2id hash.  
**Headers:** `Content-Type: application/json`  
**Request JSON:**

```json
{
  "token": "opaque-reset-token",
  "new_password": "another-long-unique-password"
}
```

**Success — `200`:**

```json
{
  "password_reset": true,
  "sessions_revoked": true
}
```

**Error responses:** `400 INVALID_OR_EXPIRED_TOKEN`, `409 TOKEN_ALREADY_USED`, `429 RATE_LIMITED`.

**Rules / failure handling:** Revoke existing sessions as specified in TRD policy.

### GET `/api/v1/me`

**Purpose:** Return authenticated developer profile.  
**Headers:** `Cookie: rt_sid=<opaque>`  
**Request body:** None.

**Success — `200`:**

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "email": "dev@example.com",
  "email_verified": true
}
```

**Error responses:** `401 UNAUTHENTICATED`.

## 3. Project endpoints

### GET `/api/v1/projects`

**Purpose:** List owned, non-deleted projects.  
**Headers:** `Cookie: rt_sid=<opaque>`  
**Request body:** None.

**Success — `200`:**

```json
{
  "items": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "name": "Checkout API",
      "slug": "checkout-api",
      "created_at": "2026-11-22T08:00:00Z"
    }
  ],
  "next_cursor": null
}
```

**Error responses:** `401 UNAUTHENTICATED`.

### POST `/api/v1/projects`

**Purpose:** Create developer-owned project.  
**Headers:** `Cookie: rt_sid=<opaque>; X-CSRF-Token: <token>; Content-Type: application/json`  
**Request JSON:**

```json
{
  "name": "Checkout API",
  "slug": "checkout-api"
}
```

**Success — `201`:**

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "name": "Checkout API",
  "slug": "checkout-api",
  "created_at": "2026-11-22T08:00:00Z"
}
```

**Error responses:** `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 CSRF_INVALID`, `409 PROJECT_SLUG_EXISTS`.

### GET `/api/v1/projects/{projectId}`

**Purpose:** View a project owned by the session user.  
**Headers:** `Cookie: rt_sid=<opaque>`  
**Request body:** None.

**Success — `200`:**

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "name": "Checkout API",
  "slug": "checkout-api",
  "created_at": "2026-11-22T08:00:00Z"
}
```

**Error responses:** `401 UNAUTHENTICATED`, `404 PROJECT_NOT_FOUND`.

**Rules / failure handling:** Return 404 for missing or unowned projects to avoid existence leaks.

### PATCH `/api/v1/projects/{projectId}`

**Purpose:** Rename project without changing ownership.  
**Headers:** `Cookie: rt_sid=<opaque>; X-CSRF-Token: <token>; Content-Type: application/json`  
**Request JSON:**

```json
{
  "name": "Payments API"
}
```

**Success — `200`:**

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "name": "Payments API",
  "slug": "checkout-api",
  "updated_at": "2026-11-22T12:00:00Z"
}
```

**Error responses:** `400 VALIDATION_ERROR`, `403 CSRF_INVALID`, `404 PROJECT_NOT_FOUND`, `409 PROJECT_SLUG_EXISTS`.

**Rules / failure handling:** The MVP allows name/slug changes; owner cannot be transferred.

### DELETE `/api/v1/projects/{projectId}`

**Purpose:** Soft-delete; instantly disable data access and ingest keys.  
**Headers:** `Cookie: rt_sid=<opaque>; X-CSRF-Token: <token>; Content-Type: application/json`  
**Request JSON:**

```json
{}
```

**Success — `202`:**

```json
{
  "project_id": "22222222-2222-4222-8222-222222222222",
  "status": "DELETION_SCHEDULED",
  "purge_after": "2026-11-29T12:00:00Z"
}
```

**Error responses:** `403 CSRF_INVALID`, `404 PROJECT_NOT_FOUND`, `409 PROJECT_ALREADY_DELETED`.

**Rules / failure handling:** Seven-day grace period. Independent services purge their own data via versioned lifecycle events. Project restoration is not promised in MVP.

## 4. API key endpoints

### GET `/api/v1/projects/{projectId}/keys`

**Purpose:** List metadata for project ingestion keys.  
**Headers:** `Cookie: rt_sid=<opaque>`  
**Request body:** None.

**Success — `200`:**

```json
{
  "items": [
    {
      "id": "33333333-3333-4333-8333-333333333333",
      "label": "production-sdk",
      "prefix": "rt_live_ab12",
      "created_at": "2026-11-22T12:00:00Z",
      "last_used_at": null,
      "revoked_at": null
    }
  ]
}
```

**Error responses:** `404 PROJECT_NOT_FOUND`.

**Rules / failure handling:** Never return full key or recover key secret.

### POST `/api/v1/projects/{projectId}/keys`

**Purpose:** Create an ingest-only key.  
**Headers:** `Cookie: rt_sid=<opaque>; X-CSRF-Token: <token>; Content-Type: application/json`  
**Request JSON:**

```json
{
  "label": "production-sdk",
  "expires_at": null
}
```

**Success — `201`:**

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "label": "production-sdk",
  "prefix": "rt_live_ab12",
  "api_key": "rt_live_ab12.<show-only-once-secret>",
  "created_at": "2026-11-22T12:00:00Z"
}
```

**Error responses:** `400 VALIDATION_ERROR`, `403 CSRF_INVALID`, `404 PROJECT_NOT_FOUND`, `429 KEY_LIMIT_REACHED`.

**Rules / failure handling:** Secret appears only on initial creation; database stores a secure hash and prefix. This endpoint also supports overlapping rotation by creating another key.

### DELETE `/api/v1/projects/{projectId}/keys/{keyId}`

**Purpose:** Revoke an ingest key immediately.  
**Headers:** `Cookie: rt_sid=<opaque>; X-CSRF-Token: <token>; Content-Type: application/json`  
**Request JSON:**

```json
{}
```

**Success — `200`:**

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "revoked": true,
  "revoked_at": "2026-11-22T12:10:00Z"
}
```

**Error responses:** `403 CSRF_INVALID`, `404 KEY_NOT_FOUND`.

**Rules / failure handling:** Key revocation must invalidate cached ingest credentials promptly; emergency revoke should not wait for cache TTL.

## 5. Ingestion endpoints

### POST `/ingest/v1/events/batch`

**Purpose:** Atomically accept one sanitized telemetry batch for async processing.  
**Headers:** `Authorization: Bearer <project-ingest-api-key>; Content-Type: application/json; X-Request-ID: <optional-uuid>`  
**Request JSON:**

```json
{
  "schema_version": 1,
  "events": [
    {
      "event_id": "66666666-6666-4666-8666-666666666666",
      "occurred_at": "2026-11-22T12:00:00Z",
      "type": "TypeError",
      "message": "Cannot read properties of undefined",
      "stack_trace": "TypeError: ...\\n at createOrder (src/orders.ts:42:10)",
      "severity": "ERROR",
      "environment": "production",
      "release": "1.2.0",
      "context": {
        "http_method": "POST",
        "route": "/orders/:id"
      },
      "sdk_version": "0.1.0",
      "schema_version": 1
    }
  ]
}
```

**Success — `202`:**

```json
{
  "request_id": "77777777-7777-4777-8777-777777777777",
  "accepted_count": 1,
  "server_timestamp": "2026-11-22T12:00:01Z"
}
```

**Error responses:** `400 INVALID_BATCH`, `401 INVALID_API_KEY`, `403 PROJECT_DISABLED`, `413 PAYLOAD_TOO_LARGE`, `429 INGEST_RATE_LIMITED`, `503 INGEST_UNAVAILABLE`.

**Rules / failure handling:** All-or-nothing batch validation. `202` only after publisher-confirmed durable RabbitMQ acceptance; it does NOT mean DB processing succeeded. For `429/503`, include `Retry-After` when appropriate. SDK must respect bounded retries. Ingest key is not a browser/dashboard credential.

## 6. Dashboard endpoint

### GET `/api/v1/projects/{projectId}/dashboard?range=24h&environment=production`

**Purpose:** Get summary metrics and trend data for selected period.  
**Headers:** `Cookie: rt_sid=<opaque>`  
**Request body:** None.

**Success — `200`:**

```json
{
  "range": "24h",
  "environment": "production",
  "error_event_count": 120,
  "open_incidents": 5,
  "resolved_incidents": 12,
  "severity_counts": {
    "INFO": 1,
    "WARNING": 2,
    "ERROR": 2,
    "CRITICAL": 0
  },
  "trend": [
    {
      "bucket": "2026-11-22T11:00:00Z",
      "count": 8
    }
  ],
  "top_incidents": [
    {
      "id": "44444444-4444-4444-8444-444444444444",
      "title": "TypeError in createOrder",
      "occurrence_count": 83
    }
  ]
}
```

**Error responses:** `400 INVALID_FILTER`, `404 PROJECT_NOT_FOUND`.

**Rules / failure handling:** `range` supports `24h` or `7d`; data represents ingested events, not all customer failures when sampling is active. Normalized response to match Concept A dashboard.

## 7. Incident endpoints

### GET `/api/v1/projects/{projectId}/incidents?environment=production&status=OPEN&severity=ERROR&q=TypeError&range=7d&limit=20&cursor=<opaque>`

**Purpose:** Project-scoped search, filtering and cursor pagination.  
**Headers:** `Cookie: rt_sid=<opaque>`  
**Request body:** None.

**Success — `200`:**

```json
{
  "items": [
    {
      "id": "44444444-4444-4444-8444-444444444444",
      "title": "TypeError in createOrder",
      "status": "OPEN",
      "severity": "ERROR",
      "environment": "production",
      "occurrence_count": 83,
      "first_seen": "2026-11-20T10:00:00Z",
      "last_seen": "2026-11-22T11:59:00Z"
    }
  ],
  "next_cursor": "opaque-signed-cursor"
}
```

**Error responses:** `400 INVALID_FILTER_OR_CURSOR`, `404 PROJECT_NOT_FOUND`.

**Rules / failure handling:** Supported filters: environment, status, severity, release, q, range or from/to, limit (1–100), cursor. All queries enforce project ownership; cursor must be scoped to the query.

### GET `/api/v1/projects/{projectId}/incidents/{incidentId}`

**Purpose:** Get incident summary and recent sanitized events/activity.  
**Headers:** `Cookie: rt_sid=<opaque>`  
**Request body:** None.

**Success — `200`:**

```json
{
  "id": "44444444-4444-4444-8444-444444444444",
  "project_id": "22222222-2222-4222-8222-222222222222",
  "title": "TypeError in createOrder",
  "exception_type": "TypeError",
  "status": "OPEN",
  "severity": "ERROR",
  "environment": "production",
  "fingerprint": "sha256:example",
  "occurrence_count": 83,
  "first_seen": "2026-11-20T10:00:00Z",
  "last_seen": "2026-11-22T11:59:00Z",
  "first_release": "1.2.0",
  "latest_event": {
    "event_id": "66666666-6666-4666-8666-666666666666",
    "message": "Cannot read properties of undefined",
    "stack_trace": "TypeError: ...\\n at createOrder (src/orders.ts:42:10)"
  },
  "activity": [
    {
      "action": "CREATED",
      "created_at": "2026-11-20T10:00:00Z"
    }
  ]
}
```

**Error responses:** `404 INCIDENT_NOT_FOUND`.

**Rules / failure handling:** Recent events and activity may be limited; use dedicated paginated endpoints for full retained history.

### GET `/api/v1/projects/{projectId}/incidents/{incidentId}/events?limit=20&cursor=<opaque>`

**Purpose:** List sanitized raw-event occurrences for an incident.  
**Headers:** `Cookie: rt_sid=<opaque>`  
**Request body:** None.

**Success — `200`:**

```json
{
  "items": [
    {
      "event_id": "66666666-6666-4666-8666-666666666666",
      "occurred_at": "2026-11-22T12:00:00Z",
      "message": "Cannot read properties of undefined",
      "release": "1.2.0"
    }
  ],
  "next_cursor": null
}
```

**Error responses:** `400 INVALID_CURSOR`, `404 INCIDENT_NOT_FOUND`.

**Rules / failure handling:** Raw events retained for 30 days. Keep partitions bounded and order by timestamp plus event ID.

### GET `/api/v1/projects/{projectId}/incidents/{incidentId}/activity?limit=20&cursor=<opaque>`

**Purpose:** List incident lifecycle and AI-request activity.  
**Headers:** `Cookie: rt_sid=<opaque>`  
**Request body:** None.

**Success — `200`:**

```json
{
  "items": [
    {
      "id": "88888888-8888-4888-8888-888888888888",
      "action": "STATUS_CHANGED",
      "actor_id": "11111111-1111-4111-8111-111111111111",
      "before": {
        "status": "OPEN"
      },
      "after": {
        "status": "INVESTIGATING"
      },
      "created_at": "2026-11-22T12:05:00Z"
    }
  ],
  "next_cursor": null
}
```

**Error responses:** `400 INVALID_CURSOR`, `404 INCIDENT_NOT_FOUND`.

### PATCH `/api/v1/projects/{projectId}/incidents/{incidentId}`

**Purpose:** Update status and/or severity with an audit entry.  
**Headers:** `Cookie: rt_sid=<opaque>; X-CSRF-Token: <token>; Content-Type: application/json`  
**Request JSON:**

```json
{
  "status": "INVESTIGATING",
  "severity": "CRITICAL"
}
```

**Success — `200`:**

```json
{
  "id": "44444444-4444-4444-8444-444444444444",
  "status": "INVESTIGATING",
  "severity": "CRITICAL",
  "updated_at": "2026-11-22T12:05:00Z"
}
```

**Error responses:** `400 INVALID_STATUS_OR_SEVERITY`, `403 CSRF_INVALID`, `404 INCIDENT_NOT_FOUND`, `409 INVALID_STATUS_TRANSITION`.

**Rules / failure handling:** Allowed status names: OPEN, INVESTIGATING, RESOLVED, REGRESSED. REGRESSED is set automatically by reoccurrence; client cannot set it directly. Do not allow arbitrary lifecycle jumps.

## 8. AI investigation endpoints

### POST `/api/v1/projects/{projectId}/incidents/{incidentId}/investigations`

**Purpose:** Explicitly request Gemini RCA of current sanitized evidence.  
**Headers:** `Cookie: rt_sid=<opaque>; X-CSRF-Token: <token>; Content-Type: application/json; Idempotency-Key: <uuid>`  
**Request JSON:**

```json
{
  "reuse_if_unchanged": true
}
```

**Success — `202`:**

```json
{
  "id": "55555555-5555-4555-8555-555555555555",
  "incident_id": "44444444-4444-4444-8444-444444444444",
  "status": "PENDING",
  "reused": false,
  "created_at": "2026-11-22T12:06:00Z"
}
```

**Error responses:** `400 VALIDATION_ERROR`, `403 CSRF_INVALID`, `404 INCIDENT_NOT_FOUND`, `409 INVESTIGATION_ALREADY_ACTIVE`, `429 AI_QUOTA_EXCEEDED`, `503 AI_QUEUE_UNAVAILABLE`.

**Rules / failure handling:** For same active/cached evidence, return existing investigation with 200 and `reused:true` instead of enqueuing again. AI worker obtains sanitized context via authenticated Incident API, never cross-schema SQL.

### GET `/api/v1/projects/{projectId}/incidents/{incidentId}/investigations?limit=20&cursor=<opaque>`

**Purpose:** List versioned RCA history.  
**Headers:** `Cookie: rt_sid=<opaque>`  
**Request body:** None.

**Success — `200`:**

```json
{
  "items": [
    {
      "id": "55555555-5555-4555-8555-555555555555",
      "status": "COMPLETED",
      "model_provider": "gemini",
      "prompt_version": "v1",
      "created_at": "2026-11-22T12:06:00Z"
    }
  ],
  "next_cursor": null
}
```

**Error responses:** `400 INVALID_CURSOR`, `404 INCIDENT_NOT_FOUND`.

### GET `/api/v1/projects/{projectId}/investigations/{investigationId}`

**Purpose:** Poll job status and retrieve structured Gemini report.  
**Headers:** `Cookie: rt_sid=<opaque>`  
**Request body:** None.

**Success — `200`:**

```json
{
  "id": "55555555-5555-4555-8555-555555555555",
  "incident_id": "44444444-4444-4444-8444-444444444444",
  "status": "COMPLETED",
  "model_provider": "gemini",
  "model_name": "configured-gemini-model",
  "prompt_version": "v1",
  "result": {
    "probable_causes": [
      {
        "description": "Missing order object guard",
        "evidence": [
          "Stack frame createOrder line 42"
        ],
        "confidence": "medium"
      }
    ],
    "suggested_fixes": [
      "Validate order before accessing its properties"
    ],
    "limitations": [
      "Source code was not available to this MVP investigation"
    ]
  },
  "failure": null,
  "finished_at": "2026-11-22T12:06:30Z"
}
```

**Error responses:** `404 INVESTIGATION_NOT_FOUND`.

**Rules / failure handling:** For PENDING/PROCESSING return `result:null`. For FAILED return `failure:{code,message,retryable}` and `result:null`. AI confidence is qualitative and uncalibrated; never imply proven root cause.

## 9. Alert setting endpoints

### GET `/api/v1/projects/{projectId}/alert-settings`

**Purpose:** Read project alert preferences.  
**Headers:** `Cookie: rt_sid=<opaque>`  
**Request body:** None.

**Success — `200`:**

```json
{
  "email_enabled": true,
  "notify_new_incident": true,
  "notify_critical": true,
  "notify_regression": true,
  "occurrence_threshold": 100,
  "cooldown_minutes": 60
}
```

**Error responses:** `404 PROJECT_NOT_FOUND`.

### PATCH `/api/v1/projects/{projectId}/alert-settings`

**Purpose:** Update supported email/in-dashboard alert rules.  
**Headers:** `Cookie: rt_sid=<opaque>; X-CSRF-Token: <token>; Content-Type: application/json`  
**Request JSON:**

```json
{
  "email_enabled": true,
  "notify_critical": true,
  "occurrence_threshold": 50,
  "cooldown_minutes": 60
}
```

**Success — `200`:**

```json
{
  "email_enabled": true,
  "notify_new_incident": true,
  "notify_critical": true,
  "notify_regression": true,
  "occurrence_threshold": 50,
  "cooldown_minutes": 60
}
```

**Error responses:** `400 VALIDATION_ERROR`, `403 CSRF_INVALID`, `404 PROJECT_NOT_FOUND`.

**Rules / failure handling:** Threshold and cooldown ranges must be bounded and validated; no Slack/webhook endpoints in MVP.

## 10. Future recovery APIs — outside MVP

### POST `/api/v1/projects/{projectId}/incidents/{incidentId}/recovery-actions`

**Purpose:** FUTURE: create a recovery proposal, never execute.  
**Headers:** `Cookie: rt_sid=<opaque>; X-CSRF-Token: <token>; Content-Type: application/json; Idempotency-Key: <uuid>`  
**Request JSON:**

```json
{
  "action_type": "RETRY_FAILED_JOB",
  "parameters": {
    "job_ref": "opaque-allowlisted-id"
  },
  "reason": "Operator-reviewed incident"
}
```

**Success — `202`:**

```json
{
  "id": "99999999-9999-4999-8999-999999999999",
  "status": "AWAITING_APPROVAL",
  "eligibility": "PENDING"
}
```

**Error responses:** `400 INVALID_ACTION`, `403 RECOVERY_NOT_PERMITTED`, `404 INCIDENT_NOT_FOUND`, `409 DUPLICATE_ACTION`, `422 ACTION_NOT_ELIGIBLE`.

**Rules / failure handling:** Future-only contract. This route MUST NOT be deployed as part of MVP. Restrict types; reject arbitrary shell commands, URLs and broad cloud credentials.

### POST `/api/v1/projects/{projectId}/recovery-actions/{actionId}/approve`

**Purpose:** FUTURE: explicit human authorization before queued execution.  
**Headers:** `Cookie: rt_sid=<opaque>; X-CSRF-Token: <token>; Content-Type: application/json; Idempotency-Key: <uuid>`  
**Request JSON:**

```json
{
  "confirmation": "APPROVE",
  "expected_status": "AWAITING_APPROVAL",
  "reason": "Approved after reviewing evidence"
}
```

**Success — `202`:**

```json
{
  "id": "99999999-9999-4999-8999-999999999999",
  "status": "APPROVED",
  "approved_at": "2026-11-22T12:15:00Z",
  "execution_queued": true
}
```

**Error responses:** `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 RECOVERY_NOT_PERMITTED`, `404 RECOVERY_ACTION_NOT_FOUND`, `409 STATE_CONFLICT`, `422 ELIGIBILITY_CHECK_FAILED`, `503 RECOVERY_QUEUE_UNAVAILABLE`.

**Rules / failure handling:** Future-only. Reauthorize project owner; verify action/target/expiry and request CSRF + explicit confirmation. Approval must be auditable and cannot bypass eligibility. Execute via separate least-privilege worker.

### POST `/api/v1/projects/{projectId}/recovery-actions/{actionId}/reject`

**Purpose:** FUTURE: reject proposed recovery.  
**Headers:** `Cookie: rt_sid=<opaque>; X-CSRF-Token: <token>; Content-Type: application/json`  
**Request JSON:**

```json
{
  "reason": "Not safe for this environment"
}
```

**Success — `200`:**

```json
{
  "id": "99999999-9999-4999-8999-999999999999",
  "status": "REJECTED"
}
```

**Error responses:** `403 RECOVERY_NOT_PERMITTED`, `404 RECOVERY_ACTION_NOT_FOUND`, `409 STATE_CONFLICT`.

**Rules / failure handling:** Future-only; terminal rejected action cannot execute.

### GET `/api/v1/projects/{projectId}/recovery-actions/{actionId}`

**Purpose:** FUTURE: read approval, execution, verification and audit states.  
**Headers:** `Cookie: rt_sid=<opaque>`  
**Request body:** None.

**Success — `200`:**

```json
{
  "id": "99999999-9999-4999-8999-999999999999",
  "status": "SUCCEEDED",
  "approved_at": "2026-11-22T12:15:00Z",
  "executed_at": "2026-11-22T12:16:00Z",
  "verification": {
    "status": "PASSED",
    "checked_at": "2026-11-22T12:17:00Z"
  }
}
```

**Error responses:** `403 RECOVERY_NOT_PERMITTED`, `404 RECOVERY_ACTION_NOT_FOUND`.

**Rules / failure handling:** Future-only. External API success does not equal verified recovery; require explicit post-recovery verification.

## 11. Internal REST and async event contracts (architecture support)

The public endpoints above are served by the gateway/ingestion edge. Internal endpoints are **not public APIs**. Their exact paths are private contract proposals and may be changed during LLD without changing the public API.

| Producer → Consumer | Transport | Contract | Failure handling |
|---|---|---|---|
| Gateway → Identity | private REST | Session validation, project ownership assertion, key lifecycle | Fail closed on unavailable/invalid authorization |
| Ingestion → Identity | private REST + short-lived cache | Verify project/key active; accept only `ingest:write` scope | Revoke cache immediately on key revocation; fail closed on uncertain authorization |
| Ingestion → Incident Worker | RabbitMQ `telemetry.events` | Versioned batch containing project UUID, `event_id`, sanitized events and request ID | Durable publishing confirm; bounded retry; DLQ; idempotent worker |
| Gateway → Incident | private REST | Project-scoped dashboard, list, detail, patch, event and activity reads | Auth context, timeouts, bounded retries for safe idempotent reads |
| Gateway → AI | private REST | Start job; fetch investigation history/result | Quota check, idempotency and async status |
| AI Worker → Incident | private REST | Read **sanitized, bounded evidence** for authorized project/incident | No cross-service SQL; failure state and retry |
| AI Worker → Gemini | HTTPS | Strict structured JSON with evidence, limitations | Timeout, bounded retry, Zod validation; no auto-recovery |
| Incident Outbox → Notifications | RabbitMQ `notifications.email` | Rule ID, project/incident IDs, recipient reference and dedupe key | Publisher confirms, consumer idempotency and DLQ |
| Notification → Resend | HTTPS | Transactional email | Cooldown/dedupe, retries, delivery status |
| Identity → other services | versioned lifecycle event | Project deleted/purge requested with project ID and trace ID | Eventual, idempotent project-data deletion per owning service |

**Envelope example (`telemetry.events`):**

```json
{
  "message_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "schema_version": 1,
  "event_type": "telemetry.batch.accepted",
  "occurred_at": "2026-11-22T12:00:01Z",
  "request_id": "77777777-7777-4777-8777-777777777777",
  "project_id": "22222222-2222-4222-8222-222222222222",
  "payload": {"events": [{"event_id":"66666666-6666-4666-8666-666666666666","type":"TypeError","message":"Sanitized error","occurred_at":"2026-11-22T12:00:00Z","schema_version":1,"sdk_version":"0.1.0","environment":"production"}]}
}
```

**Worker invariant:** PostgreSQL transaction records `event_receipts`, new event, incident grouping/count and any outbox notification together; *only after commit* does the consumer acknowledge. Inter-service events use local outbox + publish confirmations; no distributed DB transaction is assumed. Raw event partitions are daily with 30-day retention.

## 12. State transition and security requirements

| Domain | Allowed states / behavior |
|---|---|
| Account | Unverified → verified; login requires verified email; password reset revokes sessions per policy |
| Project | Active → soft-deleted (immediate access/key revocation) → scheduled purge after seven days |
| API key | Active → revoked or expired; overlapping active keys for rotation |
| Incident | `OPEN → INVESTIGATING → RESOLVED`; reoccurrence after resolution → `REGRESSED`; valid user transitions require explicit server policy |
| AI job | `PENDING → PROCESSING → COMPLETED / FAILED`; controlled retry creates tracked attempt/history, cached same-evidence results reused |
| Recovery (future only) | `PROPOSED → AWAITING_APPROVAL → APPROVED / REJECTED → EXECUTING → VERIFYING → SUCCEEDED / FAILED` with audited guards |

Browser mutations always require valid session + CSRF; ingestion mutations require project ingestion key, project active, rate limit and payload validation. Auth reset/verification endpoints require high-entropy single-use tokens and throttling. Service-to-service private endpoints must authenticate caller identity. Restrict payload sizes and stored context; **never collect cookies, passwords, authorization headers or request bodies by default**.

## 13. Negative tests and contract acceptance

- Invalid/revoked SDK key → `401`; deleted project → `403`; neither may enqueue events.
- RabbitMQ unavailable/no publish confirmation → `503`, **not** `202`.
- Batch with one invalid event → reject entire batch (`400`) and enqueue **zero** events.
- Replayed `event_id` → no duplicate count; stable output after worker retry.
- Unauthorized project ID → `404` without leaking another developer's data.
- Missing CSRF on authenticated mutation → `403`.
- AI repeat with unchanged evidence → return active/cached result; no duplicate billable job.
- Gemini timeout/invalid schema → AI status `FAILED`; monitoring remains operational.
- Notification provider unavailable → delivery retry/DLQ; telemetry processing unaffected.
- Recovery routes absent/disabled in MVP → `404` or not routed; approvals cannot execute anything.
- Tests include OpenAPI schema checks, integration checks against real RabbitMQ/PostgreSQL/Redis and end-to-end browser paths.

## 14. Versioning, delivery and open implementation choices

**API version:** `/api/v1` and `/ingest/v1`, with backward-compatible additive changes within v1. SDK events include `sdk_version` and `schema_version`; supported schema versions should be documented alongside release notes.

**Implementation-ready follow-ups:** Export OpenAPI 3.1 schema as source of truth; exact max payload/event count, per-project quota defaults, cookie lifetime/CSRF transport, cursor signing, auth token TTL, alert setting bounds, internal auth mechanism, timeout budgets, and pagination query rules must be set and tested before public release. The examples here establish response **shapes**, not approved values for unfinalized numeric limits.

**Scope lock:** Do not deploy future recovery endpoints, GitHub connections or code execution as part of the five-feature MVP.
