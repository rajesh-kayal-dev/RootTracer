# RootTracer — Repository Blueprint

**Architecture:** v2 independent Node.js/Express/TypeScript microservices + a single feature-based Next.js App Router dashboard + a public Node.js SDK.  
**Status:** Proposed implementation layout, aligned with PRD/MVP/TRD v2. **MVP only**; Smart Recovery and GitHub fixing are not deployed.  
**Tooling:** Node.js 22/24 LTS, pnpm workspaces, Turborepo, PostgreSQL with **`pg` + service-owned SQL migrations**, RabbitMQ, Redis, Google Gemini, Resend/Mailpit, Docker Compose, Kubernetes/Helm/Terraform.

## 1. Canonical monorepo tree

```text
roottracer/
├── apps/
│   └── web/                                   # Next.js App Router (frontend only)
│       ├── src/
│       │   ├── app/
│       │   │   ├── (auth)/
│       │   │   │   ├── login/page.tsx
│       │   │   │   ├── register/page.tsx
│       │   │   │   ├── verify-email/page.tsx
│       │   │   │   └── reset-password/page.tsx
│       │   │   ├── (dashboard)/
│       │   │   │   ├── layout.tsx
│       │   │   │   ├── overview/page.tsx
│       │   │   │   ├── projects/page.tsx
│       │   │   │   ├── projects/[projectId]/page.tsx
│       │   │   │   ├── projects/[projectId]/incidents/page.tsx
│       │   │   │   ├── projects/[projectId]/incidents/[incidentId]/page.tsx
│       │   │   │   └── settings/page.tsx
│       │   │   ├── layout.tsx
│       │   │   ├── page.tsx
│       │   │   ├── not-found.tsx
│       │   │   └── providers.tsx
│       │   ├── features/                       # Business functionality; NOT micro-frontends
│       │   │   ├── authentication/{api,components,hooks,schemas,types}/
│       │   │   ├── projects/{api,components,hooks,schemas,types}/
│       │   │   ├── monitoring/{api,components,hooks,types}/
│       │   │   ├── incidents/{api,components,hooks,schemas,types}/
│       │   │   ├── ai-investigation/{api,components,hooks,schemas,types}/
│       │   │   ├── notifications/{api,components,hooks,schemas,types}/
│       │   │   └── settings/{api,components,hooks,schemas,types}/
│       │   ├── components/{ui,layout,feedback}/  # Reusable shadcn/Radix primitives
│       │   ├── lib/{api,auth,query,utils}/       # Typed gateway client & helpers
│       │   ├── hooks/                            # Cross-feature hooks only
│       │   ├── stores/                           # Zustand client-only UI state
│       │   └── styles/globals.css                # Tailwind + Concept A light tokens
│       ├── public/
│       ├── tests/{unit,integration,e2e}/
│       ├── next.config.ts
│       ├── package.json
│       ├── tsconfig.json
│       ├── .env.example                         # Optional web-only override
│       └── Dockerfile
│
├── services/
│   ├── gateway/                                # Thin browser-facing API/BFF
│   │   ├── src/{app.ts,server.ts,routes,middleware,clients,config}/
│   │   ├── tests/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── identity-service/                       # Auth, projects, SDK API keys
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   ├── modules/{auth,users,projects,api-keys}/
│   │   │   │   └── [each-module]/{routes,controller,service,repository,schema}.ts
│   │   │   ├── infrastructure/{db,redis,messaging,mailer}/
│   │   │   └── config/index.ts
│   │   ├── migrations/                          # IDENTITY-owned versioned .sql files
│   │   ├── tests/{unit,integration,contract}/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── ingestion-service/                      # Public SDK ingestion HTTPS API
│   │   ├── src/{app.ts,server.ts,modules/ingestion,infrastructure,config}/
│   │   ├── tests/{unit,integration,contract}/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── incident-service/                       # Incident query API + async telemetry worker
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   ├── workers/{telemetry.consumer.ts,outbox.publisher.ts}/
│   │   │   ├── modules/{incidents,events,activities,alert-rules}/
│   │   │   ├── infrastructure/{db,messaging}/
│   │   │   └── config/index.ts
│   │   ├── migrations/                          # INCIDENT-owned .sql; partition jobs
│   │   ├── tests/{unit,integration,contract}/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── ai-service/                             # RCA API + separate Gemini worker
│   │   ├── src/{app.ts,server.ts,modules/investigations,workers,infrastructure,config}/
│   │   ├── migrations/                          # AI-owned .sql + enqueue outbox
│   │   ├── tests/{unit,integration,contract}/
│   │   ├── Dockerfile
│   │   └── package.json
│   └── notification-service/                   # Separate email worker
│       ├── src/{workers,modules/email,infrastructure,config}/
│       ├── migrations/                          # NOTIFICATION-owned .sql
│       ├── tests/{unit,integration,contract}/
│       ├── Dockerfile
│       └── package.json
│
├── packages/
│   ├── sdk-node/                               # Public SDK (@roottracer/node TBD)
│   │   ├── src/{index.ts,client.ts,transport,batching,redaction,integrations/express}/
│   │   ├── tests/{unit,integration}/
│   │   ├── package.json                        # ESM + CJS + .d.ts exports
│   │   ├── tsconfig.json
│   │   └── README.md
│   ├── contracts/                              # API Zod schemas, OpenAPI, versioned events
│   │   ├── src/{http,events,shared}/
│   │   ├── schemas/                            # events.md JSON Schema v1 copies
│   │   ├── tests/                              # Producer/consumer compatibility
│   │   └── package.json
│   ├── logger/                                 # Pino structured logging, IDs, safe fields
│   ├── config/                                 # Per-service environment Zod schemas
│   ├── testing/                                # Shared tests ONLY, no domain repositories
│   └── ui/                                     # Optional web-only reusable UI package
│
├── infrastructure/
│   ├── docker/
│   │   ├── compose.yaml                        # All 5 services + BFF + dependencies
│   │   ├── compose.dev.yaml                    # Host mounts/HMR overrides
│   │   └── rabbitmq/{definitions.json,rabbitmq.conf}/
│   ├── kubernetes/{local,base}/                # kind/k3d plus shared manifests
│   ├── helm/                                   # Separate releases per service/worker/web
│   └── terraform/                              # Cloud provisioning, not source secrets
├── scripts/{bootstrap,dev,migrate,create-partitions,prune-partitions}/
├── tests/
│   ├── contracts/                              # HTTP + RabbitMQ contract tests
│   ├── integration/                            # Docker dependencies
│   ├── e2e/                                    # Playwright user journey
│   ├── load/                                   # 100 EPS sustained / 500 EPS burst goals
│   └── fixtures/demo-node-app/                # Real SDK example
├── docs/
│   ├── architecture/{technical-requirements.md,repository-structure.md,diagrams/,LLD/}
│   ├── contracts/{http-api.md,events.md,event-schemas.v1.json,data-model.md,schema.prisma,openapi.yaml}
│   ├── product/{mvp-requirements.md,product-vision.md,user-flows.md}
│   ├── planning/{mvp-plan.md,milestones.md}
│   ├── engineering/coding-guidelines.md
│   ├── sdk/
│   └── runbooks/{deploy.md,rollback.md,dlq-replay.md,db-retention.md}
├── .github/workflows/{ci.yml,release.yml,deploy.yml}
├── .env.example                               # One documented LOCAL Compose template
├── .gitignore
├── .npmrc
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── turbo.json
└── README.md
```

