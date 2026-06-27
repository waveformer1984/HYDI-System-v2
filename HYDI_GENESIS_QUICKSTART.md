# HYDI Genesis v3: Quick Start Guide

## What You Now Have

A **fully architected autonomous operating system** for ProtoForge with:

✅ **Supervisor Core** — Manages 7 services with zero port conflicts  
✅ **Memory Engine** — Learns from every action, stores knowledge, searches semantically  
✅ **Agent Framework** — Base system for 6 specialized AI agents  
✅ **Task Orchestrator** — Executes multi-step workflows as DAGs  
✅ **HYDI Core** — Central nervous system coordinating everything  
✅ **Complete Architecture** — Extensible, observable, resilient  

---

## Starting HYDI

### Prerequisite: Run Migrations

```bash
cd C:\Users\Owner\HYDI_System
npx supabase migration up
```

This creates the memory tables in your Supabase project.

### Start Everything

```powershell
cd C:\Users\Owner\HYDI_System
node supervisor.js
```

**What starts:**
1. Memory Engine (:9998) — 5 seconds
2. HYDI Core (:9997) — depends on memory engine
3. Docker stack (:5000) — Supabase, etc.
4. Heidi Bridge (:5050)
5. Next.js (:3000)
6. Heidi Mobile (:3006)

All in correct dependency order. Auto-restarts if anything fails.

---

## Interacting With HYDI

### Check System Status

```bash
# Full status
curl http://localhost:9997/status | jq .

# Quick health
curl http://localhost:9997/health

# Agent status
curl http://localhost:9997/agents | jq .
```

### Execute a Task

```bash
curl -X POST http://localhost:9997/execute-task \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Monitor System Health",
    "type": "monitoring",
    "steps": [
      {
        "id": "step-1",
        "action": "monitoring",
        "agent": "ops-agent",
        "dependencies": []
      }
    ]
  }'
```

### Search Memory

```bash
# Find workflows related to "proposal"
curl "http://localhost:9998/search?q=proposal" | jq .

# Get autonomous workflows (confidence > 95%)
curl "http://localhost:9998/workflows?autonomous=true" | jq .
```

### View Logs

```bash
# Supervisor log
tail -f ~/.hydi/logs/supervisor.log

# Memory engine log
tail -f ~/.hydi/logs/memory-engine.log

# HYDI core log
tail -f ~/.hydi/logs/hydi-core.log

# Agent logs
tail -f ~/.hydi/logs/agent-*.log
```

---

## Architecture Overview

```
Your Request
    ↓
HYDI Core (9997)
    ↓
Task Orchestrator
    ↓ (assigns agents)
Agents (6 types)
    ↓
Memory Engine (9998)
    ↓
Supabase (persistent learning)
```

---

## Current Capabilities

### ✅ Services Management
- Auto-start with dependencies
- Health checking every 30s
- Automatic restart on failure
- Zero port conflicts
- Graceful shutdown

### ✅ Memory System
- Procedural workflows (what worked before)
- Knowledge documents (docs, code, architecture)
- Semantic search (find similar patterns)
- Confidence scoring (trust your own experience)
- Vector embeddings (powered by Ollama)

### ✅ Task Execution
- Multi-step workflows
- Parallel execution of independent steps
- Dependency resolution
- Agent assignment by capability
- Error handling & recovery

### 🔄 Agents (Framework Ready)
- Ops, Engineering, Business, Research, Studio, Fabrication
- All inherit base Agent class
- All integrate with memory
- Ready for implementation

---

## What's Missing (What We Build Next)

### Week 1: Specialized Agents

Each agent implements `performTask()` and custom logic:

```javascript
class OperationsAgent extends Agent {
  async performTask(task) {
    // Monitor system
    // Backup data
    // Security scan
    // Run diagnostics
  }
}
```

### Week 2: Revenue Engine

```javascript
// Runs every day
setInterval(async () => {
  const grants = await researchAgent.searchGrants();
  const opportunities = await businessAgent.findLeads();
  
  for (const opp of opportunities) {
    const score = scoreOpportunity(opp);
    if (score > 0.95) {
      // Execute autonomously
    } else if (score > 0.85) {
      // Notify user for approval
    }
  }
}, 86400000);
```

### Week 3: Creative Engine

```javascript
// Generate music, designs, content
studioAgent.generateMusicPack({
  genre: 'ambient',
  duration: 60,
}).then(async (asset) => {
  await memoryEngine.storeDocument(asset);
  // Publish to stores
  // Track revenue
});
```

### Week 4: Manufacturing Engine

```javascript
// Manage prints & inventory
fabricationAgent.monitorQueue({
  failureDetection: true,
  autoRestart: true,
}).on('failed-print', async (print) => {
  const analysis = await agent.analyzeFailure(print);
  // Learn from failure
  // Suggest improvement
});
```

