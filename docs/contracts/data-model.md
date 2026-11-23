# RootTracer — Database Design

**Version:** v2.0 · **Status:** Proposed implementation schema · **Architecture:** five independently deployable microservices

> **Important:** RootTracer's approved production stack is **PostgreSQL + `pg` + versioned SQL migrations**, not Prisma ORM. The referenced `schema.prisma` (not included in this document set) is an architectural **reference model** for readable entities, fields, indexes, and local relationships. It must **not** replace the service-owned SQL migrations. Daily PostgreSQL partitioning, triggers, database roles, extension setup and other operational details require handwritten SQL.

## 1. Purpose and scope

Model onboarding/authentication, projects, rotatable ingestion API keys, telemetry events, deduplicated incidents, activity, Gemini-based AI root-cause reports, email notifications, and future human-approved recovery.

- **MVP:** `User`, `AuthToken`, `Project`, `ProjectApiKey`, `Incident`, `RawEvent`, `EventReceipt`, `IncidentActivity`, `IncidentOutbox`, `AiRcaReport`, `NotificationDelivery`.
- **Future only:** `RecoveryAction` — explicitly excluded from the MVP migration/deployment.
- **Redis only:** Login sessions, transient rate-limit counters, cached verified API key metadata. Do not store raw session secrets in PostgreSQL.
- **No GitHub, security-scan, business-impact, team-role, or PR generation tables in MVP.**

## 2. Microservice data ownership

| Service | PostgreSQL schema (or independent database) | Tables it alone can write |
|---|---|---|
| Identity & Projects | `identity` | `users`, `auth_tokens`, `projects`, `project_api_keys` |
| Ingestion | No incident database access | Verified key metadata via Identity contract / short-lived Redis cache |
| Incidents & Telemetry | `incident` | `incidents`, `raw_events`, `event_receipts`, `incident_activities`, `incident_outbox` |
| AI Investigation | `ai` | `ai_rca_reports` |
| Notifications | `notification` | `notification_deliveries` |
| **Recovery (future)** | `recovery` | `recovery_actions` |

**Isolation invariant:** one physical PostgreSQL cluster is permitted for the MVP, but each service receives an isolated DB role restricted to its own schema/database, owns its migrations, and uses service APIs/events rather than reading another service's tables. `project_id`, `incident_id`, `requested_by`, and `approved_by` in other services are **logical external IDs**, not cross-schema SQL foreign keys. They are resolved by authenticated service contracts and lifecycle events.

## 3. Entities, keys, and relations

| Entity | Primary key | Important columns | Local relationships |
|---|---|---|---|
| `users` | `id UUID` | unique normalized `email`, `password_hash`, `email_verified_at` | One user → many projects and auth tokens |
| `auth_tokens` | `id UUID` | `user_id`, `kind`, unique `token_hash`, `expires_at`, `consumed_at` | Many tokens → one user |
| `projects` | `id UUID` | `owner_id`, `name`, `slug`, `deleted_at`, `purge_after` | Many projects → one user; one project → many keys |
| `project_api_keys` | `id UUID` | `project_id`, unique `key_hash`, `key_prefix`, `revoked_at` | Many keys → one project |
| `incidents` | `id UUID` | `project_id`, `environment`, `fingerprint`, `status`, `severity`, `occurrence_count`, `first_seen`, `last_seen` | One incident → many raw events/activities |
| `raw_events` | composite `(event_id, occurred_at)` | `project_id`, `incident_id`, `environment`, `exception_type`, `message`, `stack_trace`, sanitized `context JSONB`, `release` | Many events → one incident |
| `event_receipts` | composite `(project_id, event_id)` | `occurred_at`, `processed_at` | Tracks idempotency independently of partitioned events |
| `incident_activities` | `id UUID` | `incident_id`, `actor_id` (logical), `action`, `before JSONB`, `after JSONB` | Many activities → one incident |
| `incident_outbox` | `id UUID` | `event_type`, `payload JSONB`, `published_at`, `attempts` | Owned by incident transaction/outbox |
| `ai_rca_reports` | `id UUID` | logical incident/user IDs, `status`, `model_provider`, `prompt_version`, `evidence_hash`, `result JSONB`, timing | External logical references only |
| `notification_deliveries` | `id UUID` | logical project/incident IDs, `dedupe_key`, `status`, attempts, provider ID | External logical references only |
| `recovery_actions` **future** | `id UUID` | logical project/incident/RCA/user IDs, `status`, `proposal JSONB`, `idempotency_key`, approval and verification timestamps | External logical references only |

