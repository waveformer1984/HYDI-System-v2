# ProtoForge System Architecture - Full SITREP
**Classification:** INTERNAL // HYDI Operations  
**Date:** 2026-04-24  
**System Version:** v2.0-CASCADE  

---

## 1. EXECUTIVE SUMMARY

ProtoForge is a multi-agent AI orchestration platform with deterministic truth enforcement, cascading event processing, and hardware-automated infrastructure management. The system implements a "no silent success" philosophy with integrity firewalls, evolution protocols, and Prime Directive enforcement.

---

## 2. SYSTEM ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL INTERFACES                                    │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Stripe     │  │   Vercel    │  │   Supabase  │  │  Dashboard  │             │
│  │  Webhooks   │  │   Deploy    │  │   Database  │  │   (NextJS)  │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                │                    │
└─────────┼────────────────┼────────────────┼────────────────┼────────────────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         API GATEWAY LAYER (Express)                                 │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                         KEYMAKER MIDDLEWARE                                  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│  │  │ Token Valid │  │   Routing   │  │  Permission │  │   Audit     │     │   │
│  │  │    ation    │  │   Engine    │  │    Check    │  │    Log      │     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘     │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                     │                                               │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                      BUS GATEKEEPER MIDDLEWARE                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                       │   │
│  │  │ Subscription│  │   Rate Limit │  │   Tier      │                       │   │
│  │  │    Check    │  │   Enforcer   │  │  Routing    │                       │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                       │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                     CORE EVENT PROCESSING (CASCADE v2)                               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│   │   INTAKE     │───▶│  VALIDATION  │───▶│ CLASSIFICATION│───▶│   EMISSION   │   │
│   │    LAYER     │    │   LAYER      │    │    LAYER      │    │    LAYER     │   │
│   └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘   │
│          │                    │                    │                    │           │
│          ▼                    ▼                    ▼                    ▼           │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│   │ • Schema Lock│    │ • Integrity  │    │ • Hard Class │    │ • Routing    │   │
│   │ • Fingerprint│    │   Firewall   │    │   ification  │    │ • Dead Letter│   │
│   │ • Event Log  │    │ • Quarantine │    │ • Confidence │    │ • Broadcast  │   │
│   └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘   │
│                                                                                      │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │                    PROTOFORGE EVENT BUS                                   │   │
│   │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐     │   │
│   │  │  HEIDI  │  │  KILO   │  │  URSULA │  │  HYVE   │  │  CASCADE│     │   │
│   │  │Events   │  │ Analysis│  │  SSE    │  │Validator│  │  Core   │     │   │
│   │  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘     │   │
│   └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    UNIVERSAL AGENT BUS (Messaging Backbone)                          │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   ┌────────────────────────────────────────────────────────────────────────────┐    │
│   │                         MESSAGE FORMAT                                     │    │
│   │  id, version, timestamp, origin, target, action, payload, identity{},     │    │
│   │  priority, ttl, sessionId, tags, retryCount, chainId, chainStep            │    │
│   └────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                      │
│   ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐    │
│   │   PRIORITY LANES    │  │   MODEL REGISTRY    │  │   FAIRNESS ENGINE   │    │
│   │  ┌───┬───┬───┬───┐  │  │  ┌───────────────┐  │  │  ┌───────────────┐  │    │
│   │  │ENT│PRO│STR│SYS│  │  │  │ gpt-4-local   │  │  │  │ Enterprise    │  │    │
│   │  │ 3 │ 2 │ 1 │ 0 │  │  │  │ gpt-35-turbo  │  │  │  │ Threshold: 5  │  │    │
│   │  └───┴───┴───┴───┘  │  │  │ local-llama   │  │  │  │ Standard Gap  │  │    │
│   │                     │  │  │ code-specialist│  │  │  │ Monitor       │  │    │
│   │  ENTERPRISE=3       │  │  │ (13 models)   │  │  │  └───────────────┘  │    │
│   │  PRO=2              │  │  └───────────────┘  │  └─────────────────────┘    │
│   │  STARTER=1          │  │                     │                             │
│   │  SYSTEM=0           │  │  Heartbeat Monitor  │                             │
│   └─────────────────────┘  │  Backup Routing     │                             │
│                            │  Auto-Failover      │                             │
│                            └─────────────────────┘                             │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         AGENT ECOSYSTEM (13 Entities)                               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │     HEIDI       │  │      KILO       │  │     URSULA      │  │    HYVE     │ │
│  │                 │  │                 │  │                 │  │             │ │
│  │ Contextual      │  │ Truth Filter    │  │ Service Bundle  │  │ Validation  │ │
│  │ Conscience      │  │ Analysis Engine │  │ Orchestrator    │  │ Gate        │ │
│  │                 │  │                 │  │                 │  │             │ │
│  │ • Value Leak    │  │ • Hypothesis    │  │ • Chat Portal   │  │ • Integrity │ │
│  │   Detection     │  │   Engine        │  │ • SSE Stream    │  │   Firewall  │ │
│  │ • Monetization  │  │ • Repair        │  │ • Subscription  │  │ • Truth     │ │
│  │   Opportunities │  │   Manifest      │  │   Manager       │  │   Enforcer  │ │
│  │ • Proof of Work │  │ • Analysis      │  │ • Model Router  │  │ • Cascade   │ │
│  │   Certification │  │   Pipeline      │  │ • Revenue       │  │   Core      │ │
│  │ • Violation Risk│  │                 │  │   Outreach      │  │             │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  └──────┬──────┘ │
│           │                    │                    │                  │        │
│           ▼                    ▼                    ▼                  │        │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                    ENFORCEMENT & SAFETY LAYER                                │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │ │
│  │  │  Readiness  │  │ No Silent   │  │   System    │  │   CASCADE   │     │ │
│  │  │    Gate     │  │   Success   │  │   Contract  │  │  Quarantine │     │ │
│  │  │             │  │  Enforcer   │  │    Guard    │  │             │     │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘     │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                    │
└─────────────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                    INFRASTRUCTURE LAYER (ProtoForge Body)                            │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   ┌─────────────────────────┐      ┌─────────────────────────────────────────┐   │
│   │   Supabase Backend      │      │         HARDWARE AUTOMATION             │   │
│   │  ┌─────────────────┐    │      │  ┌─────────────┐    ┌────────────────┐ │   │
│   │  │  PostgreSQL     │    │      │  │  USB HID    │    │  Screen Vision │ │   │
│   │  │  Database       │◄───┼──────┼──┤  Controller │◄───┤  + OCR Engine  │ │   │
│   │  └─────────────────┘    │      │  └─────────────┘    └────────────────┘ │   │
│   │  ┌─────────────────┐    │      │         │                              │   │
│   │  │  Edge Functions │    │      │         ▼                              │   │
│   │  │  • stripe-webhook│◄───┼──────┼──┐ ┌────────────────────────────┐   │   │
│   │  │  • keymaker-router│   │      │  │ │    Safety Orchestrator     │   │   │
│   │  │  • agent-worker   │   │      │  │ │                            │   │   │
│   │  └─────────────────┘    │      │  │ │ • Execution Contracts      │   │   │
│   │  ┌─────────────────┐    │      │  │ │ • State Snapshots        │   │   │
│   │  │  Auth / RLS      │    │      │  │ │ • Vision Confidence      │   │   │
│   │  │  Realtime        │    │      │  │ │ • Kill Switch            │   │   │
│   │  │  Storage         │    │      │  │ │ • Human Confirmation     │   │   │
│   │  └─────────────────┘    │      │  │ └────────────────────────────┘   │   │
│   └─────────────────────────┘      │  │                                  │   │
│                                    │  │  Stripe/Vercel Navigators      │   │
│   ┌─────────────────────────┐      │  │  • Webhook Setup Automation    │   │
│   │   Local Model Stack     │      │  │  • Dashboard Interaction       │   │
│   │  ┌─────────────────┐    │      │  └────────────────────────────────┘   │
│   │  │  gpt-4-local    │    │      └─────────────────────────────────────────┘   │
│   │  │  local-llama    │    │                                                  │
│   │  │  code-specialist│    │                                                  │
│   │  │  (13 models)    │    │                                                  │
│   │  └─────────────────┘    │                                                  │
│   └─────────────────────────┘                                                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. ENTITY DEEP DIVE

