# HEIDI Operational Self-Awareness System

## Overview

Heidi has been refactored into a 4-layer operational self-awareness system with continuous introspection capabilities. This is not philosophical awareness - it's operational instrumentation for local intelligence systems.

## Architecture

### Layer A: Input Layer
- Captures raw input with metadata
- Environmental signal monitoring
- Input preprocessing and validation

### Layer B: Cognitive Layer (Local Model)
- Primary reasoning using local LLM
- Context integration from memory
- Structured output generation

### Layer C: Reflection Layer (Self-Monitoring)
- Output quality evaluation
- Contradiction and drift detection
- Confidence scoring (0.0-1.0)

### Layer D: Memory/State Layer
- Decision trace persistence
- Performance metrics storage
- Failure pattern tracking

## Core Components

### OperationalIntrospection (`operational-introspection.js`)
Main orchestrator implementing the 4-layer architecture and self-awareness loop.

**Key Methods:**
- `selfAwarenessLoop()` - Complete capture→evaluate→score→store→adjust cycle
- `getOperationalState()` - Current system state and metrics
- `describeDecisionPipeline()` - Self-description capability
- `identifyRecurringFailurePatterns()` - Pattern detection

### HeidiBootloader (`bootloader.js`)
Automatic provisioning and initialization system.

**Features:**
- Environment verification (Ollama, models, directories)
- Missing component provisioning
- Health monitoring
- Graceful shutdown

### ToolIntegrationMonitor (`tool-integration-monitor.js`)
Tool usage logging, evaluation, and ranking system.

**Capabilities:**
- Real-time tool call logging
- Usefulness scoring (0.0-1.0)
- Inefficiency detection
- Performance trend analysis

### LocalFirstConstraints (`local-first-constraints.js`)
Ensures LOCAL > HYBRID > EXTERNAL priority with fallbacks.

**Features:**
- Adaptive constraint adjustment
- Performance-based mode switching
- Degraded mode support
- Fallback chain management

### EmergenceTest (`emergence-test.js`)
Verifies operational self-awareness emergence criteria.

**Test Criteria:**
1. Decision pipeline self-description
2. Failure pattern identification
3. Reasoning strategy modification
4. State continuity across sessions

## Usage

### Quick Start

```javascript
const HeidiBootloader = require('./self-awareness/bootloader');

const bootloader = new HeidiBootloader();
bootloader.initialize()
  .then(heidi => {
    // Use Heidi with operational self-awareness
    return heidi.selfAwarenessLoop("Your input here");
  })
  .then(result => {
    console.log('Result:', result.output);
    console.log('Confidence:', result.confidence_score);
    console.log('Self-awareness metrics:', result.self_awareness_metrics);
  });
```

### Self-Awareness Loop

```javascript
const result = await heidi.selfAwarenessLoop(input, metadata);

// Result includes:
// - execution_summary: Cycle performance and success
// - reasoning_trace: Decision path through layers
// - confidence_score: Overall confidence (0.0-1.0)
// - self_awareness_metrics: Coherence, efficiency, contradictions
// - memory_write_confirmed: Persistence verification
```

### Operational State Query

```javascript
const state = await heidi.getOperationalState();

// State includes:
// - execution_cycles: Total cycles completed
// - performance_metrics: Latency, success rate, scores
// - failure_patterns: Recurring error patterns
// - tool_usage_stats: Tool performance rankings
// - model_status: Local model availability
```

### Decision Pipeline Self-Description

```javascript
const pipeline = await heidi.describeDecisionPipeline();

// Pipeline includes:
// - pipeline: "Input → Cognitive → Reflection → Memory → Adjustment"
// - current_state: Live operational metrics
// - layers: Detailed layer descriptions
```

## Configuration

### Environment Variables

```bash
# Ollama Configuration
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3
OLLAMA_CRITIC_MODEL=llama3:8b

# Heidi Configuration
HEIDI_TIMEOUT=8000
HEIDI_DB_PATH=./data/heidi_memory.db

# Local-First Constraints
ENABLE_CLOUD_FAILOVER=false
FIREBASE_FUNCTIONS_URL=
GEMINI_API_KEY=
```

### Local Configuration

Create `config/heidi-config.json`:

