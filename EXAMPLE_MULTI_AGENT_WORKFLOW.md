# Multi-Agent Workflow Examples

This document shows practical examples of multi-agent orchestration in HYDI Genesis v3.

---

## Example 1: Complete Product Launch Workflow

**Scenario:** Launch a new 3D-printed product line

**Workflow Execution:**

```javascript
const launchWorkflow = {
  name: "Product Launch - 3D Printed Item",
  type: "multi-step-orchestration",
  steps: [
    // Design Phase
    {
      id: "design-cad",
      agent: "fab-agent",
      action: "cad-design",
      inputs: {
        type: "product-housing",
        dimensions: { x: 150, y: 100, z: 75 },
        material: "PLA"
      },
      dependencies: []
    },
    
    // Validation Phase
    {
      id: "design-validation",
      agent: "fab-agent",
      action: "slicing",
      inputs: {
        file: "design.stl",
        slicer: "Cura"
      },
      depends_on: ["design-cad"]
    },
    
    // Code Phase - Documentation
    {
      id: "code-review",
      agent: "eng-agent",
      action: "code-review",
      inputs: {
        scope: "product-docs"
      },
      depends_on: ["design-validation"]
    },
    
    // Testing
    {
      id: "test-spec",
      agent: "eng-agent",
      action: "testing",
      inputs: {
        type: "all"
      },
      depends_on: ["code-review"]
    },
    
    // Sales Materials - Proposal
    {
      id: "generate-proposal",
      agent: "biz-agent",
      action: "proposals",
      inputs: {
        client: "Sample Customer",
        value: 25000
      },
      depends_on: ["test-spec"]
    },
    
    // Research - Market Analysis
    {
      id: "research-market",
      agent: "res-agent",
      action: "tech-monitoring",
      inputs: {
        topics: ["3D printing", "product design"]
      },
      depends_on: ["design-validation"] // Can run in parallel
    },
    
    // Marketing Materials - Generated Audio/Video
    {
      id: "generate-music",
      agent: "studio-agent",
      action: "music-generation",
      inputs: {
        genre: "electronic",
        mood: "professional",
        duration_seconds: 30
      },
      depends_on: ["test-spec"]
    },
    
    // Final Deployment
    {
      id: "deploy-to-production",
      agent: "eng-agent",
      action: "deployment",
      inputs: {
        environment: "production",
        strategy: "canary"
      },
      depends_on: ["generate-proposal", "generate-music", "research-market"]
    }
  ]
};

// Execute workflow
const result = await hydi.executeTask(launchWorkflow);

// Result structure:
{
  success: true,
  taskId: "workflow-launch-prod-1719432300000",
  duration: 18543, // ms
  result: {
    steps_completed: 8,
    steps_failed: 0,
    parallel_tasks_saved: "2h 45m",
    artifacts: {
      "design-cad": "design-1719432300000.stl",
      "design-validation": "print-1719432301000.gcode",
      "generate-proposal": "proposal-1719432302000.pdf",
      "generate-music": "marketing-1719432303000.mp3"
    },
    confidence_scores: {
      overall: 0.92,
      by_agent: {
        "fab-agent": 0.88,
        "eng-agent": 0.94,
        "biz-agent": 0.89,
        "res-agent": 0.91,
        "studio-agent": 0.95
      }
    }
  }
}
```

**Timeline Comparison:**
- Sequential execution: ~8 hours (8 tasks × 1h avg)
- Parallel execution: ~2 hours (3 parallel tracks with dependencies)
- **Time saved:** 75%

---

## Example 2: Daily Operations Routine

**Scenario:** Fully automated daily checks and reporting

```javascript
const dailyOperationsSchedule = [
  // Every 30 minutes: System health
  {
    frequency: "every 30 minutes",
    task: {
      name: "System Health Check",
      agent: "ops-agent",
      action: "monitoring",
      inputs: {}
    },
    autonomy_threshold: 0.95, // Execute if confidence > 95%
    alert_threshold: { memory: 0.9, disk: 0.85, cpu: 8.0 }
  },
  
  // Every 6 hours: Security scan
  {
    frequency: "every 6 hours",
    task: {
      name: "Security Audit",
      agent: "ops-agent",
      action: "security",
      inputs: { scope: "all" }
    },
    autonomy_threshold: 0.90,
    notify_on: ["CRITICAL", "HIGH"]
  },
  
  // Daily: Full backup
  {
    frequency: "daily at 11 PM",
    task: {
      name: "Daily Backup",
      agent: "ops-agent",
      action: "backup",
      inputs: { target: "all" }
    },
    autonomy_threshold: 0.99,
    verify_completion: true
  },
  
  // Daily: Code quality report
  {
    frequency: "daily at 6 AM",
    task: {
      name: "Code Quality Report",
      agent: "eng-agent",
      action: "code-review",
      inputs: { scope: "all-branches" }
    },
    autonomy_threshold: 0.85,
    generate_report: true
  },
  
  // Bi-weekly: Revenue analysis
  {
    frequency: "every 2 weeks on Monday",
    task: {
      name: "Revenue Analysis",
      agent: "biz-agent",
      action: "revenue-tracking",
      inputs: { period: "last-2-weeks" }
    },
    autonomy_threshold: 0.80,
    actions_on_decline: [
      { action: "notify-ceo", if: "revenue-down-10%" },
      { action: "score-leads", if: "true" }
    ]
  },
  
  // Weekly: Research updates
  {
    frequency: "every Friday at 9 AM",
    task: {
      name: "Weekly Research Briefing",
      agent: "res-agent",
      action: "tech-monitoring",
      inputs: { topics: ["AI", "3D printing", "automation"] }
    },
    autonomy_threshold: 0.75,
    format_as: "executive-summary"
  }
];

// With task orchestrator managing all scheduling
// HYDI automatically executes tasks per schedule
// and applies confidence thresholds for autonomy
```

