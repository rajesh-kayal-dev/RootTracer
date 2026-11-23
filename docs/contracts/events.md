# RootTracer — RabbitMQ Event Contracts

**Contract version:** `1` · **Status:** Engineering design, not deployed · **Backend:** Express/TypeScript microservices, RabbitMQ, PostgreSQL (`pg`) · **Last revised:** 2026-11-22

This document defines four internal domain messages and their exact **JSON Schema Draft 2020-12** contracts. The standalone machine-readable schemas are also in [event-schemas.v1.json](event-schemas.v1.json).

> **Scope lock:** `error.ingested` and `rca.requested` are **MVP**. `recovery.approved` and `recovery.completed` are **future-phase contracts only**; do **not** deploy recovery queues, consumers, APIs, or automated production actions in the MVP. Separately approved MVP email notifications use `notifications.email` with a future dedicated schema; that workload is described here but not one of the four JSON contracts.

## 1. Architecture and naming

| Event type | Phase | Publisher | Exchange (`topic`, durable) | Routing key | Primary durable queue | Consumer |
|---|---|---|---|---|---|---|
| `error.ingested` | MVP | Ingestion Service, after validation | `roottracer.telemetry.v1` | `error.ingested` | `telemetry.events` | Incident Service telemetry worker |
| `rca.requested` | MVP | AI Investigation Service, from an on-demand request | `roottracer.ai.v1` | `rca.requested` | `ai.investigations` | AI Service investigation worker |
| `recovery.approved` | **Future** | Recovery Service outbox after explicit owner approval | `roottracer.recovery.v1` | `recovery.approved` | `recovery.execute` | Recovery Worker |
| `recovery.completed` | **Future** | Recovery Service outbox after execution **and verification** | `roottracer.recovery.v1` | `recovery.completed` | `recovery.results` | Recovery audit/notification consumer |

**One connection per domain boundary is not required:** producers/consumers use distinct credentials and configured permissions. The dashboard/SDK cannot publish directly to RabbitMQ. `error.ingested` denotes a **broker-accepted batch awaiting processing**, **not** a persisted incident or a diagnosed error. The HTTP `202` means durable broker acceptance, not completed worker processing.

**Compatibility note:** earlier [http-api.md](http-api.md) has an illustrative `message_type`/`event_type` named `telemetry.batch.accepted`, and the earlier TRD uses routing keys `events.batch` and `investigation.requested`. This document proposes canonical names for the four messages. Before coding, update the corresponding HTTP API and technical requirements examples and declare aliases/deprecation only if pre-existing producers have already shipped. There is no assumed live dual-publish.

### Queue bindings, retry and dead-letter topology

| Workload | Main binding | Retry queue (durable) | DLQ (durable) | Maximum attempts |
|---|---|---|---|---|
| Telemetry | `roottracer.telemetry.v1` → `telemetry.events` | `telemetry.events.retry` | `telemetry.events.dlq` | **5 deliveries total** |
| AI | `roottracer.ai.v1` → `ai.investigations` | `ai.investigations.retry` | `ai.investigations.dlq` | **4 deliveries total** |
| Recovery command (**future**) | `roottracer.recovery.v1` → `recovery.execute` | `recovery.execute.retry` | `recovery.execute.dlq` | **3 deliveries total** |
| Recovery result (**future**) | `roottracer.recovery.v1` → `recovery.results` | `recovery.results.retry` | `recovery.results.dlq` | **5 deliveries total** |

All queues and exchanges are durable; published messages use `delivery_mode=2`; consumers use **manual acknowledgements** and finite `prefetch`. Use publisher confirms and **mandatory routing** (`mandatory=true` with unroutable-return handling) on all critical publish paths.

**Retry mechanics (portable RabbitMQ approach):**

