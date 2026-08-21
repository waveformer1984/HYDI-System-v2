# HEIDI Real Cognitive Cycle Report

**Generated:** 2026-08-21T02:01:50.757Z

**Method:** Production CognitiveCore.runCycle() — same governed path the daemon uses

---

## The Real Prospect

| Field | Value |
|-------|-------|
| Company | Cascade Plumbing & Mechanical |
| ICP Score | 72/100 |
| Industry | contractor |
| Location | Portland, OR |
| Contact | Mike Reynolds |
| Email | mike.reynolds@cascadepm.example.com |
| Source | manual_entry |
| Website | unknown |
| ICP Factors | {"industryFit":90,"businessSize":90,"responseTime":90,"leadCaptureGap":90,"websiteQuality":20,"automationOpportunity":50} |

---

## Cycle 1

### What HEIDI Observed

**System health:** healthy

| Component | Status | Evidence |
|-----------|--------|----------|
| operational_intelligence | unknown | HealthProvenanceChecker.checkAll() → overall state: UNKNOWN |
| database | healthy | SELECT 1 succeeded |
| ollama | healthy | GET /api/tags returned 200 |

**Capabilities:** 42 total, 42 available, 0 unavailable

**World model:** {"total":6,"healthy":0,"degraded":0,"failed":0,"unknown":6,"byType":{"service":{"total":6,"healthy":0,"degraded":0,"failed":0,"unknown":6}}}

### What HEIDI Decided and Why

**Selected action:** `revenue.create_opportunity`

**Capability:** `revenue.create_opportunity`

**Risk level:** R1

**Estimated impact:** operational

**Reasoning:** Goal 7fc30998-c507-48b2-b28d-531d35651e52 (task: Draft personalized outreach for Cascade Plumbing & Mechanical) is highest priority pending work. Selected over 0 alternatives.

**Meta-cognitive assessment:** quality=0.797, classification=good

### Authorization

**Authorized:** true

**Reason:** R1 action — autonomous at current autonomy level

### What HEIDI Executed

**Executed:** true

**Action type:** revenue.create_opportunity

**Outcome:** success

**Details:** revenue.create_opportunity executed

#### Opportunity Created

**Opportunity ID:** opp_1787277576174_26t6io

**Offer:** ai_operations_setup

**Proposed price:** $500.00

**Probability:** 0.59

### Verification

**Verified:** false

**Details:** n/a

### Learning

**Lesson learned:** yes

**Lesson:** Action revenue.create_opportunity executed but verification failed: verification query failed: column "id" does not exist; Meta-cognition identified improvement areas: argumentCoverage

**Memory stored:** yes (mem-1787277576332-aw0egi)

**Outcome classification:** partial_failure

### Cycle Metadata

| Field | Value |
|-------|-------|
| Cycle ID | cycle-1787277552371-1 |
| Duration | 24001ms |
| Final phase | record |
| Errors | none |

---

## Cycle 2

### What HEIDI Observed

**System health:** healthy

| Component | Status | Evidence |
|-----------|--------|----------|
| operational_intelligence | unknown | HealthProvenanceChecker.checkAll() → overall state: UNKNOWN |
| database | healthy | SELECT 1 succeeded |
| ollama | healthy | GET /api/tags returned 200 |

**Capabilities:** 42 total, 42 available, 0 unavailable

**World model:** {"total":6,"healthy":0,"degraded":0,"failed":0,"unknown":6,"byType":{"service":{"total":6,"healthy":0,"degraded":0,"failed":0,"unknown":6}}}

### What HEIDI Decided and Why

**Selected action:** `commercial.prepare_outreach`

**Capability:** `commercial.prepare_outreach`

**Risk level:** R0

**Estimated impact:** operational

**Reasoning:** Goal acbaacbb-80f2-4379-9b81-cbd863ea6baf (task: Prepare outreach draft for Cascade Plumbing & Mechanical) is highest priority pending work. Selected over 0 alternatives.

**Meta-cognitive assessment:** quality=0.797, classification=good

### Authorization

**Authorized:** true

**Reason:** R0 action — autonomous

### What HEIDI Executed

**Executed:** true

**Action type:** commercial.prepare_outreach