### 3.1 HEIDI - Contextual Conscience
**Purpose:** Business intelligence and monetization opportunity detection  
**Core Functions:**
- `detectValueLeak()` - Identifies revenue leaks ($/month impact)
- `findMonetizationOpportunities()` - Surfaces conversion opportunities
- `certifyProofOfWork()` - Validates work artifacts with quality scores
- `assessViolationRisk()` - Predicts compliance violations with confidence scores
- `generateRevenueOutreach()` - Automated customer communication

**Events:** `high_violation_risk`, `proof_of_work_created`, `value_leak_detected`, `monetization_opportunities`

---

### 3.2 KILO - Truth Filter Engine  
**Purpose:** Deterministic analysis and repair validation  
**Core Functions:**
- `analyzeHypothesis()` - Multi-dimensional truth scoring
- `validateRepairManifest()` - Pre-execution repair validation
- `runTruthFilterGate()` - Blocks false-positive repairs
- `detectCircularDependencies()` - Prevents infinite repair loops

**Confidence Threshold:** 0.92 (configurable)

---

### 3.3 URSULA - Service Bundle Orchestrator
**Purpose:** Customer-facing service management and subscription control  
**Core Functions:**
- `manageSubscriptions()` - Tier-based access control
- `routeChatRequests()` - AI chat portal with SSE streaming
- `automateRevenueOutreach()` - Customer lifecycle management
- `monitorServiceHealth()` - Real-time status dashboards

