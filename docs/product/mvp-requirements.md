# RootTracer — MVP Requirements

**Version:** 1.0 (MVP scope lock)  
**Status:** Approved scope; implementation pending  
**Product:** RootTracer — AI-powered application error monitoring and investigation  
**Product goal:** Help a developer connect a Node.js application, detect and investigate production errors, and receive actionable alerts without granting automated recovery access.

## 1. Problem statement

Developers often find application failures through scattered server logs, customer reports, or manually checking production systems. Repeated errors are hard to group, and diagnosing them requires reconstructing stack traces, occurrence history, environments, and release context. RootTracer provides a single incident view and optional AI-assisted investigation, so developers can identify likely causes faster while retaining control over fixes.

RootTracer **does not promise** to detect every defect, prove root cause automatically, or repair production applications in the MVP.

## 2. Target users

**Primary:** Individual backend and full-stack developers maintaining Node.js/Express applications, including small SaaS products and internal services.

**Initial account model:** One developer account owns one or more monitoring projects. Team roles, organization permissions, and collaborative incident assignments are not part of MVP.

## 3. MVP success journey

1. Developer signs up, verifies their email, and creates a RootTracer project.
2. Developer installs the Node.js SDK and configures a project ingestion key.
3. An application error is captured and sent asynchronously to RootTracer.
4. Developer sees an incident in the dashboard, with grouped occurrences and useful debugging evidence.
5. Developer requests a Gemini investigation when needed and reviews a structured, evidence-based possible explanation.
6. Developer is notified about qualifying incidents by in-app indicators and email, without repeated alert spam.

## 4. MVP scope — exactly five core features

### F1. Developer account, project onboarding & SDK integration

**Outcome:** A developer can connect a Node.js application without manual backend configuration.

- Email/password signup, email verification, login/logout, and password reset.
- Create, list, select, and soft-delete personal projects.
- Issue, rotate, and revoke project-scoped ingestion API keys; keys have no dashboard permission.
- Install a published TypeScript Node.js SDK, with support for Node.js 22/24 and Express integration.
- Capture errors manually and via opt-in automatic exception/rejection hooks and Express error middleware.
- Configure environment, release, sampling, privacy scrubbing, bounded batches/retries, and graceful flush/shutdown.
- Show setup instructions and a connection/first-event confirmation.

### F2. Error ingestion, grouping & incident management

**Outcome:** Captured events become reliably searchable, actionable incidents.

- Receive schema-validated HTTPS batches; acknowledge only after durable RabbitMQ acceptance.
- Asynchronously process events; deduplicate by event ID and group similar errors using deterministic fingerprints.
- Keep occurrence count, first/last seen, stack trace, environment, release, severity, and event history.
- Support incident lifecycle: `Open`, `Investigating`, `Resolved`, `Regressed`; record activity history.
- Support project-scoped search, filters, and cursor pagination.
- Retain raw error events for 30 days; preserve incident summaries longer according to policy.
- Apply privacy-first collection; do not collect credentials, cookies, or request bodies by default.

### F3. Developer dashboard & incident exploration

**Outcome:** Developers can understand application error health and investigate a specific incident.

- Next.js dashboard using the approved **Concept A — Clear Overview** light design.
- Overview: total/recurring errors, open/resolved incidents, severity breakdown, 24h/7d trends, and recent incidents.
- Project selector; environment, status, severity, release, and time-range filters.
- Incident detail: message, sanitized stack trace, occurrence history, release/environment information, and activity timeline.
- Automatically refresh incident data about every 15 seconds while the page is active.
- Responsive layout, keyboard-accessible controls, clear loading/empty/error states.

### F4. On-demand AI incident investigation

**Outcome:** Developers can request a useful, reviewable diagnosis suggestion without changing production systems.

- Explicit **Investigate with AI** action on an incident; no automatic per-event AI calls.
- Send bounded, sanitized incident evidence to Google Gemini: error type/message, stack trace, occurrence pattern, relevant metadata, environment, and release.
- Return validated structured findings: possible cause, supporting evidence, suggested next steps, uncertainty/limitations.
- Display `Pending`, `Processing`, `Completed`, or `Failed` states and allow controlled retry.
- Store versioned investigation history; cache duplicate requests and enforce project-level usage limits.
- AI findings are **suggestions**, not verified root causes or auto-applied changes.

### F5. Dashboard alerts & email notifications

**Outcome:** Developers learn about important incidents without alert fatigue.

- In-dashboard alert indicators and email through Resend; Mailpit in local development.
- Trigger alerts for new incidents, critical severity, regressions, and configured occurrence thresholds.
- Apply deduplication and cooldown to suppress repeat notifications.
- Process notifications independently from ingestion; track delivery and bounded retries.
- Allow project-level alert preferences for supported MVP rules.

## 5. Out of scope — explicitly NOT in MVP

- GitHub repository connection, code analysis, security scanning, AI-generated patches, or pull requests.
- Smart Recovery Engine, executing retries in customer systems, automated rollback, or other production changes.
- Business Impact Tracker, inferred affected orders/payments, or business-process correlation.
- Python/Java/PHP SDKs, browser SDK, full distributed tracing/APM product, infrastructure host agents.
- Organization/team accounts, multiple user roles, assignments, enterprise SSO, or billing/subscriptions.
- AI conversational chat, multi-provider AI fallback, advanced alert escalation, Slack/Discord, export/PDF reporting, or custom dashboard builder.
- Customer-facing availability guarantees; load and resilience targets require testing before claims.