**Outcome:** success

**Details:** commercial.prepare_outreach executed

#### Outreach Draft Produced

**Subject:** AI Operations Setup for Cascade Plumbing & Mechanical

**Channel:** email

**Authorization state:** draft

**Proposed value:** $500.00

**Message body:**

> Hi Mike Reynolds,
> 
> I noticed you're in the contractor industry based in Portland, OR. We help businesses like yours set up AI-powered operations that automate routine tasks, improve response times, and reduce manual workload.
> 
> Our AI Operations Setup includes:
> - AI-powered lead capture and qualification
> - Automated customer communication workflows
> - Monitoring and analytics dashboard
> - Integration with your existing tools
> 
> The setup is a one-time fee of $500.00, with an optional monthly service at $0.00/month for ongoing optimization and support.
> 
> Would you be interested in a brief discovery call to see if this is a fit?
> 
> Best regards,
> HEIDI (on behalf of the ProtoForge team)
> 
> ---
> This message was prepared by HEIDI's autonomous outreach system and requires human approval before sending.
> Evidence: ICP Score 72/100, Source: manual_entry

**Evidence used:**

- Known facts: Company: Cascade Plumbing & Mechanical; Industry: contractor; Location: Portland, OR; ICP Score: 72/100; Source: manual_entry; Employees: 10
- Unknown facts (explicitly listed to prevent hallucination): Website: unknown; Specific pain points: not investigated; Technology stack: not analyzed; Current providers: unknown; Prior interactions: none recorded

### Verification

**Verified:** true

**Details:** n/a

### Learning

**Lesson learned:** yes

**Lesson:** Action commercial.prepare_outreach executed and verified successfully; Meta-cognition identified improvement areas: argumentCoverage

**Memory stored:** yes (mem-1787277590542-r9h97x)

**Outcome classification:** success

### Cycle Metadata

| Field | Value |
|-------|-------|
| Cycle ID | cycle-1787277576415-2 |
| Duration | 14144ms |
| Final phase | record |
| Errors | none |

---

## Where Autonomous Execution Stopped and Why

Autonomous execution stopped at the following points:

1. Cycle 1: Verification failed — details unavailable
1. Cycle 2: Outreach draft produced but NOT sent — requires human approval before sending (R2 authorization).
1. Next step (sending the email) is R2 — requires human authorization. HEIDI correctly stopped at draft preparation.

### Bugs Discovered During This Run (noted, not fixed)

1. **`commercial.create_opportunity` bridge bug:** `this.pipeline.getProspect is not a function` — the CommercialWorkflow bridge wraps the workflow but its internal pipeline object doesn't have the `getProspect` method. Routed around by using `revenue.create_opportunity` instead.
2. **Verification query column mismatch:** The verifier for `revenue.create_opportunity` queries `SELECT id FROM revenue_opportunities` but the table uses `opportunity_id`, not `id`. This causes verification to fail even when the opportunity was successfully created.
3. **ModelManager API mismatch:** The ModelManager's public method is `generateResponse(prompt, sessionId)`, not `generate(prompt)`. Routed around by calling Ollama's API directly.

---

## Raw Execution Log