**Physical foreign keys shown in the ER diagram:** `auth_tokens.user_id → users.id`, `projects.owner_id → users.id`, `project_api_keys.project_id → projects.id`, `raw_events.incident_id → incidents.id`, `incident_activities.incident_id → incidents.id`. Other links are **intentional logical associations across microservices**, not missing foreign keys.

## 4. Critical invariants and indexes

### Identity

- Case-insensitive email uniqueness should be implemented with normalized lowercase email on write plus unique constraint/index, or a verified `citext` strategy. Never persist raw passwords.
- Password hashes use Argon2id; email reset/verification token hashes only, expiration and atomic consume checks.
- Project slugs unique per owner: `UNIQUE(owner_id, slug)`.
- Ingestion API keys: generate high-entropy secret; show once; store **only key hash and nonsecret prefix**. A key is valid only if project is active and key unrevoked/unexpired.
- Key rotation supports overlap; revocation should invalidate ingestion caches quickly.
- Project soft deletion immediately denies access and ingest, schedules purge after 7 days, and emits authenticated lifecycle events so each owning service removes its own data. Backup expiry follows a separate documented policy.

### Incidents and telemetry

- Grouping identity: `UNIQUE(project_id, environment, fingerprint)`; normalize stack traces before hashing. Same fingerprint across environments **must not** be merged.
- `occurrence_count` counts **accepted, unique ingested events**, not all errors in the monitored application when sampling is enabled.
- Partition `incident.raw_events` by `occurred_at` **daily**. PostgreSQL unique constraints on partitioned tables must include the partition key; hence the composite primary key.
- The separate unpartitioned `event_receipts` uses `PRIMARY KEY(project_id, event_id)` for **cross-partition idempotency**. Do event receipt insertion, raw event insertion, incident count update, incident activity / outbox changes in **one transaction**, then RabbitMQ ACK after commit.
- Keep idempotency receipts for at least the **maximum message replay window**, coordinated with 30-day event retention. Do not prune while old messages may still be redelivered.
- Important query indexes: `incidents(project_id, status, severity, last_seen)`, `incidents(project_id, last_seen)`, `raw_events(project_id, occurred_at)`, `raw_events(incident_id, occurred_at)`, `incident_activities(incident_id, created_at)`.
- Incident search: PostgreSQL full-text index on **sanitized** exception type + title/message as appropriate. All queries strictly constrain `project_id`. Avoid indexing arbitrary JSONB keys without demonstrated query need.
- Raw events retained 30 days. Incident summaries/history retained longer per separately documented policy. Add background partition creation and expiration jobs and test retention boundaries.

### AI reports

- One immutable row per investigation attempt or request. Use status `PENDING → PROCESSING → COMPLETED/FAILED`. Preserve history, `model_name`, `prompt_version`, `evidence_hash` and structured result.
- An AI report is a **probable** root-cause analysis, not a verified diagnosis. Result JSON should contain probable causes, evidence, uncertainty/limitations and suggested fixes; validate using Zod before insertion.
- Cache by incident/evidence hash and budget requests per project. Do not persist unsanitized raw prompts or API credentials.

### Notifications

- `notification_deliveries.dedupe_key` unique to avoid repeated send attempts for one logical notification decision. Provider delivery may be at-least-once; keep clear retry semantics.
- Email cooldown and alert thresholds need stable rule identifiers; store normalized configuration within Incident-owned storage in follow-up migrations if per-project editing is added.

### Recovery — future only

