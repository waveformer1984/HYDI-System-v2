# Stage 2: Supervisor Chain Investigation Report
Generated: 2026-09-10

## Executive Summary

The entire `supervisor.js → services-manifest.json → hydi-core.js` chain is **DORMANT-LEGACY**. None of these components are currently running or referenced by active processes. The chain appears to be legacy architecture superseded by the canonical boot-agent system.

---

## 1. Supervision Topology

```
PM2
  └── boot-agent [DORMANT - not currently running under PM2]
      ├── canonical services [LIVE - running via direct boot-agent execution]
      └── poller [LIVE - job-executor-poller]

watchdog [DORMANT - PM2 daemon not running]
heidi-daemon [DORMANT - PM2 daemon not running]
supervisor.js [DORMANT-LEGACY - no active launcher]
hydi-core.js (repo root) [DORMANT-LEGACY - no active launcher]
hydi-core/ subdirectory [LIVE - separate project on port 3459]
memory-engine.js (repo root) [DORMANT-LEGACY - no active launcher]
```

---

## 2. Dependency Evidence

### supervisor.js

**Static Configuration Declarations:**
- services-manifest.json line 132: "Use supervisor.js --dry-run to see startup plan without launching"
- Documentation references: SESSION_SUMMARY.md, HYDI_GENESIS_*.md, QUICKSTART.md (all non-functional docs)

**Live Runtime Dependencies:**
- ❌ No package.json script references supervisor.js
- ❌ No currently active process imports supervisor.js
- ❌ No boot.config.json module references supervisor.js
- ❌ No scheduled task runs supervisor.js
- ❌ Port 9999 (supervisor status endpoint) is NOT listening

**Classification:** DORMANT-LEGACY

---

### services-manifest.json

**Static Configuration Declarations:**
- Declares 7 services: memory-engine (9998), hydi-core (9997), docker-stack (5000), heidi-bridge (5050), next-app (3000), heidi-mobile (3006), forge-loop (null)
- Marks memory-engine and hydi-core as "required": true
- Notes line 127: "Services with 'required': true will fail startup if they don't come up"

**Live Runtime Dependencies:**
- ❌ No currently active process reads services-manifest.json
- ❌ boot.config.json does NOT reference services-manifest.json
- ❌ Port 9998 (memory-engine) is NOT listening
- ❌ Port 9997 (hydi-core) is NOT listening
- Port 3000 (next-app) IS listening - but via boot-agent, NOT supervisor
- Port 3006 (heidi-mobile) IS listening - but via boot-agent, NOT supervisor

**Classification:** DORMANT-LEGACY

---

### hydi-core.js (repo root)

**Static Configuration Declarations:**
- services-manifest.json line 25-38: declares hydi-core as required service on port 9997
- Depends on memory-engine (port 9998)
- Health check: http://localhost:9997/health

**Live Runtime Dependencies:**
- ❌ Port 9997 is NOT listening
- ❌ No currently active process runs hydi-core.js
- ❌ No active consumer calls http://localhost:9997/health
- ❌ No active process depends on port 9997

**Ambiguity Resolution:**
- Port 3459 IS listening (PID 14196, running server.js)
- This is a DIFFERENT process from hydi-core.js in the repo root
- Port 3459 belongs to the heidi-core/ subdirectory (separate npm project with own package.json)
- 36 files reference port 3459, all pointing to the heidi-core/ subdirectory, not the repo-root hydi-core.js

**Classification:** DORMANT-LEGACY

---

### memory-engine.js (repo root)

**Static Configuration Declarations:**
- services-manifest.json line 10-24: declares memory-engine as required service on port 9998
- No dependencies
- Health check: http://localhost:9998/health

**Live Runtime Dependencies:**
- ❌ Port 9998 is NOT listening
- ❌ No currently active process runs memory-engine.js
- ❌ No active consumer calls http://localhost:9998/health
- ❌ No active process depends on port 9998

**Classification:** DORMANT-LEGACY

---

### hydi-core/ subdirectory (separate project)

**Static Configuration Declarations:**
- .ports.json: declares port 3459
- heidi-core/server.js line 64: defaults to port 3459
- Multiple scripts and tests reference http://localhost:3459

**Live Runtime Dependencies:**
- ✅ Port 3459 IS listening (PID 14196)
- ✅ Process running: node server.js (from heidi-core/ subdirectory)
- ✅ Multiple static references (tests, adapters, mobile chat)
- ❌ NOT referenced by boot.config.json
- ❌ NOT referenced by supervisor.js or services-manifest.json

**Classification:** LIVE but ISOLATED - not integrated with canonical boot system

---

## 3. Active Process Analysis

### Currently Running Processes (from boot-agent execution)
- protoforge-core (port 3005) - via boot.config.json
- heidi-web (port 3000) - via boot.config.json
- heidi-mobile-chat (port 3006) - via boot.config.json
- job-executor-poller - via boot.config.json
- hydi-orchestrator - DISABLED in boot.config.json (enabled: false)

### Boot Chain
```
Direct execution: node scripts/boot-agent.js
  → Reads boot.config.json
  → Starts enabled modules in dependency order
  → Does NOT read services-manifest.json
  → Does NOT use supervisor.js
```

### Scheduled Task
```
Task: "HYDI Boot Agent" (Ready state, not currently running)
Command: C:\Users\Owner\HYDI-System-v2\scripts\run-boot.cmd
Wrapper: cd to repo, run node scripts\boot-agent.js
```

---

## 4. Port Status