**Service Tiers:** STARTER ($49), PRO ($149), ENTERPRISE ($499)

---

### 3.4 HYVE - Validation Gate
**Purpose:** Event integrity and schema enforcement  
**Core Functions:**
- `eventIntegrityFirewall.validate()` - Schema lock + fingerprinting
- `cascadeClassifier.hardClassify()` - Confidence-weighted classification
- `quarantineEvents()` - Isolates anomalous events
- `triggerEvolutionProtocol()` - Schema drift detection

**Pipeline Stages:** Intake → Validation → Classification → Emission

---

### 3.5 CASCADE - Event Processing Core
**Purpose:** Deterministic event flow with guaranteed delivery  
**Core Functions:**
- `processEvent()` - 5-stage pipeline processing
- `createFingerprint()` - Unique event identification
- `acquireSchemaLock()` - Prevents concurrent mutations
- `emitWithRetry()` - Dead letter queue for failures

**Retry Policy:** 3 attempts, exponential backoff, 30s TTL

---

### 3.6 Universal Agent Bus
**Purpose:** Central messaging backbone with no data loss  
**Core Functions:**
- `publish()` - Pub/sub message distribution
- `request()` - Synchronous request/response
- `registerModel()` - Local model lifecycle management
- `startHeartbeatMonitor()` - Health monitoring with auto-failover

**Priorities:** ENTERPRISE(3) → PRO(2) → STARTER(1) → SYSTEM(0)

---

### 3.7 Keymaker
**Purpose:** Access control, routing, and permission management  
**Core Functions:**
- `validateToken()` - JWT/API key validation
- `routeRequest()` - Dynamic service routing
- `checkPermission()` - Tier-based access enforcement
- `auditLog()` - Immutable access logging

**Header:** `x-keymaker-key`

---

### 3.8 Safety Orchestrator (Hardware Agent)
**Purpose:** Physical automation with enforcement boundaries  
**Core Functions:**
- `enforceExecutionContract()` - api_only / hid_allowed / hid_required
- `captureStateSnapshot()` - Pre-action system state capture
- `verifyVisionConfidence()` - OCR confidence ≥ 0.92
- `checkKillSwitch()` - File-based + DB flag abort
- `requestHumanConfirmation()` - Type "EXECUTE" to proceed

**Kill Switch:** `C:\tmp\STOP_HID` (Windows) or `/tmp/STOP_HID` (Linux)

---

## 4. DATABASE SCHEMA (Supabase)

### 4.1 Core Tables

```sql
-- Events & Jobs
public.events           - Event ingestion queue
public.jobs             - Job processing queue
public.keymaker_events  - Audit trail (if exists)
public.webhook_events   - Stripe webhook payloads

-- Service Bundle
public.subscriptions    - Customer subscriptions
public.service_usage    - Metered usage tracking
public.pricing_tiers    - Tier configuration

-- CASCADE
public.cascade_events   - Processed events
public.quarantine       - Rejected events
public.dead_letters     - Failed retries

-- System Health
public.system_health    - Component health scores
public.pending_tasks    - In-flight message recovery
public.health_snapshots - Historical health data

-- RLS Policies
All tables have row-level security by customer_id
```