**Tree legend:** Braced directory segments (`{api,components,...}`) are illustrative shorthand, not literal folder names. `[each-module]` denotes the per-domain implementation pattern. The public SDK is a published library, not a server. Workers in the incident/AI service may use separate container entrypoints and Kubernetes deployments while still belonging to the owning service.

## 2. Packages and dependency rules

| Workspace | Responsibility | May depend on |
|---|---|---|
| `apps/web` | Dashboard routes + feature modules | `packages/contracts`, `packages/ui` (optional), frontend utilities |
| `services/gateway` | Authenticated HTTP routing/BFF, CSRF, correlation IDs | `contracts`, `logger`, `config` |
| `services/identity-service` | Authoritative users, projects, keys, sessions | `contracts`, `logger`, `config` |
| `services/ingestion-service` | Validate SDK batches, rate limit, broker-confirmed enqueue | `contracts`, `logger`, `config` |
| `services/incident-service` | Dedup and incidents, project-scoped read APIs | `contracts`, `logger`, `config` |
| `services/ai-service` | Gemini RCA, versioned investigation history | `contracts`, `logger`, `config` |
| `services/notification-service` | Email sending + delivery state | `contracts`, `logger`, `config` |
| `packages/sdk-node` | Portable Node package, SDK sanitization and capture | SDK-compatible contracts only; **no server-only packages** |