- `recovery_actions` is a **future blueprint**, not part of current runtime.
- Require explicit developer authorization, eligibility evaluation, scoped execution credentials, unique idempotency key, post-execution verification and immutable audit records.
- State changes are controlled: `PROPOSED → AWAITING_APPROVAL → APPROVED / REJECTED → EXECUTING → VERIFYING → SUCCEEDED / FAILED`. Cancellation and exceptional transitions require explicit guards. Do not execute solely from an AI report.
- For a later production rollout, add `recovery_action_transitions` (append-only audit ledger) and formal execution/verification result tables; one JSON field alone is not sufficient for strong auditability.

## 5. Service boundaries, deletion and consistency

- **No cross-service DB transaction:** coordinate through versioned REST contracts, events and local transactions.
- **Outbox:** Incident writes `incident_outbox` atomically with the incident update, then a publisher uses RabbitMQ publisher confirms; consumers dedupe.
- **Identity authority:** BFF validates sessions; internal services authenticate requests and enforce user/project access, never trusting unverified client-supplied `project_id`.
- **Delete propagation:** Identity emits project deleted/purge events; Incident/AI/Notifications independently execute idempotent deletion and record completion, including queued work and cached state.
- **Privacy:** capture only approved metadata, redact in SDK and server, exclude tokens/cookies/request bodies by default, avoid sensitive data in logs and AI requests.

## 6. SQL migrations versus Prisma format

The referenced `schema.prisma` describes logical models and supported indexes. In production:

1. Each service owns a `migrations/` directory of immutable, versioned `.sql` files.
2. Migration runner maintains a table of applied versions **per service/schema**.
3. Use `CREATE SCHEMA`, `CREATE ROLE`, grants, `pgcrypto` if needed, `PARTITION BY RANGE`, per-partition DDL, text-search indexes, CHECK constraints, triggers and operational settings explicitly in SQL.
4. Prisma's shown `RawEvent` model is **not** a substitute for native range partition creation. The ER drawing reflects a **logical flat CREATE TABLE representation** so it can display relationships; it does not prove migration completeness.
5. Do not grant Identity DB role permissions on incident/AI/notification tables (or vice versa).

## 7. Event processing transaction (illustrative)

```sql
BEGIN;

-- Duplicate detection scoped by project across daily event partitions.
INSERT INTO incident.event_receipts(project_id, event_id, occurred_at, processed_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (project_id, event_id) DO NOTHING
RETURNING event_id;

-- If no row was returned: this event was previously processed; COMMIT and ACK.
-- Otherwise:
-- 1) UPSERT the incident scoped to (project_id, environment, fingerprint).
-- 2) INSERT raw event in the proper occurred_at partition.
-- 3) Increment occurrence_count exactly once and update last_seen.
-- 4) Insert activity/outbox records if status/alert rules require them.

COMMIT;
-- Only after commit: RabbitMQ basic.ack
```

This is transaction pseudocode, **not an executable complete migration**. The implementation must handle concurrent upserts, creation/updates and lock contention correctly.

## 8. ER diagram and reference files

- `schema.prisma` — Prisma-format reference, including **future** RecoveryAction.
- Zovo ER Diagram — PostgreSQL `CREATE TABLE` representation of **12 logical tables**, including future RecoveryAction. Only same-service physical foreign keys are drawn, by design.
- [Logical ER diagram (SVG)](../architecture/diagrams/logical-data-model.svg) — saved export; the diagram service's temporary download links expire.

## 9. Open implementation details to finalize during LLD

- Managed PostgreSQL deployment choice, individual schema credentials, role grants, SQL migration tool, UUID generation and time partition manager.
- Partition strategy for future late-arriving events and invalid/out-of-retention timestamps.
- Ingest key invalidation and stale-cache fail-closed behavior.
- Deduplication receipt retention based on actual RabbitMQ retry / replay lifetime.
- Detailed incident outbox routing and deterministic email `dedupe_key`.
- Data retention policy for reports, activities, notification records, backup snapshots and deletion receipts.
- Recovery audit tables, approved action types and verifier contracts — future phase only.

**Document status:** Engineering blueprint; schema review passed for the tool-readable logical DDL, not a substitute for migration execution tests and authorization tests.