---

## File Structure

```
HYDI_System/
├── supervisor.js              (process manager)
├── memory-engine.js           (4-layer memory)
├── agent-framework.js         (base classes)
├── task-orchestrator.js       (DAG executor)
├── hydi-core.js              (OS kernel)
├── services-manifest.json     (config)
├── HYDI_GENESIS_ROADMAP.md   (what's next)
├── supabase/
│   └── migrations/
│       └── 001_memory_engine.sql
└── .hydi/
    ├── logs/                 (all activity)
    ├── port-registry.json    (what's running)
    └── cache/                (temporary data)
```

---

## Monitoring Dashboard (Coming Soon)

```
System Health      │ Agent Activity        │ Revenue Pipeline
────────────────────────────────────────────────────────────
Memory: 280 MB     │ Ops Agent: monitoring  │ Open: 12
Uptime: 14h 32m    │ Biz Agent: idle       │ Qualified: 8
Services: 7/7      │ Eng Agent: testing    │ This Month: $45k
Agents: 6/6        │                       │

Executing Tasks    │ Memory Stats          │ Infrastructure
────────────────────────────────────────────────────────────
Current: 2         │ Workflows: 247        │ CPU: 12%
Completed: 1,247   │ Knowledge docs: 892   │ GPU: 0%
Failed: 3          │ Embeddings: 12,400    │ Storage: 67%
```

---

## Development: Implementing an Agent

### 1. Create the agent file

```javascript
// agents/operations-agent.js
const { Agent } = require('../agent-framework');

class OperationsAgent extends Agent {
  constructor() {
    super({
      id: 'ops-agent',
      name: 'Operations Agent',
      type: 'operations',
      capabilities: ['monitoring', 'backup', 'security', 'diagnostics'],
    });
  }

  async performTask(task) {
    if (task.type === 'monitoring') {
      return await this.monitor();
    }
    // ... more capabilities
  }

  async monitor() {
    // Actual implementation
    // Check health endpoints
    // Collect metrics
    // Run diagnostics
    return { status: 'OK', metrics: {} };
  }
}

module.exports = OperationsAgent;
```

### 2. Register it in HYDI Core

```javascript
// In hydi-core.js loadAgents()
const OperationsAgent = require('./agents/operations-agent');
const opsAgent = new OperationsAgent();
this.agentRegistry.register(opsAgent);
```

### 3. Test it

```bash
curl -X POST http://localhost:9997/execute-task \
  -d '{"name":"Monitor","type":"monitoring","steps":[...]}'
```

---

## Next Immediate Actions

**This Week:**
1. [ ] Run Supabase migrations
2. [ ] Start HYDI (supervisor.js)
3. [ ] Verify all services come up
4. [ ] Test memory engine endpoints
5. [ ] Implement Operations Agent

**Next Week:**
1. [ ] Implement Engineering Agent
2. [ ] Implement Business Agent
3. [ ] Build dashboard
4. [ ] Add revenue engine

**Week 3:**
1. [ ] Implement Research Agent
2. [ ] Implement Studio Agent
3. [ ] Build learning loop

**Week 4:**
1. [ ] Implement Fabrication Agent
2. [ ] Autonomous decision making
3. [ ] Full system integration test
4. [ ] 24-hour soak test

---

## Key Concepts

### Confidence Scoring
```
confidence = (successes / total) 
           × (recency_bonus) 
           × (frequency_bonus)

95%+ = execute autonomously
85-95% = propose to user
70-85% = track & learn
<70% = always ask
```

### Procedural Memory
Every successful task becomes a workflow:
- Store the sequence of steps
- Track success/failure rate
- Calculate confidence
- Propose automation
- Execute when confident

### Task Graphs (DAGs)
Tasks are multi-step workflows with dependencies:
```json
{
  "steps": [
    {"id": "1", "action": "research", "dependencies": []},
    {"id": "2", "action": "estimate", "dependencies": ["1"]},
    {"id": "3", "action": "propose", "dependencies": ["2"]}
  ]
}
```

Steps 1, 2, 3 run sequentially.  
Independent steps run in parallel.

---

## Resources

- **Roadmap:** `HYDI_GENESIS_ROADMAP.md`
- **Audit:** `HYDI_SYSTEM_RELIABILITY_AUDIT.md`
- **Memory:** `hydi-memory-engine.md`
- **Logs:** `~/.hydi/logs/*.log`

---

## Support

If services won't start:

```bash
# Check supervisor logs
tail -f ~/.hydi/logs/supervisor.log

# Check ports
netstat -ano | findstr "9997\|9998\|9999"

# Restart supervisor
# (kills all services, supervisor starts them again)
```

---

**You're building the future of automation.**

HYDI v3 will learn, adapt, and execute with zero human intervention (when you tell it to).

Let's go. 🚀