| Port | Expected Service | Status | Process |
|------|------------------|--------|---------|
| 3000 | heidi-web | LISTENING | boot-agent (next dev) |
| 3005 | protoforge-core | LISTENING | boot-agent (src/server.js) |
| 3006 | heidi-mobile-chat | LISTENING | boot-agent (launch-heidi-mobile.js) |
| 3459 | heidi-core/ subdirectory | LISTENING | separate project (heidi-core/server.js) |
| 5000 | docker-stack (Ursula) | NOT LISTENING | - |
| 5050 | heidi-bridge | NOT LISTENING | - |
| 9997 | hydi-core.js (repo root) | NOT LISTENING | - |
| 9998 | memory-engine.js (repo root) | NOT LISTENING | - |
| 9999 | supervisor.js status | NOT LISTENING | - |

---

## 5. Failing Unit Test Analysis

### Test: operational-no-false-greens.test.ts
**Line 61-73:** "reports UNKNOWN (not HEALTHY) for in-process modules with no independent check"

```typescript
it('reports UNKNOWN (not HEALTHY) for in-process modules with no independent check', async () => {
  const { healthChecker, model } = createSystem();
  await healthChecker.checkAll();

  // In-process modules (type: 'module') should be UNKNOWN, not HEALTHY
  const hydiState = model.getState('hydi-orchestrator');
  // hydi-orchestrator is an in-process module — it can't be checked independently
  expect(['UNKNOWN', 'HEALTHY']).toContain(hydiState.state);
  if (hydiState.state === 'UNKNOWN') {
    const hasSkipEvidence = hydiState.evidence.some((e) => e.check === 'in-process');
    expect(hasSkipEvidence).toBe(true);
  }
}, 60000);
```

### Root Cause
1. test expects 'hydi-orchestrator' to exist in the dependency graph
2. DependencyGraphBuilder.ts line 61: `if (mod.enabled === false) continue;`
3. boot.config.json line 60: hydi-orchestrator has `"enabled": false`
4. Result: hydi-orchestrator is NOT included in the graph
5. model.getState('hydi-orchestrator') returns undefined (or default state)
6. Test fails because the expected node doesn't exist

### Test Semantic Intent
The test validates a valid semantic: **in-process modules with no independent health check should report UNKNOWN, not HEALTHY**. This is a "no false greens" guarantee.

### Problem
There is no ENABLED in-process module in the current boot.config.json to test this semantic against. The only in-process module (hydi-orchestrator) is disabled.

### Proposed Fix
Option 1: Add a minimal test fixture in boot.config.json (temporarily enabled for this test only)
Option 2: Mock an in-process module in the test setup
Option 3: Skip the test if no enabled in-process module exists (less ideal)

Recommendation: Option 2 - create a minimal isolated fixture in the test to validate the UNKNOWN semantic without modifying production configuration.

---

## 6. Retirement Recommendation

### Minimum Safe Retirement Sequence

1. **Remove static references** (documentation only, no functional impact):
   - Update SESSION_SUMMARY.md to mark supervisor.js as legacy
   - Update HYDI_GENESIS_*.md to reference boot-agent instead of supervisor.js
   - Add DEPRECATED.md documenting the supervisor.js retirement

2. **Archive dormant files** (no functional impact):
   - Move supervisor.js to archive/supervisor.js.legacy
   - Move services-manifest.json to archive/services-manifest.json.legacy
   - Move hydi-core.js (repo root) to archive/hydi-core.js.legacy
   - Move memory-engine.js to archive/memory-engine.js.legacy

3. **Update unit test** (functional impact):
   - Fix operational-no-false-greens.test.ts to use a mock in-process module
   - Verify test passes

4. **Clean up heidi-core/ subdirectory** (separate decision):
   - The heidi-core/ subdirectory on port 3459 is a LIVE but ISOLATED system
   - Not referenced by boot.config.json
   - Appears to be a separate development/experimental project
   - Requires separate decision on whether to integrate or archive

### Safety Verification
- ✅ No active process depends on supervisor.js
- ✅ No active process depends on services-manifest.json
- ✅ No active process depends on repo-root hydi-core.js (port 9997)
- ✅ No active process depends on repo-root memory-engine.js (port 9998)
- ✅ Ports 9997, 9998, 9999 are not used by active components
- ✅ Canonical boot system (boot-agent + boot.config.json) is independent
- ✅ Scheduled task runs boot-agent, not supervisor.js

### Blocking Conditions
- ❌ None identified. The chain is safe to retire.

---

## 7. Final Classification

| Component | Classification | Evidence |
|-----------|----------------|----------|
| supervisor.js | DORMANT-LEGACY | No active launcher, no port usage, only documentation references |
| services-manifest.json | DORMANT-LEGACY | No active reader, only referenced by supervisor.js |
| hydi-core.js (repo root) | DORMANT-LEGACY | Port 9997 not listening, no active consumer |
| memory-engine.js (repo root) | DORMANT-LEGACY | Port 9998 not listening, no active consumer |
| heidi-core/ subdirectory | LIVE-ISOLATED | Port 3459 listening, separate project, not integrated with boot system |

---

## 8. Hard Stop Conditions - None Met

- ❌ supervisor.js is NOT actively launched by anything
- ❌ hydi-core.js (repo root) has NO live consumer
- ❌ Port 9997/9998 is NOT used by an active component
- ❌ Retiring the chain would NOT alter a live route or service
- ❌ The intended semantics of the failing test CAN be established confidently

---

## 9. Conclusion

The entire `supervisor.js → services-manifest.json → hydi-core.js (repo root) → memory-engine.js (repo root)` chain is **legacy architecture** that has been superseded by the canonical boot-agent system. No active processes depend on it, and retiring it is safe.

The heidi-core/ subdirectory (port 3459) is a separate, isolated system that requires a separate decision.

The failing unit test has a valid semantic intent but lacks an enabled in-process module to test against. It can be fixed with a minimal mock fixture without modifying production configuration.