- On transient failure, **publish a new message to the workload's retry exchange**, with original `message_id` and payload, incremented `attempt`, and publisher confirms. Only after confirm and required routing check succeeds ACK the original. If retry publish is uncertain, do **not** ACK the original; let the broker redeliver and rely on idempotency.
- Retry queues are durable TTL queues that dead-letter back to the **original main exchange and routing key** after delay. Configure **separate queues per delay tier** to avoid per-message-TTL head-of-line delay artifacts; bounded delays such as 5 s, 30 s, 2 min, 5 min are proposed defaults, not guaranteed timing. Use worker-driven republish with jitter to choose tier; do not `basic.nack(requeue=true)` repeatedly in a hot loop.
- If schema is unsupported/invalid, or the message is permanently ineligible, **dead-letter immediately**. If the retry budget is exhausted, publish/route to that workload's DLQ with failure reason metadata (as RabbitMQ headers, not extra unexpected JSON body fields); ACK original **only after DLQ routing is confirmed**.
- Retry and DLQ exchanges/queue arguments must be configured so no routing loop is possible. Consumer code should classify retryable failures (`DB_DOWN`, `HTTP_429`, `GEMINI_TIMEOUT`, temporary broker/network failures) versus terminal (`SCHEMA_INVALID`, `PROJECT_REVOKED`, `ACTION_NOT_APPROVED`, unauthorized action).
- For DLQ replay, an authorized operator reviews sanitized metadata, cause, project state, message age and schema version before republishing with a new `attempt=0` **but the same domain event IDs and idempotency keys**. Record replay operator, reason and time. Never replay expired/revoked project work.

**Retry counter semantics:** `attempt=0` is first delivery; telemetry maximum `attempt=4`, AI maximum `attempt=3`, recovery execution maximum `attempt=2`, recovery result maximum `attempt=4`. The schema accepts `0..5` to leave room for future consumer settings; enforce workload-specific budgets at the consumer. Broker redelivery after crash does not guarantee `attempt` increments, so consumers additionally use durable operation state/idempotency and monitor redelivery count/age. **At-least-once delivery, not exactly once.**

## 2. Common envelope

All four messages are UTF-8 JSON and have exactly these top-level fields (no extras):

| Field | Type | Semantics |
|---|---|---|
| `message_id` | UUID | Stable logical message ID across retries, used in consumer inbox/idempotency |
| `message_type` | fixed string | Must exactly equal the routed event type |
| `schema_version` | integer `1` | Contract version (not the SDK telemetry-event version) |
| `created_at` | RFC 3339 UTC timestamp | Original publication timestamp; do not reset on retry |
| `correlation_id` | UUID | Propagates HTTP request/trace correlation |
| `attempt` | integer `0..5` | Application-managed delivery attempt counter |
| `payload` | object | Per-message strictly validated structure |

The message **routing key must agree with `message_type`**, and queue consumers must reject unsupported `schema_version` to DLQ. Set RabbitMQ `content_type=application/json`, `content_encoding=utf-8`, `type=<message_type>`, `message_id=<message_id>`, `correlation_id=<correlation_id>`, `delivery_mode=2`, and optionally W3C trace context via vetted headers. Never put raw API keys or session cookies in headers.

**Logical references:** IDs crossing service boundaries are not cross-schema SQL foreign keys. Service-owned data stays in the owning database/schema.

## 3. Versioned schemas and message examples

Each referenced schema is **self-contained** and sets `additionalProperties: false` for envelope and payload. Telemetry context explicitly allowlists keys; app-specific context extensions require a versioned schema change. Timestamps use RFC 3339 `format: date-time` and UUIDs use `format: uuid` (enable format validation in your validator).

### 3.1 `error.ingested` — **MVP**

A single validated and accepted SDK batch is passed to Incident Service; `events` are scrubbed before enqueue. On transient storage failure, retry the entire batch; event receipts prevent double counting.

**JSON Schema:** [event-schemas.v1.json](event-schemas.v1.json), `$defs["error.ingested"]`.

**Valid example:**

```json
{
  "message_id": "00000000-0000-4000-8000-000000000001",
  "message_type": "error.ingested",
  "schema_version": 1,
  "created_at": "2026-11-22T12:00:01Z",
  "correlation_id": "77777777-7777-4777-8777-777777777777",
  "attempt": 0,
  "payload": {
    "project_id": "22222222-2222-4222-8222-222222222222",
    "request_id": "77777777-7777-4777-8777-777777777777",
    "batch_id": "88888888-8888-4888-8888-888888888888",
    "accepted_at": "2026-11-22T12:00:01Z",
    "events": [
      {
        "event_id": "66666666-6666-4666-8666-666666666666",
        "occurred_at": "2026-11-22T12:00:00Z",
        "type": "TypeError",
        "message": "Cannot read properties of undefined",
        "stack_trace": "TypeError at createOrder (src/orders.ts:42:10)",
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
}
```