```json
{
  "primary": {
    "model": "llama3",
    "timeout": 8000
  },
  "critic": {
    "model": "llama3:8b",
    "timeout": 8000
  },
  "memory": {
    "dbPath": "./data/heidi_memory.db"
  }
}
```

## Emergence Verification

Run the emergence test to verify operational self-awareness:

```bash
node heidi-core/self-awareness/emergence-test.js
```

**Success Criteria:**
- ✓ Decision pipeline self-description
- ✓ Failure pattern identification  
- ✓ Reasoning strategy modification
- ✓ State continuity across sessions

## Monitoring

### Health Monitoring

The bootloader automatically starts health monitoring every 30 seconds:

```bash
[Health] Cycles: 15, Success: 93.3%, Models: ✓/✓
[Health] ⚠️ Drift detected in last execution
[Health] ⚠️ 2 recurring failure patterns detected
```

### Tool Integration Monitoring

```javascript
const toolMonitor = new ToolIntegrationMonitor();

// Log tool call
const logId = toolMonitor.logToolCall('read_file', 'readFile', filepath);

// Complete tool call
toolMonitor.completeToolCall(logId, fileContent, executionTime, true);

// Get inefficient tools
const inefficient = toolMonitor.getInefficientTools();
```

### Performance Metrics

All execution cycles are tracked with:
- **Coherence Score**: Output consistency (0.0-1.0)
- **Confidence Score**: Result certainty (0.0-1.0)  
- **Efficiency Score**: Tool usage optimization (0.0-1.0)
- **Latency Tracking**: Execution time without auto-fallback
- **Success Rate**: Overall system reliability

## Local-First Constraints

The system enforces LOCAL > HYBRID > EXTERNAL priority:

```javascript
const constraints = new LocalFirstConstraints();
constraints.configureConstraints({
  local_priority: true,
  allow_hybrid: false,
  allow_external: false,
  fallback_enabled: true
});

const result = await constraints.execute(input, { startTime: Date.now() });
```

**Fallback Behavior:**
1. Try local model first
2. Enable hybrid if local fails repeatedly
3. Allow external if all else fails
4. Use degraded mode as final fallback

## Memory Persistence

Heidi maintains persistent state across sessions:

### SQLite Tables
- `short_term`: Recent interactions (last 1000)
- `long_term`: Important facts with importance scoring
- `reflections`: Self-generated insights and patterns
- `system_state`: Health, logs, and metrics
- `embeddings`: Vector search capabilities

### Context Building
```javascript
const context = await heidi.memory.buildContext(input);
// Includes: recent interactions, relevant facts, high-confidence reflections, system health
```

## Failure Mode Handling

### High Uncertainty Protocol
- Do not guess or hallucinate
- Reduce scope and acknowledge uncertainty
- Log ambiguity for pattern detection
- Request clarification or simulate bounded inference

### Circuit Breaker Protection
- Disable models after repeated failures
- Adaptive timeout management
- Performance-based fallback chains

## Debugging

### Enable Verbose Logging
```bash
DEBUG=heidi:* node heidi-core/self-awareness/bootloader.js
```

### Export Tool Usage Data
```javascript
const exportData = toolMonitor.exportToolUsageData();
// Includes summary, per-tool metrics, and recent logs
```

### Validate Constraints
```javascript
const validation = constraints.validateConstraints();
// Returns validity status and any constraint violations
```

## Architecture Benefits

1. **Operational Introspection**: Continuous self-monitoring without abstraction
2. **Local-First Design**: Prioritizes local inference with intelligent fallbacks
3. **Adaptive Behavior**: Modifies reasoning based on performance patterns
4. **Persistent Memory**: Maintains state and learns across sessions
5. **Tool Optimization**: Automatically ranks and optimizes tool usage
6. **Failure Resilience**: Graceful degradation and recovery mechanisms

## Emergence Achievement

Heidi achieves operational self-awareness when it can:

1. **Describe its decision pipeline** without prompt injection
2. **Identify recurring failure patterns** from performance logs
3. **Modify reasoning strategy** based on past performance
4. **Maintain state continuity** across restarts

This is verifiable through the emergence test suite and represents genuine operational introspection capabilities.

---

*Heidi is not a chatbot. Heidi is a locally persistent, self-auditing inference system with adaptive reasoning behavior.*