**Rules:** Domain services never import each other's `src`, repositories, SQL, or business logic. All cross-service interactions use **versioned HTTP contracts or RabbitMQ messages**. Shared packages hold pure code only. Each service owns **its own database role/schema and migrations**; one PostgreSQL server is acceptable for local/MVP cost. Backend uses `pg` with parameterized SQL (no Prisma runtime). `schema.prisma` remains a documentation reference only.

## 3. Frontend module convention

An example feature module:

```text
apps/web/src/features/incidents/
├── api/{incidents.client.ts,incidents.queries.ts}
├── components/{IncidentList.tsx,IncidentDetails.tsx,IncidentFilters.tsx}
├── hooks/{useIncidents.ts,useIncident.ts}
├── schemas/incident.schema.ts
├── types/incident.types.ts
└── index.ts
```

Use `app/` for Next.js route composition/layouts. `features/` owns feature components, API hooks, validation and types. Components in `components/ui` must remain domain-agnostic. Use **TanStack Query for server data**, **Zustand only for truly shared client UI state**, **React Hook Form + Zod for forms**, **Recharts for visualizations**, **Tailwind + shadcn/ui + Radix UI** for the approved light UI. Dashboard data refresh can poll approximately every 15 seconds while mounted. Never fetch Postgres/RabbitMQ/Gemini directly from client components.

## 4. Public HTTP and internal service boundaries

| Component | Local host port (example) | Public? | Contract |
|---|---:|---|---|
| Next.js web | `3000` | Browser-facing | UI, calls gateway `/api/v1` |
| Gateway/BFF | `4000` | Browser-facing behind same-site reverse proxy | Session-backed `/api/v1/*` |
| Ingestion | `4002` | SDK-facing `/ingest/v1/*` (TLS behind ingress) | Project ingest API key only |
| Identity | `4001` | Private | Versioned internal auth/project/key APIs |
| Incident | `4003` | Private | Versioned incident and telemetry API |
| AI | `4004` | Private | Versioned investigations API |
| Notifications | worker only | Private | RabbitMQ consumer, optional private health endpoint |

These are **illustrative local ports**, not user-approved production endpoints. In production expose a single application origin (same-site session cookie/CSRF) plus the SDK ingestion hostname/path; keep internal HTTP services, Redis, RabbitMQ, PostgreSQL, worker management and Mailpit private. Route browser requests through BFF; never put project secrets in `NEXT_PUBLIC_*` variables.

## 5. Local `.env.example` contract

Use the root-level local development template, supplied here as [env.example](../../env.example); the proposed repository names it `.env.example`. Its variables are grouped by which process consumes them. In Docker Compose, inject relevant variables using explicit `environment`/`env_file` mappings; **do not** blindly pass every secret to every container. Service-local `packages/config` Zod schemas should reject missing required values at startup. Root-level `.env` is ignored by Git; commit `.env.example` only. This is a blueprint, not a tested Docker Compose configuration.

**Environment strategy:**

1. Copy `.env.example` to `.env` and replace every `CHANGE_ME` value with unique local secrets. Never commit `.env`, `.env.*.local`, `.env.production`, private keys or credentials.
2. Run local PostgreSQL, RabbitMQ, Redis and Mailpit through Docker Compose; run the dashboard via `pnpm --filter web dev` if preferred. Hostnames differ depending on host vs container; compose service names (`postgres`, `rabbitmq`, `redis`, `mailpit`) work **inside containers**.
3. Provision *distinct service-scoped DB users* and schemas (`identity`, `incident`, `ai`, `notification`). Each service receives only its own database connection string. Their initial creation is handled by provisioning/init scripts, **not by the app at runtime**.
4. Configure `EMAIL_PROVIDER=mailpit` for local development. Use `EMAIL_PROVIDER=resend` plus a real `RESEND_API_KEY` only in an approved hosted environment. Gemini is needed to test live AI; otherwise use a clearly labeled mock in local tests.
5. Configure dev/staging/prod separately. Production uses a managed secret manager/Kubernetes Secret injection, no root `.env` shipping in images and no database admin URL in application containers.
6. `NODE_ENV` can be shared but service ports, queue settings, service URLs and feature flags are process-specific; `config` package Zod validation checks the proper profile per service.