### 3.2 `rca.requested` — **MVP**

Created only after authenticated developer starts an investigation and AI Service persists `PENDING`. Worker retrieves sanitized evidence using the private Incident API (no raw context in the message).

**JSON Schema:** [event-schemas.v1.json](event-schemas.v1.json), `$defs["rca.requested"]`.

**Valid example:**

```json
{
  "message_id": "00000000-0000-4000-8000-000000000002",
  "message_type": "rca.requested",
  "schema_version": 1,
  "created_at": "2026-11-22T12:00:01Z",
  "correlation_id": "77777777-7777-4777-8777-777777777777",
  "attempt": 0,
  "payload": {
    "project_id": "22222222-2222-4222-8222-222222222222",
    "incident_id": "33333333-3333-4333-8333-333333333333",
    "investigation_id": "44444444-4444-4444-8444-444444444444",
    "requested_by": "55555555-5555-4555-8555-555555555555",
    "evidence_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "prompt_version": "rca-v1"
  }
}
```

### 3.3 `recovery.approved` — **Future phase — NOT deployed in MVP**

Published only after a developer explicitly approves a currently eligible recovery action; proposal, approval, permissions and policy version are verified and stored before outbox dispatch. An approval event must not be treated as a generic 'execute arbitrary command' authorization.

**JSON Schema:** [event-schemas.v1.json](event-schemas.v1.json), `$defs["recovery.approved"]`.

**Valid example:**

```json
{
  "message_id": "00000000-0000-4000-8000-000000000003",
  "message_type": "recovery.approved",
  "schema_version": 1,
  "created_at": "2026-11-22T12:00:01Z",
  "correlation_id": "77777777-7777-4777-8777-777777777777",
  "attempt": 0,
  "payload": {
    "project_id": "22222222-2222-4222-8222-222222222222",
    "incident_id": "33333333-3333-4333-8333-333333333333",
    "recovery_action_id": "44444444-4444-4444-8444-444444444444",
    "approved_by": "55555555-5555-4555-8555-555555555555",
    "approved_at": "2026-11-22T12:00:01Z",
    "action_type": "RETRY_FAILED_JOB",
    "idempotency_key": "retry-failed-job-33333333",
    "approval_record_version": 1
  }
}
```

### 3.4 `recovery.completed` — **Future phase — NOT deployed in MVP**

Published after the authorized action has executed and post-execution health verification has finished. Consumers record a terminal result idempotently; `SUCCEEDED` must correspond to `verification.outcome=HEALTHY`, and `FAILED` corresponds to `UNHEALTHY` or `INCONCLUSIVE`.

**JSON Schema:** [event-schemas.v1.json](event-schemas.v1.json), `$defs["recovery.completed"]`.

**Valid example:**

```json
{
  "message_id": "00000000-0000-4000-8000-000000000004",
  "message_type": "recovery.completed",
  "schema_version": 1,
  "created_at": "2026-11-22T12:00:01Z",
  "correlation_id": "77777777-7777-4777-8777-777777777777",
  "attempt": 0,
  "payload": {
    "project_id": "22222222-2222-4222-8222-222222222222",
    "incident_id": "33333333-3333-4333-8333-333333333333",
    "recovery_action_id": "44444444-4444-4444-8444-444444444444",
    "execution_id": "55555555-5555-4555-8555-555555555555",
    "status": "SUCCEEDED",
    "executed_at": "2026-11-22T12:00:05Z",
    "verified_at": "2026-11-22T12:00:10Z",
    "verification": {
      "outcome": "HEALTHY",
      "check_id": "job-status-check-v1",
      "summary": "Target job completed; configured verification checks passed."
    },
    "failure_code": null
  }
}
```

## 4. Business invariants by consumer

### 4.1 Telemetry worker (`error.ingested`)