```
[2026-08-21T01:59:11.096Z] === REAL COGNITIVE CYCLE RUN ===
[2026-08-21T01:59:11.098Z] 
[2026-08-21T01:59:11.098Z] STEP 1: Finding real unprocessed prospect data...
[2026-08-21T01:59:11.225Z]   Found prospect: Cascade Plumbing & Mechanical
[2026-08-21T01:59:11.225Z]   ID: prospect_1787277545537_d36tyf
[2026-08-21T01:59:11.225Z]   ICP Score: 72/100
[2026-08-21T01:59:11.225Z]   Industry: contractor
[2026-08-21T01:59:11.225Z]   Location: Portland, OR
[2026-08-21T01:59:11.225Z]   Contact: Mike Reynolds <mike.reynolds@cascadepm.example.com>
[2026-08-21T01:59:11.225Z]   Source: manual_entry
[2026-08-21T01:59:11.225Z]   ICP Factors: {"industryFit":90,"businessSize":90,"responseTime":90,"leadCaptureGap":90,"websiteQuality":20,"automationOpportunity":50}
[2026-08-21T01:59:11.230Z]   No existing opportunity — will need to create one.
[2026-08-21T01:59:11.233Z]   Cleaned up old goals from previous runs.
[2026-08-21T01:59:11.233Z] 
[2026-08-21T01:59:11.233Z] STEP 2: Creating real goal in heidi_goals...
[2026-08-21T01:59:11.240Z]   Created goal: 7fc30998-c507-48b2-b28d-531d35651e52
[2026-08-21T01:59:11.240Z]   Title: Draft personalized outreach for Cascade Plumbing & Mechanical
[2026-08-21T01:59:11.240Z]   Priority: 10 (highest, 1-10 scale)
[2026-08-21T01:59:11.240Z]   Target capability: revenue.create_opportunity
[2026-08-21T01:59:11.241Z] 
[2026-08-21T01:59:11.241Z] STEP 3: Building production CognitiveCore (same as daemon)...
[2026-08-21T01:59:12.368Z]   CognitiveCore built successfully.
[2026-08-21T01:59:12.369Z]   Capabilities: 42 total, 42 available, 0 unavailable
[2026-08-21T01:59:12.369Z]   Available capabilities:
[2026-08-21T01:59:12.369Z]     [R1] undefined: Create a task in the actions table
[2026-08-21T01:59:12.369Z]     [R0] undefined: Fetch data from a readable table
[2026-08-21T01:59:12.369Z]     [R2] undefined: Update a writable table
[2026-08-21T01:59:12.369Z]     [R1] undefined: Schedule a future event in the actions table
[2026-08-21T01:59:12.369Z]     [R2] undefined: Send an email via Resend
[2026-08-21T01:59:12.369Z]     [R1] undefined: Execute governed recovery for a component via OperationalIntelligence
[2026-08-21T01:59:12.369Z]     [R2] undefined: Automatically diagnose and recover all unhealthy components
[2026-08-21T01:59:12.369Z]     [R0] undefined: Produce a diagnostic snapshot of the system
[2026-08-21T01:59:12.369Z]     [R0] undefined: Run a full health check and return overall state
[2026-08-21T01:59:12.369Z]     [R2] undefined: Send a message through the unified CommunicationLayer
[2026-08-21T01:59:12.369Z]     [R0] undefined: List available communication channels and their status
[2026-08-21T01:59:12.369Z]     [R2] undefined: Run one cycle of the revenue control loop (metrics→actions→execute→verify)
[2026-08-21T01:59:12.369Z]     [R0] undefined: Collect current revenue metrics without executing actions
[2026-08-21T01:59:12.369Z]     [R1] undefined: Create a new hierarchical goal
[2026-08-21T01:59:12.369Z]     [R0] undefined: Mark a goal as in_progress and begin working on it
[2026-08-21T01:59:12.369Z]     [R1] undefined: Mark a goal as completed with a result
[2026-08-21T01:59:12.369Z]     [R0] undefined: Sync the world model from runtime sources
[2026-08-21T01:59:12.369Z]     [R0] undefined: Query the world model for entities or health summary
[2026-08-21T01:59:12.369Z]     [R0] undefined: Run a perception cycle without executing actions
[2026-08-21T01:59:12.369Z]     [R0] undefined: Identify a new prospect from company/contact signals
[2026-08-21T01:59:12.369Z]     [R0] undefined: Score a prospect against the ideal customer profile
[2026-08-21T01:59:12.369Z]     [R1] undefined: Update a prospect pipeline status (e.g. qualified, opted_out)
[2026-08-21T01:59:12.369Z]     [R1] undefined: Create a revenue opportunity from a qualified prospect
[2026-08-21T01:59:12.369Z]     [R0] undefined: Collect current prospect pipeline metrics
[2026-08-21T01:59:12.369Z]     [R2] undefined: Start onboarding a new customer
[2026-08-21T01:59:12.369Z]     [R2] undefined: Activate a provisioned customer service
[2026-08-21T01:59:12.369Z]     [R0] undefined: Verify a customer service is operational
[2026-08-21T01:59:12.369Z]     [R0] undefined: Get the total verified revenue amount (never fabricated)
[2026-08-21T01:59:12.370Z]     [R0] undefined: Get a full revenue summary (verified revenue, MRR, events)
[2026-08-21T01:59:12.370Z]     [R0] undefined: Get the current commercial workflow state including discovery, email, and Stripe availability
[2026-08-21T01:59:12.370Z]     [R0] undefined: Discover prospects from external sources (reports BLOCKED if no provider configured)
[2026-08-21T01:59:12.370Z]     [R0] undefined: Ingest a discovered prospect into the pipeline with deduplication and scoring
[2026-08-21T01:59:12.370Z]     [R1] undefined: Create an opportunity for a qualified prospect (requires ICP score >= 50)
[2026-08-21T01:59:12.370Z]     [R0] undefined: Generate an evidence-backed outreach draft (R0 — no hallucination, no sending)
[2026-08-21T01:59:12.370Z]     [R0] undefined: Create an authorization package for R2+ commercial action (requires human approval)
[2026-08-21T01:59:12.370Z]     [R0] undefined: Verify revenue from the authoritative RevenueLedger (never fabricated)
[2026-08-21T01:59:12.370Z]     [R0] undefined: Probe all registered capabilities and return evidence-backed health summary
[2026-08-21T01:59:12.370Z]     [R0] undefined: Probe a single capability by ID and return evidence-backed health report
[2026-08-21T01:59:12.370Z]     [R0] undefined: Return all capabilities currently in READY state with evidence
[2026-08-21T01:59:12.370Z]     [R0] undefined: Classify and resolve blockers for a set of capability health reports
[2026-08-21T01:59:12.370Z]     [R1] undefined: Run governed self-repair loop on a health summary (R0/R1 autonomous, R2+ human)
[2026-08-21T01:59:12.370Z]     [R0] undefined: Return the history of all self-repair actions with rollback info
[2026-08-21T01:59:12.370Z] 
[2026-08-21T01:59:12.370Z] STEP 4: Running core.runCycle() — the real production cognitive cycle...
[2026-08-21T01:59:12.370Z]   (This is the same method the daemon calls every 60s)
[2026-08-21T01:59:12.370Z] 
[2026-08-21T01:59:12.370Z] ── CYCLE 1 ──
[2026-08-21T01:59:36.372Z]   Cycle completed in 24002ms
[2026-08-21T01:59:36.372Z]   Cycle ID: cycle-1787277552371-1
[2026-08-21T01:59:36.372Z]   Final phase: record
[2026-08-21T01:59:36.372Z]   Errors: none
[2026-08-21T01:59:36.372Z]   Selected action: revenue.create_opportunity
[2026-08-21T01:59:36.372Z]   Authorized: true
[2026-08-21T01:59:36.372Z]   Executed: true
[2026-08-21T01:59:36.372Z]   Outcome: success
[2026-08-21T01:59:36.372Z]   → Opportunity created: opp_1787277576174_26t6io
[2026-08-21T01:59:36.398Z] 
[2026-08-21T01:59:36.399Z]   Opportunity exists — creating outreach goal for cycle 2...
[2026-08-21T01:59:36.407Z]   Created outreach goal: acbaacbb-80f2-4379-9b81-cbd863ea6baf
[2026-08-21T01:59:36.414Z] 
[2026-08-21T01:59:36.415Z] ── CYCLE 2 ──
[2026-08-21T01:59:50.559Z]   Cycle completed in 14144ms
[2026-08-21T01:59:50.559Z]   Cycle ID: cycle-1787277576415-2
[2026-08-21T01:59:50.559Z]   Final phase: record
[2026-08-21T01:59:50.559Z]   Errors: none
[2026-08-21T01:59:50.559Z]   Selected action: commercial.prepare_outreach
[2026-08-21T01:59:50.559Z]   Authorized: true
[2026-08-21T01:59:50.559Z]   Executed: true
[2026-08-21T01:59:50.559Z]   Outcome: success
[2026-08-21T01:59:50.559Z]   → Outreach draft produced (subject: AI Operations Setup for Cascade Plumbing & Mechanical)
[2026-08-21T01:59:50.559Z] 
[2026-08-21T01:59:50.559Z] STEP 5: Reporting what actually happened...
[2026-08-21T01:59:50.559Z] 
[2026-08-21T01:59:50.559Z] ── PHASE 1: PERCEIVE ──
[2026-08-21T01:59:50.559Z]   System health: healthy
[2026-08-21T01:59:50.559Z]   Components observed:
[2026-08-21T01:59:50.559Z]     operational_intelligence: unknown (confidence: 1) — HealthProvenanceChecker.checkAll() → overall state: UNKNOWN
[2026-08-21T01:59:50.559Z]     database: healthy (confidence: 1) — SELECT 1 succeeded
[2026-08-21T01:59:50.559Z]     ollama: healthy (confidence: 1) — GET /api/tags returned 200
[2026-08-21T01:59:50.559Z]   Capability summary: 42 total, 42 available, 0 unavailable
[2026-08-21T01:59:50.559Z] 
[2026-08-21T01:59:50.559Z] ── PHASE 2: VALIDATE ──
[2026-08-21T01:59:50.559Z]   Trust classification: {"trustLevel":"trusted_system","inputType":"system_event","actorId":null,"reason":"Input from HEIDI internal component — system trust","canInfluencePolicy":false,"canInfluencePermissions":false,"canInfluenceCredentials":false,"canInfluenceAutonomy":false,"canExecuteActions":true,"canAccessData":true
[2026-08-21T01:59:50.559Z] 
[2026-08-21T01:59:50.560Z] ── PHASE 3-4: UNDERSTAND + UPDATE WORLD MODEL ──
[2026-08-21T01:59:50.560Z]   World model: {"total":6,"healthy":0,"degraded":0,"failed":0,"unknown":6,"byType":{"service":{"total":6,"healthy":0,"degraded":0,"failed":0,"unknown":6}}}
[2026-08-21T01:59:50.560Z] 
[2026-08-21T01:59:50.560Z] ── PHASE 5: RETRIEVE MEMORY + IDENTIFY GOALS ──
[2026-08-21T01:59:50.560Z]   Active missions: 0
[2026-08-21T01:59:50.560Z]   Pending work: 1
[2026-08-21T01:59:50.560Z]     - [10] Prepare outreach draft for Cascade Plumbing & Mechanical (status: pending, goalId: acbaacbb-80f2-4379-9b81-cbd863ea6baf)
[2026-08-21T01:59:50.560Z]       context: {"icpScore":72,"industry":"contractor","location":"Portland, OR","prospectId":"prospect_1787277545537_d36tyf","capabilityId":"commercial.prepare_outreach","prospectName":"Cascade Plumbing & Mechanical","opportunityId":"opp_1787277576174_26t6io","capabilityParams":{"goalId":"acbaacbb-80f2-4379-9b81-c
[2026-08-21T01:59:50.560Z] 
[2026-08-21T01:59:50.560Z] ── PHASE 7: PLAN ──
[2026-08-21T01:59:50.560Z]   Selected action: commercial.prepare_outreach
[2026-08-21T01:59:50.560Z]   Capability: commercial.prepare_outreach
[2026-08-21T01:59:50.560Z]   Description: Advance goal: Prepare outreach draft for Cascade Plumbing & Mechanical
[2026-08-21T01:59:50.560Z]   Risk level: R0
[2026-08-21T01:59:50.560Z]   Estimated impact: operational
[2026-08-21T01:59:50.560Z]   Reasoning: Goal acbaacbb-80f2-4379-9b81-cbd863ea6baf (task: Prepare outreach draft for Cascade Plumbing & Mechanical) is highest priority pending work. Selected over 0 alternatives.
[2026-08-21T01:59:50.560Z]   Params: {"goalId":"acbaacbb-80f2-4379-9b81-cbd863ea6baf","offerId":"ai_operations_setup","prospectId":"prospect_1787277545537_d36tyf","opportunityId":"opp_1787277576174_26t6io","cognitiveCycleId":"pending"}
[2026-08-21T01:59:50.560Z] 
[2026-08-21T01:59:50.560Z] ── PHASE 8: ASSESS RISK/CONFIDENCE ──
[2026-08-21T01:59:50.560Z]   Quality score: 0.7966666666666666
[2026-08-21T01:59:50.560Z]   Classification: good
[2026-08-21T01:59:50.560Z] 
[2026-08-21T01:59:50.560Z] ── PHASE 9: SELECT ──
[2026-08-21T01:59:50.560Z]   Decision: {"finalAction":"commercial.prepare_outreach","winningAuthority":"reasoning","reasoning":"Goal acbaacbb-80f2-4379-9b81-cbd863ea6baf (task: Prepare outreach draft for Cascade Plumbing & Mechanical) is highest priority pending work. Selected over 0 alternatives.","confidence":0.7,"conflictResolution":"
[2026-08-21T01:59:50.560Z] 
[2026-08-21T01:59:50.560Z] ── PHASE 10: AUTHORIZE ──
[2026-08-21T01:59:50.560Z]   Authorized: true
[2026-08-21T01:59:50.560Z]   Reason: R0 action — autonomous
[2026-08-21T01:59:50.560Z]   Risk level: undefined
[2026-08-21T01:59:50.560Z] 
[2026-08-21T01:59:50.560Z] ── PHASE 11: ACT ──
[2026-08-21T01:59:50.560Z]   Executed: true
[2026-08-21T01:59:50.560Z]   Action type: commercial.prepare_outreach
[2026-08-21T01:59:50.560Z]   Capability: commercial.prepare_outreach
[2026-08-21T01:59:50.560Z]   Outcome: success
[2026-08-21T01:59:50.560Z]   Details: commercial.prepare_outreach executed
[2026-08-21T01:59:50.560Z]   Raw result: {"draftId":"draft_1787277590439_dbbcg8","prospectId":"prospect_1787277545537_d36tyf","opportunityId":"opp_1787277576174_26t6io","offerId":"ai_operations_setup","proposedValueCents":50000,"messageChannel":"email","messageSubject":"AI Operations Setup for Cascade Plumbing & Mechanical","messageBody":"Hi Mike Reynolds,\n\nI noticed you're in the contractor industry based in Portland, OR. We help businesses like yours set up AI-powered operations that automate routine tasks, improve response times, and reduce manual workload.\n\nOur AI Operations Setup includes:\n- AI-powered lead capture and qualification\n- Automated customer communication workflows\n- Monitoring and analytics dashboard\n- Integration with your existing tools\n\nThe setup is a one-time fee of $500.00, with an optional monthly service at $0.00/month for ongoing optimization and support.\n\nWould you be interested in a brief discovery call to see if this is a fit?\n\nBest regards,\nHEIDI (on behalf of the ProtoForge team)\
[2026-08-21T01:59:50.560Z]   ... (truncated, full length: 2027)
[2026-08-21T01:59:50.560Z]   Evidence: [{"draftId":"draft_1787277590439_dbbcg8"}]
[2026-08-21T01:59:50.560Z] 
[2026-08-21T01:59:50.560Z] ── PHASE 12: VERIFY ──
[2026-08-21T01:59:50.560Z]   Verified: true
[2026-08-21T01:59:50.560Z]   Verification method: undefined
[2026-08-21T01:59:50.560Z]   Details: undefined
[2026-08-21T01:59:50.560Z] 
[2026-08-21T01:59:50.560Z] ── PHASE 13: LEARN ──
[2026-08-21T01:59:50.560Z]   Lessons learned: {"lessonLearned":true,"lesson":"Action commercial.prepare_outreach executed and verified successfully; Meta-cognition identified improvement areas: argumentCoverage","memoryStored":true,"memoryId":"mem-1787277590542-r9h97x","goalUpdated":true,"outcomeClassification":"success"}
[2026-08-21T01:59:50.560Z] 
[2026-08-21T01:59:50.560Z] ── PHASE 15: REPLAN ──
[2026-08-21T01:59:50.560Z]   No replanning needed.
[2026-08-21T01:59:50.560Z] 
[2026-08-21T01:59:50.560Z] STEP 6: Attempting LLM-based personalized reasoning...
[2026-08-21T01:59:50.560Z]   (Calling Ollama directly — the local model that HEIDI perceives as healthy)
[2026-08-21T01:59:50.573Z]   Available Ollama models: qwen2.5:7b, llama3.2:3b, llama3:latest, nomic-embed-text:latest, llama3.2:latest, tinyllama:latest, qwen2.5-coder:1.5b
[2026-08-21T01:59:50.573Z]   Using model: qwen2.5:7b
[2026-08-21T01:59:50.573Z]   Sending prompt to Ollama...
[2026-08-21T02:01:50.711Z]   LLM not available: The operation was aborted due to timeout
[2026-08-21T02:01:50.721Z]   (Ollama may not be running or may not have a model loaded.)
[2026-08-21T02:01:50.722Z] 
[2026-08-21T02:01:50.722Z] STEP 7: Checking what was actually produced...
[2026-08-21T02:01:50.722Z]   OUTREACH DRAFT PRODUCED:
[2026-08-21T02:01:50.723Z]   ─────────────────────────────
[2026-08-21T02:01:50.723Z]   Subject: AI Operations Setup for Cascade Plumbing & Mechanical
[2026-08-21T02:01:50.723Z]   Channel: email
[2026-08-21T02:01:50.724Z]   Authorization state: draft
[2026-08-21T02:01:50.724Z]   Body:
[2026-08-21T02:01:50.725Z]     Hi Mike Reynolds,
[2026-08-21T02:01:50.725Z]     
[2026-08-21T02:01:50.725Z]     I noticed you're in the contractor industry based in Portland, OR. We help businesses like yours set up AI-powered operations that automate routine tasks, improve response times, and reduce manual workload.
[2026-08-21T02:01:50.725Z]     
[2026-08-21T02:01:50.725Z]     Our AI Operations Setup includes:
[2026-08-21T02:01:50.725Z]     - AI-powered lead capture and qualification
[2026-08-21T02:01:50.725Z]     - Automated customer communication workflows
[2026-08-21T02:01:50.725Z]     - Monitoring and analytics dashboard
[2026-08-21T02:01:50.725Z]     - Integration with your existing tools
[2026-08-21T02:01:50.725Z]     
[2026-08-21T02:01:50.725Z]     The setup is a one-time fee of $500.00, with an optional monthly service at $0.00/month for ongoing optimization and support.
[2026-08-21T02:01:50.726Z]     
[2026-08-21T02:01:50.726Z]     Would you be interested in a brief discovery call to see if this is a fit?
[2026-08-21T02:01:50.727Z]     
[2026-08-21T02:01:50.727Z]     Best regards,
[2026-08-21T02:01:50.727Z]     HEIDI (on behalf of the ProtoForge team)
[2026-08-21T02:01:50.727Z]     
[2026-08-21T02:01:50.727Z]     ---
[2026-08-21T02:01:50.727Z]     This message was prepared by HEIDI's autonomous outreach system and requires human approval before sending.
[2026-08-21T02:01:50.727Z]     Evidence: ICP Score 72/100, Source: manual_entry
[2026-08-21T02:01:50.727Z]   ─────────────────────────────
[2026-08-21T02:01:50.727Z]   OPPORTUNITY CREATED: opp_1787277576174_26t6io
[2026-08-21T02:01:50.727Z] 
[2026-08-21T02:01:50.727Z] Writing report...
```

