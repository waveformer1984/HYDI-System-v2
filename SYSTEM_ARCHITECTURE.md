# System Architecture

## 1) Edge Functions Inventory

### Current Count

The Supabase project currently has **68 ACTIVE Edge Functions**.

### Grouped List

#### Core Orchestration & Governance (17)

- core-dispatcher
- core-agent-heartbeat
- core-recovery-worker
- core-operator-api
- worker-orchestrator
- governed-execute
- publish-event
- claim-work
- submit-approval-decision
- emit-risk-alert
- keymaker-router
- tool-executor
- action-worker
- events-stream
- jobs-processor
- monitoring-health
- api-gateway

#### HYDI / HEIDI Intelligence Layer (17)

- hydi-transition
- hydi-reflect
- hydi-heartbeat
- hydi-repair
- hydi-boot
- hydi-alignment-audit
- hydi-outcome-ingest
- hydi-memory
- theme-calibration
- heidi-reflect
- heidi-ingest-event
- heidi-orchestrator
- chaos-runner
- run-followups
- send-outreach
- chat-operator
- toby-llm

#### Billing / Revenue / Stripe (17)

- stripe-setup
- stripe-webhook
- stripe-worker
- stripe-connect-webhook
- stripe-connect-admin
- stripe-transfer-payout
- stripe-webhook-revenue
- sync-stripe-events
- monthly-payout-calculation
- revenue-tracker
- billing-engine
- billing-retry-worker
- usage-monitor
- invoice-generator
- subscription-manager
- payment-processor
- payment-processing

#### Platform / Application Services (6)

- user-management
- notification-service
- analytics-service
- file-storage
- search-service
- cache-service

#### Marketing / Growth Services (8)

- marketing-automation
- lead-generation
- content-management
- email-marketing
- social-media
- customer-segments
- campaign-analytics
- brand-awareness

#### Ops / Safety Utilities (3)

- keeper
- keeper-break-glass
- keeper-break-glass-simple

---

## 2) Frontend

### `pages/`

Route-level screens and page composition.

- Defines route boundaries and page-level data requirements
- Coordinates auth gating and role-aware access
- Handles SSR/CSR strategy where applicable
- Owns page-specific loading/error/empty states

### `components/`

Reusable UI and domain components.

- Shared visual primitives and composed business components
- Strict prop interfaces to maintain predictability
- Accessibility-first patterns (labels, keyboard nav, semantic markup)
- Isolated rendering logic with minimal side effects

### `hooks/`

Reusable behavior and data access logic.

- Encapsulates Supabase read/write/query flows
- Centralizes caching, retries, optimistic updates
- Normalizes error handling and telemetry hooks
- Keeps page/component layers thin and declarative

---

## 3) Revenue Engine (`revenue-engine/`)

### Purpose

Central module for monetization workflows, billing state transitions, and financial observability.

### Responsibilities

- Subscription lifecycle management (trial, active, grace, canceled)
- Stripe event ingestion and reconciliation
- Invoice and payout orchestration
- Failed payment recovery and retry logic
- Revenue analytics signal generation (MRR, churn, ARPU)

### Internal Capabilities

- Idempotent webhook/event processing
- Scheduled and event-driven billing jobs
- Audit trail generation for financial actions
- Consistency checks between local state and Stripe state

### Operational Concerns

- Replay-safe processing for webhook retries
- Dead-letter handling for unrecoverable billing errors
- Alerting on payout/invoice anomalies
- Metrics on conversion and retention funnels

---

## 4) KILO Module (`kilo/`)

### Purpose

Execution-focused module for deterministic workflow handling and controlled task progression.

### Responsibilities

- Ingests normalized task/intent payloads
- Routes requests to proper execution pipelines
- Enforces execution contracts and output validation
- Emits structured outcomes/events for downstream systems

### Implementation Details

- Contract-first interfaces for inputs/outputs
- Pipeline stages with explicit status transitions
- Built-in idempotency and deduplication controls
- Retry boundaries with exponential backoff policy

### Observability

- Structured logs (correlation id, actor id, task id)
- Stage-level duration and success/failure metrics
- Alert rules for repeated stage failures and timeouts

---

## 5) Hyve Service (`hyve_service/`)

### Purpose

Service boundary for inter-module communication and high-throughput event handling.

### Responsibilities

- Provides stable service APIs for internal consumers
- Publishes/subscribes to system event streams
- Applies auth/authorization checks to service operations
- Manages resilient integration with dependent modules

### Interface Model

- Synchronous API paths for immediate operations
- Asynchronous event paths for decoupled workflows
- Versioned contracts to avoid breaking consumers

### Reliability Model

- Backpressure-aware queue consumption
- Retry + circuit-breaker patterns on external dependencies
- Health endpoints and heartbeat telemetry
- SLO-driven latency and error budget tracking

---

## 6) PAO System (Expanded)

### `core/`

Core runtime and orchestration layer.

- Scheduler, dispatcher, policy gatekeeper
- Global state transitions and coordination logic
- Priority management and conflict resolution
- Safety rails and emergency stop pathways

### `services/`

Domain service implementations.

- Business operations services
- Execution handlers and task runners
- Read-model/query services for operators
- Service-level validation and normalization

### `integrations/`

External/internal connectors.

- Stripe, email, CRM, webhook integrations
- Adapter pattern for provider interchangeability
- Retry and reconciliation logic per connector
- Contract conformance checks and fallback behavior

### `schemas/`

Canonical data contracts.

- Event schemas and command payload definitions
- Validation strategy and version negotiation
- Migration policy for schema evolution
- Shared type generation for frontend/backend parity

### `knowledge/`

Memory and reasoning support layer.

- Persistent context and decision traces
- Retrieval and ranking for prior outcomes
- Governance constraints on memory writes/reads
- Knowledge lifecycle (retain, summarize, expire)

---

## 7) PAO Agents (15 Total)

### Business

1. Revenue Strategist
2. Pricing Analyst
3. Growth Planner

### Operations

4. Workflow Orchestrator
5. Reliability Monitor
6. Compliance Controller

### Outreach

7. Lead Scout
8. Campaign Operator
9. Follow-up Coordinator

### Execution

10. Task Dispatcher
11. Tool Executor
12. QA Verifier

### Strategic

13. Opportunity Mapper
14. Risk Forecaster
15. Executive Synthesizer