**Note:** The HLD may show reserved future extension points. These must not be presented as functioning MVP features.

## 6. User stories & acceptance criteria

| ID | User story | Acceptance criteria (observable) |
|---|---|---|
| US-01 | As a developer, I want to create an account and project so I can start monitoring. | Email verification is required; login creates a secure session; a project appears only to its owner. |
| US-02 | As a developer, I want to connect my Node.js application. | Setup provides an ingestion key and SDK example; a test exception reaches the correct project; invalid/revoked keys are rejected. |
| US-03 | As a developer, I want error reporting not to disrupt my app. | SDK sends bounded async batches, enforces timeouts, supports `flush()`/`shutdown()`, and does not throw transport failures into application execution. |
| US-04 | As a developer, I want repeated errors grouped together. | Similar errors map to the same incident for a given project/environment; truly duplicate event IDs do not increase occurrence count. |
| US-05 | As a developer, I want to inspect an incident. | Detail view shows sanitized message/stack trace, severity, first/last seen, occurrences, environment, release and activity history. |
| US-06 | As a developer, I want to find important errors quickly. | Dashboard provides project-scoped text search, severity/status/environment filters, time ranges, pagination and 24h/7d trends. |
| US-07 | As a developer, I want to manage the incident lifecycle. | User can change severity/status; changes appear in timeline; a matching post-resolution event marks incident `Regressed`. |
| US-08 | As a developer, I want an AI explanation when debugging stalls. | Button queues investigation; states are visible; Gemini result uses the agreed structured schema, evidence and uncertainty; failure does not stop monitoring. |
| US-09 | As a developer, I want to avoid paying for duplicate investigations. | Repeated requests for unchanged evidence reuse an existing result or active job; configured limits reject excess requests gracefully. |
| US-10 | As a developer, I want alerts about significant issues. | New/critical/regressed or threshold incidents produce dashboard indicators and qualifying emails; cooldown prevents repeated emails for the same trigger. |
| US-11 | As a developer, I want to keep projects and sensitive data separate. | Every protected operation checks project ownership; cross-project access is denied; event/AI context excludes configured sensitive fields. |
| US-12 | As a developer, I want to remove a project. | Deleted project becomes inaccessible immediately, ingest keys stop working, and its owned data is scheduled for purge after the approved 7-day grace period. |

## 7. Product and quality constraints

- **Architecture:** One feature-based Next.js App Router frontend; five independently deployable Node.js/Express/TypeScript services (Identity & Projects, Ingestion, Incident, AI Investigation, Notification), plus a thin gateway/BFF. Services own their data and communicate via REST/RabbitMQ.
- **Core stack:** PostgreSQL with `pg` and SQL migrations, RabbitMQ, Redis, Gemini API, Resend, Docker Compose locally; Kubernetes/Helm/Terraform planned for deployment.
- **Security baseline:** HTTPS; secure HttpOnly sessions; project ownership checks; scoped/rotatable keys; validation, size/rate limits, CSRF protection; redaction before storage and AI calls.
- **Reliability:** At-least-once event delivery, idempotent persistence, bounded retries, dead-letter queues, backpressure, and observable failure states.
- **Performance validation target:** 100 events/sec sustained and bursts up to 500 events/sec; these are **test targets, not proven capacity**.
- **Operational data policy:** 30-day event retention; versioned investigations and incident summaries retained under a documented policy; 7-day project deletion grace period.
- **Initial availability posture:** Basic API/worker health checks and operational logs; no contractual uptime SLO in MVP.

Implementation details (full SQL schema, event envelopes, API contracts, deployment configuration, failure recovery algorithms) belong in the **TRD/LLD**, not this scope-lock PRD.

## 8. Release acceptance / definition of done

The MVP is ready for a controlled launch only when:

1. A new developer can complete signup, project creation and SDK onboarding without assistance.
2. Errors from both a demo Node.js API and an existing Node.js application reach the correct project and incident view.
3. Retries and duplicate deliveries do not incorrectly inflate incident counts; RabbitMQ and database failure scenarios are covered by automated integration tests.
4. The approved light-theme dashboard shows accurate incident details, search/filters and trends, with useful empty/error states.
5. On-demand Gemini investigation returns validated, evidence-grounded results and fails gracefully.
6. Resend alerts reach verified test recipients and cooldown prevents repeat spam.
7. Privacy, access isolation, API key revocation, 30-day event retention and project deletion behavior pass tests.
8. Unit, integration, contract and end-to-end tests pass in CI, and performance tests report measured results against the selected targets.

## 9. Scope control

**Locked:** F1–F5 above. Any additional product module requires a separate change request, an explicit priority decision, and an update to this document before implementation.

**Reference documents:** [mvp-plan.md](../planning/mvp-plan.md), [technical-requirements.md](../architecture/technical-requirements.md), and the approved RootTracer HLD v2 whiteboard.