1. Verify supported schema, allowed age, sanitized fields and active project status. A revoked/deleted project must be quarantined/terminally rejected, not processed.
2. Within a **local Incident PostgreSQL transaction**, claim each `(project_id,event_id)` in `incident.event_receipts`. Insert accepted raw events into a valid daily partition, upsert an incident by `(project_id,environment,fingerprint)`, increment count **once per newly claimed ID**, write activity/outbox records as necessary, and commit.
3. ACK **only after the entire batch's processing is successfully committed**. To reduce partial-batch complexity, prefer one transaction per batch at MVP limits; if processing must be chunked later, keep receipts and outbox idempotent.
4. Publish alerts using `incident_outbox` and a separate dispatcher, not a non-atomic direct RabbitMQ call inside DB commit. A crashed dispatcher can safely republish; email consumer dedupes.
5. If a batch publish was confirmed but the HTTP response was lost, the SDK resends the same `event_id`s; repeat acceptance does not increment incident totals twice.
6. Partition timestamp is `occurred_at` in [data-model.md](data-model.md); reject or quarantine events older than configured supported horizon, and create future daily partitions before arrival. The partition key and late-event policy must be identical in SQL migrations.

### 4.2 AI worker (`rca.requested`)

1. Lookup `ai.ai_rca_reports(id=investigation_id)` in **AI-owned** schema, and atomically claim `PENDING → PROCESSING`; if already completed, ACK duplicate.
2. Authenticate to Incident Service and fetch only sanitized/bounded error evidence for `project_id`+`incident_id`; enforce both project ownership and service authorization, without cross-service SQL.
3. Respect per-project quotas, concurrency caps, cache/evidence hashes; request Gemini structured JSON; validate with Zod. AI findings are **hypotheses**, not verified facts.
4. Persist `COMPLETED` with result or `FAILED` with safe failure code; retry only transient errors. An AI failure cannot block ingestion or dashboard availability.

### 4.3 Future recovery worker (`recovery.approved`)

1. Re-read authoritative `recovery_actions` record. Confirm `APPROVED` state, immutable action allowlist, approver permission, target identity, eligibility and policy/version. The queue message **alone is not sufficient authority to execute**.
2. Atomically claim the action and enforce `idempotency_key`. Use credentials restricted to the specific pre-approved operation; never accept arbitrary script text or raw cloud credentials from the queue.
3. Execute once where enforceable; if the external operation has uncertain outcome, **verify before retry**. Retrying a non-idempotent action blindly could cause harm.
4. Record `EXECUTING → VERIFYING → SUCCEEDED / FAILED`; if result publication fails, outbox-based delivery resumes without repeating execution.

### 4.4 Future result consumer (`recovery.completed`)

1. Verify logical action/execution IDs and authenticated producer.
2. Use `message_id` or `(recovery_action_id, execution_id)` as durable deduplication key.
3. Produce an audit record and future UI/notification update; never infer success merely because command execution returned HTTP 2xx.
4. A `FAILED` event must preserve why verification was unhealthy/inconclusive without exposing secrets.

## 5. Failure state matrix

| Failure | Handling | ACK policy | Visibility |
|---|---|---|---|
| RabbitMQ publish uncertain before HTTP `202` | Ingestion replies retryable `503` rather than claiming acceptance; SDK preserves IDs | N/A (producer) | Correlation/request ID, publish timeout |
| Unsupported version / malformed JSON | Reject to DLQ; no unsafe deserialization or silent drop | ACK only after DLQ confirmation | DLQ reason and schema version |
| Temporary PostgreSQL error | Transaction rollback; retry via delayed queue | ACK after confirmed retry publish | Queue age, retry count, error code |
| Duplicate event ID | No duplicate `raw_events` or occurrence increment | ACK after successful no-op/commit | Dedup metric |
| Permanent project revocation/deletion | Quarantine or terminal dead-letter; never process | ACK after terminal routing | Project lifecycle event/audit |
| Gemini timeout / `429` | Bounded delayed retries and respect provider retry guidance | ACK after retry publish | Investigation `PROCESSING` / retry status |
| Gemini invalid structured result | One bounded corrective attempt only if configured; otherwise mark `FAILED` | ACK after persisted failure | Failure code, no fabricated RCA |
| Recovery denied / state conflict (**future**) | No `recovery.approved` publication | N/A | Owner sees rejected/failed approval |
| Recovery execution uncertain (**future**) | Inspect status and verify before any retry | Do not ACK until durable recovery state/outbox | Audit + manual intervention |
| Verification fails (**future**) | Emit `recovery.completed` with `FAILED`, `UNHEALTHY`/`INCONCLUSIVE` | ACK after persisted result | Developer sees failure |
| DLQ redrive of stale key/project | Reject replay | No live delivery | Operator runbook record |

## 6. Reliability and deployment controls