---

## 5. EDGE FUNCTIONS (Supabase)

| Function | Purpose | Auth |
|----------|---------|------|
| `stripe-webhook` | Stripe event ingestion | `verify_jwt=false` |
| `keymaker-router` | Token validation & routing | `verify_jwt=true` |
| `agent-worker` | Job claiming & execution | `verify_jwt=true` |

---

## 6. API ENDPOINTS

### 6.1 Core Endpoints
```
GET    /health              - System health check
GET    /integrity           - Integrity score + violations
GET    /evolution           - Schema evolution status
POST   /api/services/*      - Service bundle (gated)
GET    /api/ursula/status   - SSE stream for real-time updates
POST   /api/webhooks/stripe - Stripe webhook (via Edge Function)
```

### 6.2 Service Bundle Endpoints
```
POST   /api/services/chat        - AI chat (requires subscription)
POST   /api/services/analyze     - Code analysis
POST   /api/services/generate    - Content generation
GET    /api/services/subscription - Subscription status
```

---

## 7. ENFORCEMENT LAYERS

### 7.1 No Silent Success Enforcer
- **Rule:** All operations must emit telemetry
- **Violation:** Silent failures trigger alerts
- **Action:** Auto-retry with escalation

### 7.2 Readiness Gate
- **Check:** Database connection, model availability, quota status
- **Block:** Requests until system ready
- **Timeout:** 30s max wait

### 7.3 System Contract Guard
- **Contract:** Explicit service level agreements
- **Violation:** Contract breach detection
- **Action:** Circuit breaker activation

### 7.4 CASCADE Quarantine
- **Trigger:** Integrity violation detected
- **Action:** Event isolation + Heidi audit
- **Recovery:** Manual review + replay

---

## 8. OBSERVABILITY

### 8.1 Metrics
```
system_integrity_score      [0.0 - 1.0]
events_processed_per_minute  [count]
model_latency_ms            [histogram]
violation_events_count      [counter]
schema_drift_alerts         [counter]
```

### 8.2 Dashboards
- **Ursula Dashboard:** `/ursula-dashboard.html`
- **Revenue Dashboard:** `/revenue-dashboard.html`
- **Health Monitor:** Real-time SSE stream

---

## 9. CURRENT STATUS

| Component | Status | Notes |
|-----------|--------|-------|
| ProtoForge Event Bus | ✅ Operational | v2.1 |
| Universal Agent Bus | ✅ Operational | 13 models registered |
| CASCADE v2 | ✅ Operational | Schema locked |
| Keymaker | ✅ Deployed | JWT auth active |
| Stripe Webhook | ⚠️ Testing | Async signature fix applied |
| HID Agent | 🟡 Standby | Kill switch armed |
| Safety Orchestrator | 🟡 Ready | Awaiting credentials |
| Supabase DB | ✅ Connected | RLS enforced |
| Edge Functions | ✅ Deployed | 3 functions active |

---

## 10. SECURITY POSTURE

- **Authentication:** Keymaker JWT + API keys
- **Authorization:** RLS policies by customer_id
- **Encryption:** TLS 1.3, AES-256 at rest
- **Audit:** Immutable event logs in keymaker_events
- **Hardware:** USB HID with kill switch + human confirmation

---

## 11. OPERATIONAL NOTES

### 11.1 Stripe Webhook Fix
**Issue:** `constructEvent()` fails in Deno sync context  
**Fix:** Use `constructEventAsync()`  
**Status:** Deployed, awaiting test event verification

### 11.2 HID Agent Readiness
**Status:** Safety orchestrator complete  
**Next Step:** User must edit `webhook_task_hid.json` with credentials  
**Kill Switch:** Create `C:\tmp\STOP_HID` to abort anytime

---

## 12. CONTACT & ESCALATION

- **Primary:** Ursula (Service Bundle)
- **Escalation:** HEIDI (Business Intelligence)
- **Emergency:** KILO (Truth Filter)
- **Infrastructure:** ProtoForge Infrastructure Module

---

**END SITREP**
