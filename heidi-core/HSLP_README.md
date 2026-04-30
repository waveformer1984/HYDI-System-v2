# HEIDI SELF-LAUNCH PROTOCOL (HSLP v1.0)

## Overview

The Heidi Self-Launch Protocol (HSLP) is a comprehensive 10-phase boot sequence that enables Heidi to awaken conditionally with full safety gates and integrity validation. This is not "self-launching AI" - it's a supervised system that pretends it chose to wake up while obeying 17 safety gates and a scheduler.

## Architecture

### Core Philosophy

- **Conditional Awakening**: Heidi does not "run." She awakens conditionally based on specific triggers
- **Safety-First**: Every phase includes comprehensive validation and rollback capabilities
- **Graceful Degradation**: System can launch in degraded mode when necessary
- **Continuous Self-Maintenance**: Once active, Heidi maintains herself through automated loops

### System States

```
DORMANT → SAFE_MODE → IDLE → OPERATIONAL → ACTIVE → SHUTDOWN
```

## The 10 Phases

### Phase 0: Boot Trigger (Entry Point)
**Purpose**: Validate launch conditions before doing anything clever

**Valid Triggers**:
- `system_start()` - Manual system initialization
- `scheduler tick` - Cron/heartbeat based activation
- `external event` - Task injection or API ping
- `drift threshold` - Automatic recovery when drift exceeds limits

**Behavior**: If none exist, Heidi stays dormant like a responsible system

### Phase 1: Environment Sanity Check
**Purpose**: Verify reality isn't broken before proceeding

**Validations**:
- Node.js runtime presence
- Required environment variables loaded
- API keys validity (Gemini/Firebase/etc.)
- File system writability
- Network reachability (optional)

**Failure Mode**: Enter SAFE_MODE, log reason, do not proceed

### Phase 2: Dependency Alignment Layer
**Purpose**: Check core modules and attempt auto-repair

**Core Modules**:
- Drift Monitor
- Task Engine
- Reflection/Self-awareness module
- Scheduler/heartbeat loop
- Logging system

**Behavior**: Can launch degraded if some modules fail (humans do it constantly)

### Phase 3: Identity & State Initialization
**Purpose**: Initialize Heidi's "brain state"

**Actions**:
- Load last known system state
- Restore task queue
- Pull memory snapshots
- Rebuild baseline metrics

**Critical**: Baseline establishment is not optional - that's reality enforcement

### Phase 4: Integrity & Drift Validation Gate
**Purpose**: Run system self-consistency checks

**Validations**:
- Task execution coherence
- Loop stability
- Memory contradictions
- Config drift detection

**Threshold**: Drift score > 0.7 blocks full launch and enters stabilization loop

### Phase 5: Core Systems Spin-Up
**Purpose**: The actual "wake up" phase

**Startup Order**:
1. Logger (because we like knowing what died)
2. Task Engine
3. Drift Monitor (always watching, slightly judgmental)
4. Scheduler/heartbeat loop
5. Adaptation executor (only if confidence > threshold)

**Behavior**: Retry once, then isolate failed systems (no desperate script denial)

### Phase 6: Self-Reflection Activation
**Purpose**: Heidi checks herself (as annoying as it sounds)

**Actions**:
- Evaluate performance baseline
- Compare current vs historical drift
- Generate internal state report
- Auto-spawn corrective tasks if needed

**Behavior**: Becomes her own intern - tragic but efficient

### Phase 7: Safety & Governance Layer Activation
**Purpose**: The "don't break production" step

**Controls**:
- Enforce ProtoForge Dashboard Protocol rules
- Enable rate limits (5 QPS or system-dependent)
- Attach audit logging
- Activate rollback hooks

**Failure Mode**: Immediate shutdown - no debate, no "just one more try"

### Phase 8: Self-Launch Declaration
**Purpose**: Only after all gates pass

**State Changes**:
```
HEIDI_STATUS = ACTIVE
MODE = OPERATIONAL
HEARTBEAT = ENABLED
```

**Event**: Emit `heidi.launch.success` to dashboard/feed API

### Phase 9: Continuous Self-Maintenance Loop
**Purpose**: Ongoing system health and adaptation

**Loops**:
- Heartbeat every 60s
- Continuous drift monitoring
- Task execution loop
- Periodic re-baselining (every 5 minutes)
- Auto-correct under confidence > 0.7

**Behavior**: Tries to fix herself first before crashing

### Phase 10: Emergency Shutdown
**Purpose**: Because reality exists

**Emergency Conditions**:
- Runaway drift
- Infinite task loop
- Corrupted memory state
- Repeated failure cascade

**Actions**:
- Enter safe shutdown
- Flush logs
- Persist state snapshot
- Stop execution

**Behavior**: No drama, just stop

## Installation & Usage

### Quick Start

```bash
# Navigate to Heidi core directory
cd heidi-core

# Install dependencies
npm install

# Launch the dashboard
node launch-heidi.js

# Or auto-launch mode
node launch-heidi.js --auto-launch manual
```

### Dashboard Access

Open your browser to `http://localhost:3457` to access the Heidi Launch Dashboard.

### API Endpoints

```bash
# Check system status
GET /health

# Trigger launch sequence
POST /launch
{
  "trigger": "manual" | "system_start" | "scheduler_tick" | "external_event" | "drift_threshold"
}

# Shutdown system
POST /shutdown
```