---

## Example 3: Manufacturing Workflow - Design to Print

```javascript
const manufacturingWorkflow = {
  name: "Print and Produce",
  steps: [
    // 1. Design phase (Fabrication Agent)
    {
      id: "design",
      agent: "fab-agent",
      action: "cad-design",
      inputs: {
        type: "mechanical-bracket",
        dimensions: { x: 80, y: 60, z: 40 },
        material: "PETG",
        infill: 15
      },
      expects: { weight: 45, print_time: 3.5 }
    },
    
    // 2. Slice and validate (Fabrication Agent)
    {
      id: "slice",
      agent: "fab-agent",
      action: "slicing",
      inputs: {
        file: "output from design",
        slicer: "Cura",
        layer_height: 0.2,
        speed: 60
      },
      depends_on: ["design"]
    },
    
    // 3. Inventory check (Fabrication Agent)
    {
      id: "inventory-check",
      agent: "fab-agent",
      action: "inventory",
      inputs: {}
    },
    
    // 4. Print management (Fabrication Agent)
    {
      id: "start-print",
      agent: "fab-agent",
      action: "print-management",
      inputs: {
        action: "start",
        file: "output from slice",
        printer: "Prusa i3 MK3S+"
      },
      depends_on: ["slice", "inventory-check"],
      monitor: { interval: 30000, duration: 3.5 * 60 * 60 * 1000 }
    },
    
    // 5. Quality documentation
    {
      id: "quality-docs",
      agent: "eng-agent",
      action: "code-review",
      inputs: {
        scope: "manufacturing-specs"
      },
      depends_on: ["design"]
    },
    
    // 6. Parts catalog update
    {
      id: "update-catalog",
      agent: "biz-agent",
      action: "crm",
      inputs: {
        action: "update-inventory"
      },
      depends_on: ["start-print"] // After print completes
    }
  ]
};

// Orchestrator handles:
// - Parallel execution (design + docs + inventory check)
// - Long-running tasks (print monitoring for 3.5 hours)
// - Conditional execution (inventory check before print)
// - Result merging (all outputs combined)
```

---

## Example 4: Research & Development Sprint

```javascript
const rdSprintWorkflow = {
  name: "2-Week R&D Sprint",
  phases: [
    // Phase 1: Research (Days 1-3)
    {
      phase: "research",
      parallel_tasks: [
        {
          id: "grant-search",
          agent: "res-agent",
          action: "grant-discovery",
          inputs: { keywords: ["AI", "manufacturing"] }
        },
        {
          id: "tech-trends",
          agent: "res-agent",
          action: "tech-monitoring",
          inputs: { topics: ["AI", "robotics", "fabrication"] }
        },
        {
          id: "patent-analysis",
          agent: "res-agent",
          action: "patent-search",
          inputs: { query: "autonomous manufacturing" }
        },
        {
          id: "literature-review",
          agent: "res-agent",
          action: "literature-review",
          inputs: { topics: ["AI robotics", "3D printing"] }
        }
      ]
    },
    
    // Phase 2: Design & Prototyping (Days 4-10)
    {
      phase: "design",
      sequential_tasks: [
        {
          id: "concept-design",
          agent: "fab-agent",
          action: "cad-design",
          inputs: { type: "prototype" },
          depends_on: ["grant-search", "tech-trends"]
        },
        {
          id: "test-print",
          agent: "fab-agent",
          action: "print-management",
          inputs: { action: "test-print" },
          depends_on: ["concept-design"]
        }
      ]
    },
    
    // Phase 3: Documentation & Reporting (Days 11-14)
    {
      phase: "documentation",
      parallel_tasks: [
        {
          id: "write-proposal",
          agent: "biz-agent",
          action: "proposals",
          inputs: { client: "Internal R&D", value: 50000 }
        },
        {
          id: "generate-presentation",
          agent: "studio-agent",
          action: "music-generation",
          inputs: { genre: "ambient", purpose: "presentation-bg" }
        },
        {
          id: "generate-visuals",
          agent: "eng-agent",
          action: "code-review",
          inputs: { scope: "project-assets" }
        }
      ],
      depends_on: ["test-print"]
    }
  ]
};
```

