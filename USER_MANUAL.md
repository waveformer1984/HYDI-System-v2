# HYDI / Heidi — User Manual

**System:** HYDI System v2 (also known as "Heidi" / "ProtoForge → Kilo Node")
**Version:** v2.0
**Last updated:** 2026-06-17

---

## Table of Contents

1. [What is HYDI?](#1-what-is-hydi)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Getting Started](#3-getting-started)
4. [The Heidi Chat Interface](#4-the-heidi-chat-interface)
5. [Chat Modes](#5-chat-modes)
6. [Working with Agents](#6-working-with-agents)
7. [The Task System](#7-the-task-system)
8. [The Approval Workflow](#8-the-approval-workflow)
9. [Agent Manager](#9-agent-manager)
10. [Funding Pipeline](#10-funding-pipeline)
11. [Revenue & Business Operations](#11-revenue--business-operations)
12. [Rezonate — Music Production](#12-rezonate--music-production)
13. [Waveformer Studio — Artist Management](#13-waveformer-studio--artist-management)
14. [System Monitoring & Health](#14-system-monitoring--health)
15. [Event Traces & Audit Log](#15-event-traces--audit-log)
16. [Memory & Context](#16-memory--context)
17. [Knowledge Base](#17-knowledge-base)
18. [Security & Identity](#18-security--identity)
19. [Troubleshooting](#19-troubleshooting)
20. [Glossary](#20-glossary)

---

## 1. What is HYDI?

HYDI (pronounced "Heidi") is an autonomous business operating system for ProtoForge Industries. It converts your intent into coordinated, automated action across payments, AI agents, content, operations, and multi-cloud infrastructure.

The system has two faces:

| Interface | URL / Port | What it's for |
|-----------|-----------|----------------|
| **HYDI Dashboard** | port 3000 | Main production dashboard — chat, agents, tasks, traces |
| **Heidi Chat Portal** | port 3003 | Enhanced conversational portal — voice, co-pilot, autopilot |

When you talk to Heidi, she understands your intent, routes it to the right subsystem, keeps you informed, and — for actions that matter — asks for your explicit approval before anything executes.

### The Core Principle

Everything flows through a single, immutable truth:

```
You → Heidi (conversation) → HYDI (identity gate) → Ursula (execution) → Ledger (permanent record)
```

Nothing can alter what has already happened. The ledger is append-only and hashed. This means the system is always auditable and every action has a permanent paper trail.

---

## 2. System Architecture Overview

### The Six-Layer Pipeline

Every event — from a chat message to a payment — travels through exactly six layers in order. No layer does another layer's job.

```
┌─────────────────────────────────────────────────────────────────┐
│  [1] INGESTION LAYER   — normalizes structure, no interpretation  │
├─────────────────────────────────────────────────────────────────┤
│  [2] RAW EVENT LEDGER  — append-only, immutable, hashed          │
│                          ← the single source of truth            │
├─────────────────────────────────────────────────────────────────┤
│  [3] CASCADE           — classifies events                       │
│                          outputs: classification, confidence,     │
│                          matched rules                            │
├─────────────────────────────────────────────────────────────────┤
│  [4] KILO              — generates hypotheses only               │
│                          outputs: hypotheses, suggested_fixes     │
│                          ⚠ KILO never executes anything          │
├─────────────────────────────────────────────────────────────────┤
│  [5] ProtoForge        — policy engine                           │
│                          accepts or rejects KILO suggestions     │
├─────────────────────────────────────────────────────────────────┤
│  [6] EMISSION LAYER    — SSE / API / logs, no logic              │
└─────────────────────────────────────────────────────────────────┘
```

A **Replay Engine** runs outside this pipeline and continuously validates that the same input always produces the same output. If it doesn't, that's a real drift event — not a false alarm.

### Startup Safety Windows

When the system starts, two cooldown windows prevent premature alerts:

- **Startup window:** 2 minutes — no enforcement runs
- **Drift observation:** 30 seconds — must observe drift before any alert fires

This prevents false positives during boot.

### Named Subsystems

| Name | Role |
|------|------|
| **Heidi** | Conversational orchestrator — the face you interact with |
| **HYDI / hyID** | Identity authority — gates who can act |
| **Ursula** | Execution engine — writes to the immutable ledger |
| **CASCADE** | Event classifier — classifies only, never acts |
| **KILO** | Hypothesis generator — suggests only, never executes |
| **ProtoForge** | Policy engine — accepts or rejects KILO suggestions |
| **Hyve** | Swarm intelligence — collective opportunity detection |
| **HydiPay** | Payment processing subsystem |

---

## 3. Getting Started

### Launch the Dashboard

The HYDI dashboard runs on port 3000. Open your browser to:

```
http://localhost:3000
```

You'll see the main interface with:
- **Chat panel** (left, 3/4 width) — talk to Heidi here
- **Status panel** (right, 1/4 width) — live system health

### Launch the Enhanced Chat Portal

The Heidi Chat Portal (richer experience with voice, co-pilot, and autopilot) runs on port 3003:

```
http://localhost:3003
```

### First Thing You'll See

When either interface loads, Heidi automatically fetches a **system briefing** — a live snapshot of:

- How many tasks need your approval
- How many tasks are queued or failed
- Current system health
- Your recommended next action

Example briefing:
```
Hi, I'm Heidi. I'm the AI operator for ProtoForge Industries and I'm here to help you
stay on top of everything.

Here's what's happening:
System is healthy. 3 tasks completed today. 1 task needs your attention.

Current status:
✅ 2 active tasks
- 1 task needs your approval
- 0 tasks are queued for execution
- 0 tasks failed

Next thing to handle:
Review pending approval: Deploy billing-retry-worker to production

I'm ready to walk through the approval queue or focus on the highest-priority task.
```

---

## 4. The Heidi Chat Interface

### Sending a Message

Type your message in the text area at the bottom of the screen and press **Enter** (or **Shift+Enter** for a new line). Click the **Send** button or press Enter to submit.

Heidi will:
1. Detect your intent
2. Route the request to the right subsystem or agent
3. Use live tools to retrieve data before answering operational questions
4. Return a response with confidence score, reasoning, and suggested next actions

### Message Anatomy

Each Heidi response includes:

- **Content** — the answer or action summary
- **Confidence** — how certain Heidi is (0.0–1.0)
- **Emotion / Personality** — contextual tone (professional, friendly, energetic, empathetic)
- **Action Items** — suggested next steps
- **Reasoning** — the three-step reasoning chain Heidi followed

### Voice Input

In the Enhanced Chat Portal (port 3003):

1. Click the **microphone** icon in the sidebar
2. Speak your message
3. Heidi transcribes it and sends it automatically

The status bar shows a pulsing red dot while recording. Say "stop" or click the microphone icon again to end recording.

### Voice Output

Toggle voice output with the **Volume** icon in the status bar. When enabled, Heidi's responses are spoken aloud with tone and emotion adapted to the conversation context.

---

## 5. Chat Modes

The Enhanced Chat Portal offers three operating modes. You can switch between them using the buttons in the top navigation bar.

### Chat Mode (default)

Standard conversation. You ask, Heidi answers. Behind the scenes she:
- Retrieves relevant memory context from your session history
- Queries live pipeline health data if you ask operational questions
- Uses tools to pull real numbers (credits, approval counts, stream status)

**Best for:** General questions, status checks, exploring ideas, quick lookups.

### Co-pilot Mode

Activates a side panel that shows analysis in real time alongside the chat. Heidi reviews the conversation and surfaces suggestions, potential risks, and alternative approaches. The co-pilot panel updates with each message exchange.

To enable: click **Enable Co-pilot** in the top bar. The button turns amber when active.

**Best for:** Planning a complex task, reviewing a proposal, working through a decision.

### Autopilot Mode

Heidi executes multi-step goals autonomously. When you describe a goal in autopilot mode, she:
1. Decomposes it into a DAG of sub-tasks (via the `trigger_swarm` tool)
2. Routes each sub-task to the appropriate agent
3. Monitors execution and reports back

> **Important:** Even in autopilot mode, tasks that exceed risk thresholds or require structural changes will pause and ask for your approval before proceeding.

To enable: click **Enable Autopilot** in the top bar. The button turns red/orange when active. Co-pilot and Autopilot are mutually exclusive.

**Best for:** Large goals that span multiple agents, batch operations, end-to-end workflows.

---

## 6. Working with Agents

### Who Can You Talk To?

You always talk to **Heidi** directly. She routes your message to the right subsystem. You can also address subsystems explicitly by naming them in your message.

| Say something like... | Heidi routes to... |
|-----------------------|--------------------|
| "What's the system status?" | **Ursula** |
| "Classify this event…" | **CASCADE** |
| "Generate a hypothesis for this failure" | **KILO** |
| "Run the policy check on…" | **ProtoForge** |
| "Find opportunities in the pipeline" | **Hyve** |
| "Deploy the billing function" | **Infrastructure** |
| "Mix this audio stem" | **Rezonate** |

### Heidi's Built-in Tools

Heidi has six live tools she can call without you asking. When you ask an operational question, she will automatically use the right tool to get real data before answering — never fabricating.

| Tool | What it does |
|------|-------------|
| `check_user_credits` | Returns your current credit balance |
| `get_pipeline_health` | Returns determinism metrics for the last 1h / 24h / 7d |
| `replay_pipeline_event` | Replays a specific event and returns drift analysis |
| `list_pending_approvals` | Lists all tasks waiting for your approval (up to 10) |
| `trigger_swarm` | Decomposes a complex goal into a multi-agent execution DAG |
| `get_stream_status` | Returns live status of the Redis event streams (task-results, task-failures, edge-tasks, edge-results) |

**Example:** Ask "How's the pipeline doing?" and Heidi will call `get_pipeline_health` and report real metrics back to you.

### PAO Business Agents

The Personal AI Orchestration (PAO) subsystem has 15 specialist agents that execute work behind the scenes. Heidi dispatches to them based on your intent.

**Business agents:**

| Agent | What it handles |
|-------|-----------------|
| `revenue_agent` | Revenue opportunities, pricing optimization, financial flow, forecasts |
| `funding_agent` | Grant search, investor outreach, funding opportunities |
| `finance_agent` | Budget tracking, financial reporting |

**Operations agents:**

| Agent | What it handles |
|-------|-----------------|
| `facility_agent` | Facility control, space management |
| `security_agent` | Security monitoring, access control |
| `workflow_agent` | Process automation, workflow design |
| `procurement_agent` | Material sourcing, vendor management |

**Outreach agents:**

| Agent | What it handles |
|-------|-----------------|
| `community_agent` | Community engagement, support |
| `marketing_agent` | Brand development, campaigns |
| `outreach_agent` | Partnership development, relationship management |

**Execution agents:**

| Agent | What it handles |
|-------|-----------------|
| `construction_agent` | Physical construction coordination |
| `fabrication_agent` | Parts fabrication, manufacturing |

**Strategic agents:**

| Agent | What it handles |
|-------|-----------------|
| `ai_agent` | AI system integration and optimization |
| `architect_agent` | System and module design |
| `energy_agent` | Power systems design and energy management |

### How Heidi Routes to Agents

Heidi uses a **task routing matrix** — a map of task types to agents. For example:

| Task keyword | → Agent |
|-------------|---------|
| "budget allocation" | `finance_agent` |
| "find grants" | `funding_agent` |
| "revenue strategy" | `revenue_agent` |
| "source materials" | `procurement_agent` |
| "fabricate parts" | `fabrication_agent` |
| "security monitoring" | `security_agent` |
| "brand development" | `marketing_agent` |
| "design container module" | `architect_agent` |
| "power system design" | `energy_agent` |

---

## 7. The Task System

Every action Heidi proposes becomes a **task**. Tasks flow through a defined lifecycle, giving you visibility and control over everything the system does.

### Task Lifecycle

```
DRAFT → PENDING_APPROVAL → APPROVED → QUEUED → IN_PROGRESS → COMPLETED
                        ↘ REJECTED
                                                            ↘ FAILED → (retry) → COMPLETED
                                                                     ↘ CANCELLED
```

### Task Types

| Type | When it's created |
|------|------------------|
| `chat` | Routine conversation turn |
| `copilot_suggestion` | Co-pilot panel generates a suggestion |
| `autopilot_plan` | Autopilot mode decomposes a goal |
| `ursula_handoff` | Heidi hands work to Ursula for execution |
| `suggestion` | Heidi proposes an action for your review |
| `workflow` | Multi-step workflow execution |
| `proposal` | Formal business proposal |
| `testing` | Test run or validation |
| `system_config` | System configuration change |
| `user_management` | User account or access change |
| `data_deletion` | Data removal request |
| `payment_processing` | Payment or billing action |
| `security_change` | Security-sensitive modification |

### Task Priority

| Priority | What it means |
|----------|--------------|
| `low` | Background work, no urgency |
| `medium` | Normal business activity (default) |
| `high` | Time-sensitive, address soon |
| `urgent` | Drop everything — system or revenue impact |

### Task Fields You'll See

| Field | Description |
|-------|-------------|
| **Title** | Short description of the task |
| **Summary** | Full context and intent |
| **Type** | Category (see above) |
| **Priority** | Urgency level |
| **Confidence** | Heidi's confidence that this is the right action (0–1) |
| **Approval Required** | Whether you need to explicitly approve before execution |
| **Status** | Current state in the lifecycle |
| **Trace ID** | Unique ID for audit trail lookup |
| **Origin Intent** | The original user message that triggered this task |
| **Retry Count** | How many times a failed task has been retried |

### Automatic Approval Rules

Some tasks require approval no matter what. The permission engine enforces:

- Any **legal contract** action → approval required
- Any **structural change** → approval required
- Any action with **cost > $10,000** → approval required
- **Security changes**, **data deletions**, **user management** → approval required

Other tasks may be approved automatically if confidence is high and risk is low.

---

## 8. The Approval Workflow

When a task reaches `PENDING_APPROVAL` status, you need to review it before it can execute.

### How to See Pending Approvals

**Option 1 — Ask Heidi:**
```
"What's waiting for my approval?"
"Show me the approval queue"
"List pending tasks"
```

Heidi will call `list_pending_approvals` and return a list with summaries.

**Option 2 — Dashboard panel:**
The Status Panel on the right side of the main dashboard shows approval counts. Click to drill in.

**Option 3 — Approvals dashboard:**
Navigate to the governance section in the sidebar.

### Approving or Rejecting a Task

#### Via chat:

```
"Approve task [task ID]"
"Reject task [task ID] — reason: [your reason]"
```

#### Via the approval API:

```http
POST /api/tasks/approve
Content-Type: application/json

{
  "taskId": "task_abc123",
  "approve": true,
  "reason": "Reviewed and confirmed — proceed"
}
```

To reject:
```json
{
  "taskId": "task_abc123",
  "approve": false,
  "reason": "Cost exceeds current budget allocation"
}
```

### What Happens After Approval

- Task moves to `QUEUED` then `IN_PROGRESS`
- Execution record is written to the immutable ledger
- You receive a completion confirmation (or a failure alert if it errors)
- The approval decision is permanently logged with timestamp and your identity

### What Happens After Rejection

- Task moves to `REJECTED` / `FAILED`
- The task is not executed — nothing runs
- The rejection reason is stored with the task for audit purposes
- You can create a modified version if needed

### Retrying Failed Tasks

If a task fails (not rejected — genuinely failed during execution), it can be retried:

```http
POST /api/tasks/retry
Content-Type: application/json

{ "taskId": "task_abc123" }
```

Tasks have a max retry limit (default: 3). After that they stay in `FAILED` state for manual review.

---

## 9. Agent Manager

The Agent Manager (navigate to `/agent-manager`) gives you direct control over all agents and tasks without going through chat.

### Three Tabs

#### Agents Tab

Shows all registered agents with their current status, last activity, and available task presets. Click **Dispatch** on any agent card to create a task for that agent directly.

**Available task presets by agent:**

| Agent | Available tasks |
|-------|-----------------|
| heidi | process_message, reflect, summarize_session, switch_model |
| ursula | health_check, generate_report, alert_review |
| cascade | classify_events, run_rules, replay_validation |
| kilo | generate_hypotheses, suggest_fixes, analyze_patterns |
| protoforge | validate_policy, approve_suggestion, audit_actions |
| hyve | detect_opportunities, synthesize_patterns, collective_review |
| rezonate | stem_analysis, mix_analysis, audio_export, nft_mint, rights_verify, session_recall, hardware_map, beat_generate |
| waveformer | artist_onboard, calculate_royalties, distribution_report, rights_audit |

#### Tasks Tab

A live queue of all tasks with status, priority, and creation time. Tasks update in real time. You can:

- View task details
- Approve or reject tasks
- See execution progress for running tasks

#### Rezonate Tab

Quick-dispatch buttons for all Rezonate music production tasks. Each button sends a task to the `rezonate` agent immediately. Dispatch status shows inline.

### Creating a Task Manually

Click **New Task** (top-right on any tab) to open the task creation modal:

1. **Select an agent** — choose from the dropdown (pre-selects if you clicked Dispatch from agent card)
2. **Choose a task preset** — the modal shows available presets for the selected agent
3. **Set priority** — low / medium / high / urgent
4. **Add context** — optional free-text context for the task
5. Click **Create** — task is submitted and appears in the Tasks tab

---

## 10. Funding Pipeline

Navigate to `/funding` to access the Funding Pipeline view.

This page is powered by the `funding_agent` and shows active funding opportunities (grants, investors, partnerships) sorted by urgency. Each funding opportunity card shows:

- Campaign name and source
- Amount available
- Deadline / urgency indicator
- Current status in the funding workflow
- Actions: apply, research, assign to outreach agent

To ask Heidi about funding:
```
"Find new grant opportunities"
"What's the status of our Z-Labs funding?"
"Which funding deadlines are coming up this week?"
```

---

## 11. Revenue & Business Operations

HYDI manages six active revenue streams, each routed through its own Stripe Connect sub-account.

### The Six Revenue Streams

| Stream | Business |
|--------|---------|
| **galactic_bytes** | Galactic Bytes digital products |
| **detailer_bot** | Detailer Bot automation services |
| **lipi_v2** | Lipi v2 content platform |
| **protogrance_aromatics** | Protogrance Aromatics product sales |
| **rezonate** | Rezonate music production platform |
| **waveformer_studio** | Waveformer Studio artist management |

### Fee Structure

Every payment that flows through HYDI is split automatically:

| Fee | Rate |
|-----|------|
| Platform fee | 5.0% |
| Agent fee | 10.0% |
| Stripe processing | 2.9% + $0.30 |
| **Net to you** | ~82.1% − $0.30 |

The full breakdown for every payment is written to the immutable ledger. Nothing is estimated — the split is calculated at the moment of payment and permanently recorded.

### Checking Revenue

Ask Heidi:
```
"Show me revenue for rezonate this week"
"What's the total net for galactic_bytes?"
"How many leads do we have in the pipeline?"
```

Or query the client dashboard directly:
```
GET /api/client-dashboard?project=rezonate
```

Returns a per-project ledger view with full fee breakdown per transaction.

### Revenue Pipeline (CRM)

The revenue pipeline covers leads → quotes → proposals → checkout:

**Leads:** Potential customers in the pipeline
**Quotes:** Pricing proposals generated for leads
**Proposals:** Formal business proposals sent to prospects
**Checkout sessions:** Active Stripe checkout sessions

#### Creating a Quote (via API)

```http
POST /api/revenue
Content-Type: application/json

{
  "action": "create_quote",
  "projectType": "3d_print",
  "quantity": 50,
  "complexity": "high",
  "rushOrder": false,
  "customerEmail": "client@example.com"
}
```

Pricing rules:
- High complexity: ×1.5
- Medium complexity: ×1.2
- Rush order: ×1.3

---

## 12. Rezonate — Music Production

Rezonate is HYDI's music production platform. Access it via:
- **Song Composer page:** `/song-composer`
- **Agent Manager → Rezonate tab**
- **Chat:** "Open Rezonate" or "Help me with audio production"

### What Rezonate Can Do

| Task | Description |
|------|-------------|
| **Stem Analysis** | Separate a mixed track into individual stems (vocals, drums, bass, etc.) and analyze each |
| **Mix Analysis** | Evaluate frequency balance, dynamic range, and EQ of a mix |
| **Audio Export** | Export your session to a specified format (WAV, MP3, FLAC) and destination |
| **Beat Generate** | AI-assisted beat creation from a text prompt or a reference track |
| **NFT Mint** | Tokenize an audio asset on-chain with full metadata |
| **Rights Verify** | Verify the ownership and licensing chain for any asset |
| **Session Recall** | Restore a previous Rezonate session state from the database |
| **Hardware Map** | Detect and map connected hardware controllers (DDJ, MIDI controllers, etc.) |

### Dispatching a Rezonate Task via Chat

```
"Analyze the stems for track ID 42"
"Generate a trap beat — 140 BPM, minor key, heavy bass"
"Export session #7 to WAV at 48kHz"
"Mint audio asset A3F2 as an NFT with title 'Deep Space'"
```

### Rezonate Data

Projects and tracks are stored in the database:
- `rezonate_projects` — project metadata, session state
- `rezonate_tracks` — audio asset metadata, rights information

---

## 13. Waveformer Studio — Artist Management

Waveformer Studio manages artist relationships, royalties, and music distribution. Access via the Agent Manager or via chat.

### What Waveformer Can Do

| Task | Description |
|------|-------------|
| **Artist Onboard** | Register a new artist in the platform with profile, rights, and payment routing |
| **Calculate Royalties** | Compute royalty distributions for an artist based on play counts and contract terms |
| **Distribution Report** | Generate a report of how tracks have been distributed across platforms |
| **Rights Audit** | Full audit of licensing and rights chain for an artist's catalog |

### Dispatching via Chat

```
"Onboard artist: [artist name], email: [email]"
"Calculate royalties for [artist name] for Q1 2026"
"Generate a distribution report for waveformer_studio this month"
"Run a rights audit on [artist name]'s catalog"
```

---

## 14. System Monitoring & Health

### The Status Panel

The right-hand column of the main dashboard shows live system health:
- **System status** (operational / degraded / critical)
- **Active model** (which LLM Heidi is using)
- **Recent actions** (last few events from the action log)
- **Session state** (current session ID and turn count)

### Asking Ursula for a Status Report

Ursula is the system monitor. You can query her through Heidi:

```
"What's the system status?"
"Show me the health report"
"Are there any drift events?"
"How's the pipeline performing?"
```

Ursula reads the `system_dashboard` Supabase view and returns:
- Current status indicator (✅ / ⚠️ / ❌)
- Trend (improving / stable / degrading)
- Key metrics

### Pipeline Health via Tool

Heidi's `get_pipeline_health` tool returns determinism metrics:

```
"Show pipeline health for the last 24 hours"
```

Returns:
- Determinism score (target: ≥ 0.95)
- Events processed
- Classification accuracy
- Drift event count

Any determinism score below 0.95 triggers a proactive alert.

### Proactive Alerts

HYDI monitors the pipeline on a schedule. When it detects:
- Determinism score < 0.95
- Error rate spikes
- Stream backlogs

...it generates a proactive alert and sends it to the operator (you). These appear in the chat if you're online, or are queued for your next session.

### Stream Status

The Redis event streams power real-time task coordination:

| Stream | Purpose |
|--------|---------|
| `task-results` | Completed task outputs |
| `task-failures` | Failed task records |
| `edge-tasks` | Tasks dispatched to Edge Functions |
| `edge-results` | Results from Edge Functions |

Ask Heidi: "What's the stream status?" to get a live snapshot.

### Health Endpoint

```
GET /api/health
```

Returns a JSON health summary including database connectivity, pipeline status, and active task counts. Used by the CI health monitor workflow.

---

## 15. Event Traces & Audit Log

Every event that flows through the pipeline is recorded. You can inspect the trace history for debugging, compliance, or curiosity.

### Accessing Traces

**Via the UI:** Navigate to `/trace-viewer` or `/traces`

The trace viewer shows:
- Event ID
- Event type and classification
- Timestamp
- Determinism score
- Pipeline path (which layers processed it)
- Classification result and confidence

### Replaying an Event

If you want to verify that an event produces the same result today as it did when it first ran:

```
"Replay event [event ID]"
```

Heidi will call `replay_pipeline_event` and return a drift analysis comparing the original output to the replayed output. If they match, the system is deterministic. If they differ, that's a genuine drift event.

### Via API

```http
POST /api/audit/replay
Content-Type: application/json

{ "eventId": "evt_abc123" }
```

---

## 16. Memory & Context

Heidi remembers things across your conversation and across sessions.

### How Memory Works

Every conversation turn is stored as a memory entity with:
- **Summary** — the first 150 characters of what you said
- **Content** — the full turn (your message + Heidi's response)
- **Scope** — `user`, `project`, `task`, `preference`, or `business_rule`
- **Embedding** — vector representation for semantic search
- **Access count** — how many times this memory has been retrieved

When you send a message, Heidi:
1. Generates a semantic embedding of your message
2. Searches memory for the top 3 most similar past entries (similarity ≥ 0.7)
3. Includes that context in her thinking before responding

This means if you discussed a specific project yesterday, Heidi can connect today's question to that prior context without you re-explaining.

### Memory Limits

- Maximum 50 memory entities per user
- Memories older than 7 days are automatically consolidated by a scheduled job
- Consolidation groups related memories into a single summary entry

### Memory Scopes

| Scope | Used for |
|-------|---------|
| `user` | Personal preferences, communication style |
| `project` | Information tied to a specific project |
| `task` | Task context and history |
| `preference` | Explicit preferences you've expressed |
| `business_rule` | Rules or constraints you've established |

---

## 17. Knowledge Base

The Knowledge Base gives Heidi access to documents, policies, and reference material you've uploaded.

### Enabling Knowledge Base Mode

In the Enhanced Chat Portal, click **Enable KB** in the top navigation bar. The button turns purple when active.

With KB mode on, Heidi searches the knowledge base before responding to questions, allowing her to cite specific documents.

### Searching the Knowledge Base

```
GET /api/kb/search?q=your+search+term
```

Or via chat:
```
"Search the knowledge base for payment processing policies"
"What does our pricing guide say about rush orders?"
```

---

## 18. Security & Identity

### How Identity Works

Your identity is established when you send requests. The system currently supports two methods (JWT is preferred and more secure):

| Method | How | Security level |
|--------|-----|----------------|
| **JWT Bearer token** | `Authorization: Bearer <token>` header | Cryptographically verified ✅ |
| **x-user-id header** | `x-user-id: your-user-id` header | Not verified ⚠️ (legacy) |

If you are connecting via the UI, your identity is managed automatically through the session. If you are calling APIs directly, use JWT Bearer tokens.

### Secret Handling

**Never paste, display, or share secrets.** The system enforces this rule explicitly. If you need to rotate a key:

```bash
# Generate and inject directly — never print the value
node -e "require('crypto').randomBytes(32).toString('hex')" | vercel env add SECRET_NAME

# Verify it exists without revealing it
vercel env ls | grep SECRET_NAME
```

### Approval as a Security Gate

Before any of the following actions execute, you must explicitly approve them:
- Legal contracts
- Structural changes to the system
- Any action with a value > $10,000
- Security configuration changes
- User management changes
- Data deletion

This is enforced at the task creation layer — the task cannot enter the execution queue without your approval on file.

### Audit Trail

Every action — including approvals, rejections, and retries — is permanently written to the immutable ledger with:
- Timestamp
- Actor identity
- Action taken
- Reason (if provided)
- Trace ID

This cannot be altered or deleted.

---

## 19. Troubleshooting

### Heidi returns "I couldn't generate a response"

The system fell back to a generic response. Causes:
- LLM API key not configured (`ANTHROPIC_API_KEY`)
- Request timed out
- Rate limit hit

**Fix:** Check the status panel for model health. Ask Heidi "What model are you using?" to confirm the active LLM. If API is down, the system will use local model fallback if configured.

### Task stuck in PENDING_APPROVAL

Tasks requiring human approval will not move forward until you approve them.

**Fix:** Ask Heidi "What's waiting for approval?" or navigate to the approval queue in the Agent Manager.

### Task stuck in QUEUED

The execution worker may not be processing the queue.

**Fix:** Check stream status: "What's the stream status?" A backlog in `task-results` or `edge-tasks` indicates a processing bottleneck. Check the `agent-worker` and `jobs-processor` edge functions.

### "Determinism drift detected" alert

The Replay Engine detected that replaying an event produced a different result than the original run. This is a genuine issue, not a false alarm.

**Fix:** Do not ignore drift alerts. Check:
1. Ask CASCADE to classify the affected event again
2. Ask KILO for a hypothesis: "KILO, generate a hypothesis for this drift"
3. Review the trace in `/trace-viewer` for the affected event ID

### Pipeline health score below 0.95

A determinism score below 0.95 means at least 5% of events are producing inconsistent results.

**Fix:** Ask Heidi "Show me drift events from the last 24 hours" to identify which event types are drifting. Common causes: schema changes that weren't fully migrated, rule changes in CASCADE without corresponding ledger updates.

### Payment not appearing in ledger

A payment completed in Stripe but isn't in the HYDI ledger.

**Fix:** Check the `stripe-connect-webhook` edge function logs. The webhook may have failed to fire or may have timed out. The `billing-retry-worker` runs on a schedule and will re-attempt failed ledger writes. You can also trigger a manual sync via Heidi: "Sync Stripe payments for [revenue stream]."

### Heidi doesn't remember a previous conversation

Memory retrieval is based on semantic similarity. If the similarity score is below 0.7, the past context won't be surfaced.

**Fix:** Be more specific in your question to increase similarity to the prior turn. You can also explicitly tell Heidi: "Remember that we discussed [topic] and [key point]" to anchor it as a new memory entry.

### Agent manager shows no agents

The agent registry may not be populated.

**Fix:** Check the `agent-worker` edge function status. Agent registration happens at startup. If the registry is empty, restart the system.

---

## 20. Glossary

| Term | Definition |
|------|-----------|
| **HYDI** | The system — also the identity authority subsystem (hyID) |
| **Heidi** | The conversational AI interface and orchestrator |
| **Ursula** | The execution engine that writes to the immutable ledger |
| **CASCADE** | The event classification layer — assigns classification + confidence |
| **KILO** | The hypothesis generation layer — suggests fixes, never executes |
| **ProtoForge** | The policy engine — accepts or rejects KILO suggestions |
| **Hyve** | The swarm intelligence / opportunity collective subsystem |
| **RAW EVENT LEDGER** | The append-only, cryptographically hashed record of all events |
| **Determinism score** | How consistently the pipeline produces the same output for the same input (target ≥ 0.95) |
| **Drift** | When replaying an event produces a different result — indicates a real system change |
| **Swarm** | A DAG of coordinated sub-tasks executed by multiple agents in parallel |
| **PAO** | Personal AI Orchestration — the 15-agent specialist subsystem |
| **DAG** | Directed Acyclic Graph — a set of tasks where some depend on others |
| **Edge Function** | A Deno-based Supabase serverless function (42 total) |
| **Revenue stream** | One of 6 business lines, each with its own Stripe Connect sub-account |
| **Trace ID** | The unique identifier for a single request's journey through the pipeline |
| **Startup window** | The 2-minute period after boot where enforcement is suspended |
| **Drift observation window** | The 30-second observation period before a drift alert fires |
| **Briefing** | The live system snapshot Heidi loads when you open the interface |
| **Confidence** | A 0.0–1.0 score representing how certain the system is about a classification or action |
| **Approval gate** | The point in the task lifecycle where human review is required |
| **Immutable ledger** | The database table that records all financial and execution events and can never be modified |
| **Replay Engine** | The component that validates pipeline determinism by re-running events |
| **co-pilot mode** | A mode where Heidi provides analysis and suggestions in a side panel |
| **autopilot mode** | A mode where Heidi autonomously executes multi-step goals via agent swarms |

---

*This manual covers HYDI System v2. For operator and deployment documentation, see `HEIDI-DEPLOYMENT-GUIDE.md`, `HEIDI_PRODUCTION_README.md`, and `ON_CALL_RUNBOOK.md` in this repository.*