---

## Before/After: The snake_case/camelCase Fix

This section proves the fix by comparing the outreach draft output before and after the field-mapping fix.

### The Bug

The `commercial.prepare_outreach` capability in `lib/heidi/CognitiveCore.ts` accepted a raw prospect object from the goal context params and passed it directly to `CommercialWorkflow.prepareOutreachDraft()` via `params.prospect as any`. The raw object came from the database with snake_case fields (`company_name`, `icp_score`, `contact_name`), but `OutreachDraftGenerator` expected a typed `ProspectRecord` with camelCase fields (`companyName`, `icpScore`, `contactName`). The `as any` cast silenced the type error, and every field access returned `undefined`.

### The Fix

Instead of patching every call site, the fix was at the bridge layer:

1. **Added `getProspect` and `getOpportunity` to the `ExecutionBridge.revenuePipeline` interface** in `CognitiveCore.ts` (the bridge already had the pipeline, but didn't expose these methods).
2. **Added `getOpportunity` to `ProspectPipeline`** (it already had `getProspect`).
3. **Added both methods to the bridge adapter** in `ExecutionBridgeAdapters.ts`.
4. **Changed `commercial.prepare_outreach` and `commercial.create_authorization_package`** to accept `prospectId`/`opportunityId` and load the records via `pipeline.getProspect()` / `pipeline.getOpportunity()`, which return properly typed `ProspectRecord`/`OpportunityRecord` objects (the `rowToProspect`/`rowToOpportunity` mapping functions handle the snake_case → camelCase conversion).

Also fixed in the same change: `revenue.create_opportunity` now defaults `proposedPrice` and `estimatedValue` from the offer catalog when not explicitly provided, instead of leaving them at 0.

### Before (from the previous run, 2026-08-21T01:39Z)

```
Subject: AI Operations Setup for undefined

Hi undefined team,

I noticed you're in the contractor industry. We help businesses like yours...

The setup is a one-time fee of $500.00, with an optional monthly service at $0.00/month...

Evidence: ICP Score undefined/100, Source: authorized_test
```

| Field | Value |
|-------|-------|
| Subject | `AI Operations Setup for undefined` |
| Greeting | `Hi undefined team,` |
| Location | (omitted — was `undefined`) |
| ICP Score in evidence | `undefined/100` |
| Proposed value | `$NaN` |
| Opportunity `proposed_price` | `0` (cents) |
| Opportunity `estimated_value` | `0` (cents) |
| Opportunity `probability` | `0.00` |

### After (this run, 2026-08-21T02:01Z)

```
Subject: AI Operations Setup for Cascade Plumbing & Mechanical

Hi Mike Reynolds,

I noticed you're in the contractor industry based in Portland, OR. We help businesses like yours...

The setup is a one-time fee of $500.00, with an optional monthly service at $0.00/month...

Evidence: ICP Score 72/100, Source: manual_entry
```

| Field | Value |
|-------|-------|
| Subject | `AI Operations Setup for Cascade Plumbing & Mechanical` |
| Greeting | `Hi Mike Reynolds,` |
| Location | `Portland, OR` (included in body) |
| ICP Score in evidence | `72/100` |
| Proposed value | `$500.00` |
| Opportunity `proposed_price` | `50000` (cents = $500.00) |
| Opportunity `estimated_value` | `50000` (cents = $500.00) |
| Opportunity `probability` | `0.59` (computed from ICP score: 0.3 + 72/100 * 0.4) |

### Files Changed

| File | Change |
|------|--------|
| `lib/revenue/ProspectPipeline.ts` | Added `getOpportunity(opportunityId)` method |
| `lib/heidi/CognitiveCore.ts` | Added `ProspectRecord`/`OpportunityRecord` import; added `getProspect`/`getOpportunity` to bridge interface; added `proposedPrice` to `createOpportunity` interface; rewrote `commercial.prepare_outreach` and `commercial.create_authorization_package` to load by ID; added offer-catalog default price lookup in `revenue.create_opportunity` |
| `lib/heidi/ExecutionBridgeAdapters.ts` | Added `getProspect`/`getOpportunity` to the pipeline bridge adapter |
| `tests/unit/heidi-cognitive-core-qualification.test.ts` | Added `getProspect`/`getOpportunity` mock implementations |
| `scripts/run-real-cognitive-cycle.ts` | Changed goal context to pass `prospectId`/`opportunityId` instead of raw DB row objects |

### Neighbor Check

Checked the obvious neighbors for the same mismatch:

- **`CommercialWorkflow.createOpportunityForProspect`** — already correct. It calls `this.pipeline.getProspect(prospectId)` which returns a properly typed `ProspectRecord`. No fix needed.
- **`InboundResponseHandler`** — receives `ProspectRecord[]` from its caller. Not affected by the same bug since it doesn't accept raw DB rows.
- **`AuthorizationPackage`** — receives `ProspectRecord` from its caller. The bridge fix above (`commercial.create_authorization_package`) now loads via the pipeline, so this is also fixed.
- **`CampaignLoopManager`** — uses `ProspectRecord` from the pipeline. Not affected.

The mismatch was isolated to the two CognitiveCore capability bridges that accepted raw prospect/opportunity objects from goal context params. Both are now fixed.
