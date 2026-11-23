# RootTracer — Coding Guidelines

**Applies to:** RootTracer MVP v2 (Node.js/Express/TypeScript microservices + feature-based Next.js + Node SDK). These rules guide coding agents; they do not authorize expanding product scope or making irreversible changes.

## 1. Source of truth and scope

Read the repository documents relevant to the requested work before changing code:

1. [mvp-requirements.md](../product/mvp-requirements.md) — locked MVP scope, product requirements and acceptance criteria.
2. [milestones.md](../planning/milestones.md) — four vertical milestones, dependency order and exit gates.
3. [http-api.md](../contracts/http-api.md) — public and internal HTTP contracts.
4. [events.md](../contracts/events.md) — RabbitMQ contracts, retries and routing. Use its canonical v1 names `error.ingested` and `rca.requested` when earlier documents use different examples; reconcile contracts before implementation.
5. [data-model.md](../contracts/data-model.md) and `schema.prisma` — **logical database design only**; production implementation uses `pg` and service-owned versioned SQL migrations.
6. [repository-structure.md](../architecture/repository-structure.md) — repository layout; [env.example](../../env.example) (planned as `.env.example`) — configuration keys without real credentials.
7. [technical-requirements.md](../architecture/technical-requirements.md) and [mvp-plan.md](../planning/mvp-plan.md) — system architecture and MVP design.

**Locked MVP capabilities:** authentication/project/SDK onboarding; Node SDK error capture; ingestion and incidents; developer dashboard; on-demand Gemini RCA; email alerts via Resend/Mailpit. **Do not implement or deploy** Smart Recovery, `recovery.*` RabbitMQ consumers, recovery approval endpoints, GitHub auto-fix/PRs, business-impact tracking, security scanning or team roles. Future schemas/specifications are design references only.

## 2. Make focused, reviewable changes

- Locate and understand existing code, contracts and tests before editing. Prefer the smallest change fulfilling the user story; avoid speculative features, whole-file rewrites, unrequested dependencies or architecture changes.
- For work larger than one file, state the approach and affected services first. Follow the current [milestones.md](../planning/milestones.md) milestone; finish a testable end-to-end slice instead of adding disconnected placeholders.
- Preserve public APIs, queue contracts, migrations and existing behavior unless the request explicitly authorizes a breaking change. For a change to public contracts, update docs, types, validation, producers, consumers and tests together.
- Do not claim a feature, test, deployment, security review or performance benchmark succeeded unless actually executed and checked. Report commands run, results, failures and outstanding risks.
- Never invent or log real API keys, database passwords, user data, credentials or provider responses. Never commit `.env`, private keys, generated secrets or sensitive fixtures.
- Ask before destructive database changes, dropping data, deleting important source files, running production migrations, publishing npm packages, sending live emails, or deploying to production.

## 3. TypeScript and code quality — mandatory