## 6. RabbitMQ topology and processing ownership

| Message | Exchange | Routing key | Durable queue | Owning worker |
|---|---|---|---|---|
| `error.ingested` | `roottracer.telemetry.v1` | `error.ingested` | `telemetry.events` | Incident telemetry consumer |
| `rca.requested` | `roottracer.ai.v1` | `rca.requested` | `ai.investigations` | AI worker |
| Email alert command | Notification exchange (to be finalized) | `notifications.email` | `notifications.email` | Notification worker |

Use producer confirms/mandatory routing, persistent messages, consumer manual ACK after durable DB commit, idempotent event receipt/upsert, delayed retry queues and DLQs. [events.md](../contracts/events.md) is canonical for the first two event schemas. **Human-approved recovery events/queues are future-only** and are not part of this MVP repository.

**Reliable state/event transition:** Incident owns local outbox for alerts. AI requests require a persistent enqueue outbox/reconciliation so a crashed publisher does not leave investigations stuck in `PENDING`. No distributed transaction is assumed between Postgres and RabbitMQ.

## 7. Required config and scripts

**Root `package.json` scripts (planned):** `dev`, `build`, `typecheck`, `lint`, `test`, `test:integration`, `test:e2e`, `migrate`, `format`. Turborepo orchestrates `dev/build/test/typecheck` with workspace scopes; each service has its own start/dev scripts and Dockerfile.

**Deployables (minimum):** web, gateway, identity HTTP, ingestion HTTP, incident HTTP, incident telemetry worker, incident outbox dispatcher (can initially share a worker deployment if lifecycle is well defined), AI HTTP, AI worker, notification worker. All get shutdown hooks, readiness/liveness checks, structured logs, service credentials, resource limits, and release-specific config.

**Database:** Migration files live under each service's `migrations/` folder; `raw_events` daily partitions, receipts, alert outbox and isolation grants require executable PostgreSQL SQL. Create/drop partitions with a scheduled local job and Kubernetes CronJob in cloud. Make deletion/retention project-aware; do not conflate backup expiry with live data retention.

**Tests:** Validate producer/consumer contracts against exact JSON Schemas; cross-project access denied; duplicate event IDs don't double-count; email cooldown; API key overlap and revocation; worker crash after commit/before ACK; DLQ replay; Gemini timeout and invalid structured result; browser authentication and CSRF. Load targets: 100 events/sec sustained, 500 events/sec bursts (targets, not verified measurements).

## 8. MVP scope boundary

**In:** developer authentication and projects, Node SDK, event ingestion, incident grouping/status, dashboard, on-demand Gemini investigation, Resend/Mailpit notifications. **Out:** automatic recovery, recovery approval endpoints and jobs, GitHub PR fixing, business impact tracking, security scanning, teams/multi-tenant role hierarchies. Recovery tables/events remain documentation-only.

## 9. Implementation sequence

1. Bootstrap monorepo, tooling, contracts, local infrastructure, logging and CI.
2. Implement Identity + projects, sessions, API keys and DB migrations.
3. Build public SDK + Ingestion API + RabbitMQ broker-confirmed delivery.
4. Implement Incident API, telemetry worker, partitions, idempotency and alert outbox.
5. Build feature-based Next.js dashboard against gateway contracts.
6. Implement AI investigation API/worker, bounded Gemini integration and version history.
7. Implement notification worker and email alert rules/cooldown.
8. Hardening: security, e2e/load tests, Kubernetes/Helm rollout, backup/rollback runbooks.

**Companion documents:** [mvp-requirements.md](../product/mvp-requirements.md), [technical-requirements.md](technical-requirements.md), [data-model.md](../contracts/data-model.md), [http-api.md](../contracts/http-api.md), [events.md](../contracts/events.md).