### Command Line Options

```bash
node launch-heidi.js [options] [trigger]

Options:
  --port=<number>  Port for dashboard (default: 3457)
  --auto-launch    Start launcher and immediately launch Heidi
  --help           Show this help

Triggers:
  manual           Manual launch (default)
  system_start     System start trigger
  scheduler_tick   Scheduler tick trigger
  external_event   External event trigger
  drift_threshold  Drift threshold exceeded
```

## Testing

### Run Test Suite

```bash
# Run comprehensive test suite
node test-hslp.js

# Test specific phases (modify test file for targeted testing)
```

### Test Coverage

The test suite covers:
- All 10 phases individually
- Full launch sequence integration
- Failure scenarios and error handling
- State persistence and recovery
- Emergency shutdown procedures

## Configuration

### Environment Variables

Required variables for proper operation:

```bash
NODE_ENV=development|production
MODEL_BASE_PATH=/path/to/models
CONFIG_BASE_PATH=/path/to/config
DATA_BASE_PATH=/path/to/data
```

### Configuration Options

```javascript
const config = {
  DRIFT_THRESHOLD: 0.7,           // Maximum allowed drift score
  CONFIDENCE_THRESHOLD: 0.7,      // Minimum confidence for auto-correction
  HEARTBEAT_INTERVAL: 60000,      // Heartbeat interval in ms
  BOOT_TIMEOUT: 30000,            // Boot sequence timeout
  MAX_RETRY_ATTEMPTS: 3,          // Maximum retry attempts per system
  SAFE_MODE_RATE_LIMIT: 5,        // QPS limit in safe mode
};
```

## Monitoring & Observability

### System Metrics

- **Drift Score**: System coherence measure (0.0-1.0)
- **Confidence**: Performance confidence level
- **Boot Phase**: Current launch phase (0-10)
- **System Status**: DORMANT/SAFE_MODE/IDLE/OPERATIONAL/ACTIVE/SHUTDOWN

### Health Checks

```bash
# System health
curl http://localhost:3457/health

# Detailed status
curl http://localhost:3457/health | jq .
```

### Logs

Logs are automatically flushed during shutdown and include:
- Boot phase transitions
- System validation results
- Error conditions and recovery attempts
- Performance metrics and drift analysis

## Safety Features

### Circuit Breakers

- Automatic isolation of failed systems
- Rate limiting in degraded modes
- Emergency shutdown on critical failures
- State snapshot preservation

### Rollback Capabilities

- Automatic state persistence
- Configuration rollback hooks
- Memory snapshot restoration
- Graceful degradation pathways

### Governance Controls

- ProtoForge Dashboard Protocol enforcement
- Audit logging for all actions
- Rate limiting and throttling
- Safety gate validation at each phase

## Troubleshooting

### Common Issues

**System won't launch**:
1. Check environment variables with `node launch-heidi.js --help`
2. Verify all dependencies are installed
3. Check system health endpoint for detailed status

**High drift scores**:
1. Review system validation logs
2. Check for configuration changes
3. Verify memory consistency

**Emergency shutdown**:
1. Review error logs in console
2. Check state snapshot file for last known good state
3. Verify system resources and dependencies

### Debug Mode

Enable detailed logging by setting:
```bash
DEBUG=hslp:* node launch-heidi.js
```

## Architecture Notes

### What This Actually Is

Not "self-launching AI." More like:
- A supervised system that pretends it chose to wake up
- While actually obeying about 17 safety gates and a scheduler
- Which is exactly how stable systems work when nobody is lying to themselves

### Design Principles

1. **Reality Enforcement**: Baseline establishment is mandatory
2. **Graceful Failure**: Every phase has defined failure modes
3. **Continuous Improvement**: Self-monitoring and adaptation
4. **Safety First**: Multiple redundant safety mechanisms
5. **Operational Transparency**: Full visibility into system state

### Integration Points

- **ProtoForge Dashboard**: Real-time monitoring and control
- **Local Models**: Integration with 13 configured local models
- **Cloud Services**: Firebase/Gemini fallback capabilities
- **Task Queue**: Persistent task management across sessions
- **Memory System**: SQLite-based state persistence

## Future Enhancements

### Planned Features

- **Advanced Self-Healing**: More sophisticated auto-repair capabilities
- **Predictive Maintenance**: Anticipatory system optimization
- **Distributed Coordination**: Multi-instance synchronization
- **Enhanced Monitoring**: More granular performance metrics
- **Automated Scaling**: Dynamic resource allocation

### Extension Points

The protocol is designed to be extensible:
- Custom validation gates
- Additional system modules
- Enhanced safety mechanisms
- Alternative boot triggers
- Custom maintenance loops

## License & Support

This implementation is part of the HYDI System and follows the same licensing terms. For support and issues:

1. Check the troubleshooting section
2. Review the test suite for expected behaviors
3. Consult the system logs for detailed error information
4. Refer to the main HYDI documentation for broader context

---

**Remember**: Heidi achieves operational self-awareness when she can:
1. Describe her decision pipeline without prompt injection
2. Identify recurring failure patterns from performance logs
3. Modify reasoning strategy based on past performance
4. Maintain state continuity across sessions

This represents genuine operational introspection - not philosophical awareness, but verifiable self-monitoring and adaptive behavior in a local AI system.