- Use **strict TypeScript** in all TS packages: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` (where applicable) and `useUnknownInCatchVariables`. Keep ESM/CJS compatibility for the public SDK as explicitly designed.
- **No `any`**, blind `as` casts, `!` non-null assertions, `@ts-ignore`, `@ts-nocheck`, broad `Record<string, any>` or untyped JSON. For unavoidable interoperability, isolate a narrow reviewed adapter and document the reason; validate `unknown` before use.
- Use discriminated unions for states/results, readonly properties where appropriate, explicit return types for public APIs, exhaustive handling of domain enums, and typed error responses.
- Treat all I/O as **untrusted `unknown`** until validated: HTTP payloads, headers, path/query params, decoded cookies, queue messages, environment config, database JSON, third-party responses and Gemini output.
- Prefer simple functions, dependency injection at infrastructure boundaries, clear domain naming and cohesive modules. Avoid unnecessary classes, singletons, deeply nested branching and premature abstractions.
- Prefer async/await; catch at meaningful boundaries, retain error causes in private structured logs (redacted), and return safe predictable errors to clients. Avoid unhandled promises and fire-and-forget work without supervision.
- Run format, lint and typecheck for affected packages; do not bypass failing checks.

## 4. Backend service boundaries

- The backend is **independently deployable microservices**, not a single modular monolith. The monorepo is a development convenience, not permission to share database access.
- Service responsibilities:
  - `gateway` — thin browser-facing BFF, session validation/authorization context, CSRF and routing; **no domain logic or domain DB**.
  - `identity-service` — users, email verification, Redis sessions, projects, SDK key lifecycle.
  - `ingestion-service` — `POST /ingest/v1/events/batch`, key verification, Zod/schema validation, rate limits, durable RabbitMQ accept.
  - `incident-service` — incident queries/status, fingerprinting, daily-partitioned events, telemetry worker and incident outbox.
  - `ai-service` — investigation API + worker, sanitized evidence over Incident internal API, Gemini, versioned results.
  - `notification-service` — email worker, delivery dedupe, cooldown, retries and Resend/Mailpit.
- Each service owns its runtime, container, config validation, SQL migrations, PostgreSQL role/schema and tests. **Never SELECT/JOIN/INSERT into another service's tables**, import another service's repository, or introduce cross-service SQL foreign keys.
- Cross-service synchronous interactions use authenticated, versioned internal HTTP contracts; asynchronous interactions use versioned RabbitMQ messages. Propagate correlation IDs; enforce per-project authorization at every domain boundary, not solely at the gateway.
- Shared `packages/contracts` contains API/event schemas and types, **not** shared persistence or business logic. Shared `logger`/`config` stay infrastructure-neutral.
- Health/readiness routes must be operationally meaningful. Use bounded timeouts, retry budgets, graceful shutdown, backpressure and bounded `pg.Pool` sizes.

## 5. API validation and authentication

- Define Zod schemas for all public and internal HTTP request bodies, query/path params and responses at the boundary. Reject malformed inputs with standardized JSON errors and `request_id`; never leak stack traces to callers.
- Use parameterized SQL (`$1`, `$2`, ...); never concatenate SQL values from HTTP, events or model outputs. Allowlist dynamic column names, ordering and filters.
- Passwords: Argon2id with reviewed secure settings. Verification/reset tokens: high entropy, hash at rest, expire, consume once. Sessions: **server-side Redis sessions** in `HttpOnly`, `Secure` (production), properly configured `SameSite` cookies, with session rotation, expiry and logout; **do not switch to JWT/localStorage tokens**.
- Require CSRF protection on cookie-authenticated state changes, restrictive CORS, secure headers, rate limits by account/project/key, and authorization before entity lookup or mutation.
- SDK keys: project-scoped, hashed at rest, secret displayed once, overlap during rotation, immediate/emergency revocation with bounded cache staleness; SDK key cannot authorize dashboard APIs.
- Do not trust browser-supplied project/user IDs as proof of ownership. No public endpoint should accept service-only credentials or bypass internal service authentication.

## 6. Data ownership, event processing and failure safety

- Use PostgreSQL via `pg` with versioned **raw SQL** migrations per owning service; no Prisma/Drizzle runtime or migrations. Treat `schema.prisma` as documentation only.
- Every tenant-owned query must include checked `project_id` scope; test cross-tenant reads and writes. Use composite indexes aligned with filtered queries and cursor pagination.
- Raw events: partition daily by `occurred_at` and retain about 30 days as specified. A partitioned unique key cannot enforce global `event_id` uniqueness alone; use `(project_id,event_id)` in the unpartitioned `event_receipts` table in the same transaction as incident updates.
- Incident grouping key: project + environment + normalized exception type/stack fingerprint. Duplicate deliveries must never inflate occurrence counts; status regressions must be explicit and audited.
- RabbitMQ: durable exchanges/queues and persistent messages, publisher confirms **and mandatory routing**, finite prefetch, manual ACK **after DB commit**, delayed bounded retries and DLQ. Never claim exactly-once delivery or respond HTTP `202` until durable publish acceptance is confirmed.
- For incidents triggering emails use a **transactional outbox**; for AI investigation requests persist `PENDING` and enqueue intent atomically in an AI-owned outbox. On publisher uncertainty, fail safely and reconcile idempotently. Do not make unsafe cross-service transactions.
- Use exact contracts from [events.md](../contracts/events.md): `error.ingested` for telemetry batches and `rca.requested` for AI jobs. Validate payloads on producer **and consumer**. Notification events need their own versioned schema before implementation.
- Under RabbitMQ/Redis/DB/provider failure, fail predictably with retryable errors where appropriate. Do not spin indefinitely, drop accepted work without a record, block application SDK request paths, or fabricate AI results.

## 7. SDK-specific constraints

- Support Node.js 22/24 LTS, TypeScript definitions and ESM/CJS builds. Public API remains intentionally small (`captureException`, explicit Express middleware, `flush`, `shutdown`, documented configuration).
- SDK must not crash, stall or replace host application error handlers or shutdown behavior. Automatic capture of uncaught exceptions/unhandled rejections must coexist with existing listeners; avoid forced process exits.
- Use bounded async batching/buffer, timeouts, backoff, sampling and idempotent event UUIDs. Handle retries and failed flush explicitly; minimize runtime dependencies and overhead.
- Privacy by default: strip passwords, secrets, auth headers, cookies and request bodies; use allowlisted sanitized metadata, then revalidate on ingestion. Never send full request objects or uncontrolled arbitrary context to Gemini.

## 8. Next.js feature-based frontend

- `apps/web/src/app/` only for routing, layouts and page composition. Product functionality lives under `src/features/{authentication,projects,monitoring,incidents,ai-investigation,notifications,settings}`. Shared design primitives live under `src/components/ui/` and cross-feature helpers under `src/lib/`.
- Next.js App Router + strict TypeScript; Tailwind CSS + shadcn/ui/Radix; TanStack Query for server state (~15-second conditional monitoring polling); Zustand **only** for small client-only shared UI state; React Hook Form + Zod for forms; Recharts for metrics.
- Build accessible, responsive components with semantic labels, keyboard support, visible error/loading/empty states and reusable RootTracer Concept A light-theme tokens.
- Never put secrets into `NEXT_PUBLIC_*`, client bundles or browser logs. Frontend calls the gateway/BFF, **never** PostgreSQL, RabbitMQ, Gemini, Resend or internal service URLs directly.
- Do not duplicate TanStack Query server state in Zustand. Prefer URL query parameters for shareable filters; use typed gateway clients, handle authorization failures and invalidate affected queries after mutations.

## 9. AI investigation and notifications

- Gemini is **on-demand** per incident. Obtain bounded, sanitized evidence via the Incident Service API—not cross-service SQL—and validate the structured result with Zod; record provider/model/prompt version, evidence hash, status and failure codes.
- Display findings as *probable causes with evidence, uncertainty and suggested next steps*, not verified diagnosis or automatic remediation. Bound concurrency, input/output size, cost and project quotas. Cache same-evidence results carefully; allow new investigation on changed evidence.
- Email is dispatched asynchronously via Notification Service; use provider adapter (Mailpit/local; Resend deployed), per-project settings, cooldown and durable idempotency; external email delivery is not guaranteed exactly once.
- Do **not** execute recovery commands or create `recovery.*` queues in MVP even if future contracts exist.

## 10. Tests and acceptance gates

- **Every changed domain behavior needs tests**, including negative authorization and malformed input cases. Use Vitest, Supertest, Docker-backed real PostgreSQL/Redis/RabbitMQ integration tests, React Testing Library and Playwright. Mock Gemini/Resend in deterministic CI; opt-in live smoke tests only.
- For worker changes test crash between SQL COMMIT and ACK, duplicate messages, publish-confirm loss, retries, DLQ, stale/deleted project handling, malformed event schemas and outbox recovery.
- For SDK changes test timeout, shutdown/flush, sampling, redaction, Express error middleware and host app stability; use `tests/fixtures/demo-node-app`.
- For database migrations test fresh install, compatible upgrade, rollback/repair plan, partition creation/retention, transaction concurrency and role isolation. Migrations must not silently erase data.
- Prefer `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build` **only if scripts exist**. If a command is unavailable, say so—do not pretend it ran.
- Each milestone has a concrete user-visible demo and exit gate in [milestones.md](../planning/milestones.md). Record actual evidence, not aspirational green checkmarks.

## 11. Definition of done for an AI coding task

1. Implementation fits existing folder ownership and MVP scope.
2. Schemas/typed contracts and error paths updated across producer/consumer boundaries.
3. Security, tenant access and privacy implications checked.
4. Relevant automated tests added/executed; lint/typecheck/build run where available.
5. Docs and `.env.example` updated if new interfaces/configuration introduced.
6. Final report summarizes changed paths, exact checks/results and known limitations; never imply success beyond verification.

**When an instruction conflicts with RootTracer's approved architectural decisions, stop and explain the conflict rather than silently redesigning the system.**