- **Transactional outbox:** Use for Incident → email and for future Recovery approval/completion events. For AI request enqueueing, create the investigation record + an **AI-owned outbox record** atomically (a required SQL addition to the current logical [data-model.md](data-model.md)), then publish with confirms. Otherwise, a crash between the AI database commit and queue publish leaves an orphaned `PENDING` record.
- **Idempotent consumers:** Persist dedupe/operation state in owning PostgreSQL schema; don't rely on ephemeral Redis counters or only RabbitMQ `redelivered` flag.
- **Topology drift prevention:** Declare exchanges/queues/bindings from version-controlled startup or infrastructure provisioning; assert names/arguments in integration tests. Avoid blanket runtime redefinition with conflicting queue arguments.
- **Environment boundaries:** Use separate RabbitMQ virtual hosts or clusters for local, staging and production; separate credentials per service, and least-privilege publish/consume permissions.
- **Security:** RabbitMQ TLS for network connections, sanitized payloads, size limits, schema validation at producer *and* consumer, no raw PII or code/stack secrets in AI/recovery events.
- **Monitoring:** Pino structured logs with `correlation_id`, queue depth, oldest message age, retry/dead-letter counts, consumer availability, publish confirm failures and processing latency. Health checks must not return healthy when critical broker dependencies are unavailable.
- **Load targets:** Design for 100 events/sec sustained and 500 events/sec bursts; these are unverified engineering targets. Tune prefetch, batch sizes, queue limits, worker/KEDA replicas and PostgreSQL pool budgets using load tests.
- **Safety under broker overload:** Ingestion uses per-project rate limits, bounded queue length, HTTP `429`/`503` plus `Retry-After`, and never responds `202` until broker confirms durable routing.
- **Schema evolution:** Treat `schema_version` as producer/consumer compatibility contract. Add optional fields compatibly within a version only when consumers tolerate them; because this schema sets `additionalProperties: false`, any new field requires coordinated schema revision and rollout. Introduce v2 route/contract on breaking changes and run old/new consumers during migration.
- **Recovery is not an MVP feature:** Queue declarations, permission grants, worker deployments and APIs for the two `recovery.*` types remain absent from MVP Helm charts and Docker Compose.

## 7. Contract test cases (minimum)

1. Validate each example against the exact Draft 2020-12 schema with `format` checking enabled.
2. Reject missing `project_id`, wrong `message_type`, wrong routing key, unknown payload field, invalid UUID or timestamp, unsupported schema version, and blank IDs.
3. Reject unsafe telemetry context fields such as `authorization`, `cookie`, `password`, `request_body` and access tokens (allowlist only).
4. Publish and consume a real persistent RabbitMQ event; inspect confirms, mandatory return handling and manual ACK.
5. Kill consumer between SQL commit and ACK, restart, and prove no duplicate incident count.
6. Simulate transient failure, assert delayed retry and DLQ after configured attempt budget without hot-looping.
7. Simulate publish-confirm loss; SDK resends same event IDs, proving duplicate safety.
8. Verify two services cannot query each other's PostgreSQL schemas.
9. Confirm AI result remains `PENDING` until queued, and that a failed Gemini call doesn't impact incident ingestion.
10. For future recovery only: prove no execution without an approved DB record, successful eligibility check and authorized approver; verify completion is emitted only after checking post-recovery health.

## 8. Reconciliation notes before implementation

- Change existing [http-api.md](http-api.md) illustrative telemetry message from `telemetry.batch.accepted` to **`error.ingested`**, preserving public `POST /ingest/v1/events/batch`. This is an **internal queue naming update**, not an HTTP API change.
- Align TRD v2 queue routing example from `telemetry/events.batch` to `roottracer.telemetry.v1/error.ingested`, and `ai/investigation.requested` to `roottracer.ai.v1/rca.requested`.
- `NotificationDelivery` and future `RecoveryAction` are present in the logical Prisma schema; production SQL migrations remain owned by each service.
- `AI Service` needs a transactional job enqueue outbox (or an equivalently robust reconciliation process) to guarantee persisted `PENDING` requests eventually publish.
- The `maxItems: 100` event batch cap and retry attempt ceilings in this document are **proposed concrete implementation defaults** (previous TRD required bounded limits but did not fix numeric values). Confirm them against SDK batching, API payload limits and load tests before production release.