---

## Example 5: Lead Scoring & Sales Workflow

```javascript
const salesWorkflow = {
  name: "Lead Qualification → Proposal → Close",
  triggers: "new-lead-added",
  steps: [
    // 1. Score the lead
    {
      id: "score",
      agent: "biz-agent",
      action: "lead-scoring",
      inputs: { lead_id: "from trigger" },
      route_based_on: {
        ">70": "hot-path",
        "50-70": "nurture-path",
        "<50": "archive-path"
      }
    },
    
    // HOT PATH (score > 70)
    {
      id: "hot-generate-proposal",
      agent: "biz-agent",
      action: "proposals",
      inputs: { client: "from-lead", value: "estimated" },
      depends_on: ["score"],
      only_if: "score > 70"
    },
    
    {
      id: "hot-research-company",
      agent: "res-agent",
      action: "tech-monitoring",
      inputs: { company: "from-lead" },
      depends_on: ["score"],
      only_if: "score > 70"
    },
    
    {
      id: "hot-sales-call",
      agent: "eng-agent",
      action: "deployment", // Use as "engagement" placeholder
      inputs: { action: "schedule-call" },
      depends_on: ["hot-generate-proposal"],
      only_if: "score > 70"
    },
    
    // NURTURE PATH (score 50-70)
    {
      id: "nurture-email",
      agent: "biz-agent",
      action: "crm",
      inputs: { action: "create-nurture-sequence" },
      depends_on: ["score"],
      only_if: "score <= 70 AND score >= 50"
    },
    
    // ARCHIVE PATH (score < 50)
    {
      id: "archive",
      agent: "biz-agent",
      action: "crm",
      inputs: { action: "move-to-archive" },
      depends_on: ["score"],
      only_if: "score < 50"
    }
  ]
};
```

---

## Real-Time Dashboard Display

During execution, users can monitor:

```
HYDI Workflow Monitor
═══════════════════════════════════════════════

Workflow: "Product Launch - 3D Printed Item"
Status: IN_PROGRESS
Progress: 5/8 tasks complete (62%)
Elapsed: 45 minutes / Estimated Total: 72 minutes

Tasks:
  ✅ design-cad                    [COMPLETE] 12m
  ✅ design-validation              [COMPLETE] 8m
  ✅ code-review                    [COMPLETE] 6m
  ✅ test-spec                      [COMPLETE] 22m
  ⏳ generate-proposal              [RUNNING]  2m
  ⏳ research-market                [RUNNING]  3m
  ⏳ generate-music                 [RUNNING]  1m
  ⏹️ deploy-to-production           [WAITING]  blocked on 3 tasks

Confidence Levels:
  Overall: 92%
  fab-agent: 88% (33 tasks, 29 successes)
  eng-agent: 94% (28 tasks, 26 successes)
  biz-agent: 89% (15 tasks, 13 successes)
  res-agent: 91% (22 tasks, 20 successes)
  studio-agent: 95% (12 tasks, 11 successes)

Autonomous Decisions Made: 4
  • design-cad: Auto-executed (confidence 88%)
  • code-review: Auto-executed (confidence 94%)
  • research-market: Auto-executed (confidence 91%)
  • generate-music: Auto-executed (confidence 95%)

Decisions Requiring Human Input: 1
  • generate-proposal: Score 89% (threshold 90%) - PROPOSE
    → Auto-approved at 09:23:14 (user accepted)

═══════════════════════════════════════════════
```

---

## Performance Metrics

Over time, as HYDI learns:

```
Day 1: 40% autonomous (60% need human approval)
Day 3: 55% autonomous (45% need human approval)
Week 1: 68% autonomous (32% need human approval)
Week 2: 79% autonomous (21% need human approval)
Month 1: 85%+ autonomous (15% need human approval)

Tasks with 95%+ confidence (fully autonomous):
- Daily backups: 100% autonomous
- System monitoring: 100% autonomous
- Security scanning: 95% autonomous
- Code review on familiar code: 98% autonomous
- Lead scoring: 91% autonomous
- Grant discovery: 87% autonomous
- Manufacturing quality checks: 93% autonomous
```

---

## Getting Started

To run these workflows:

```bash
# 1. Start HYDI
cd HYDI_System
node supervisor.js

# 2. Execute a workflow (e.g., Example 1)
curl -X POST http://localhost:9997/execute-task \
  -H "Content-Type: application/json" \
  -d @examples/product-launch-workflow.json

# 3. Monitor in real-time
curl http://localhost:9997/status | jq .

# 4. View agent capabilities
curl http://localhost:9997/agents | jq .
```

---

**All examples use the standard HYDI task execution framework and benefit from:**
- Parallel execution (via DAG dependency analysis)
- Automatic agent assignment (by capability)
- Procedural learning (confidence score updates)
- Autonomous decision-making (when confidence ≥ threshold)
- Complete logging and auditability
