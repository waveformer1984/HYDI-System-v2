# HYDI Production Stability Roadmap

## Status: Phases 1-4 Complete ✅

This document covers the engineering effort to move HYDI from "impressive demo" to "production-ready".

---

## Phase 1: Port Registry + Dependency Gating ✅

**What it does:**
- Central port registry (`.ports.json`)
- Conflict detection before startup
- Dependency-aware startup (waits for Supabase + Ollama)
- Orchestrated service startup

**Commands:**
```bash
npm run check:ports          # Detect port conflicts
npm run wait:dependencies   # Wait for Supabase + Ollama
npm run start:hydi          # Full orchestrated startup
```

**Status:** ✅ Deployed (commit e31b491)

---

## Phase 2: Worker Stability ✅

**What it does:**
- Global unhandled rejection handler
- Exponential backoff for retries (prevents thundering herd)
- Worker health checks
- Graceful shutdown (drain queues)

**Module:** `lib/error-recovery.js`

**Key features:**
```javascript
// Retry any async operation with backoff
await retryWithBackoff(
  () => supabase.query(),
  { maxRetries: 3 }
);

// Wrap async functions to catch rejections
const safeQuery = wrapAsyncFunction('db-query', dbQuery, {
  rethrow: false,
  defaultReturn: null,
});

// Track worker health
const health = new WorkerHealthCheck('worker-1');
health.success();  // +1 to successCount, reset errorCount
health.error();    // +1 to errorCount, unhealthy after 3
```

**Integration:**
```javascript
// In every service startup
const errorRecovery = require('./lib/error-recovery');
errorRecovery.setupGlobalErrorHandlers();
```

**Status:** ✅ Deployed

---

## Phase 3: Structured Logging + Health Monitoring ✅

### Structured Logging

**Module:** `lib/structured-logger.js`

**Output format:**
```json
{
  "timestamp": "2026-06-26T12:34:56.789Z",
  "level": "INFO",
  "component": "heidi-core",
  "message": "Service started",
  "port": 3458,
  "pid": 12345
}
```

**Usage:**
```javascript
const logger = require('./lib/structured-logger');

logger.info('Service started', { port: 3458 });
logger.warn('High latency detected', { latency_ms: 5000 });
logger.error('Database error', { error: err.message });
```

**Environment:**
```bash
LOG_LEVEL=DEBUG      # Control verbosity (DEBUG, INFO, WARN, ERROR, FATAL)
LOG_FILE=app.log     # Write to file (optional)
```

### Health Monitoring

**Module:** `lib/health-monitor.js`

**Endpoint:**
```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "status": "healthy",
  "uptime": 86400,
  "timestamp": "2026-06-26T12:34:56.789Z",
  "components": {
    "supabase": {
      "healthy": true,
      "lastCheck": "2026-06-26T12:34:50.000Z",
      "error": null
    },
    "ollama": {
      "healthy": true,
      "lastCheck": "2026-06-26T12:34:50.000Z",
      "error": null
    }
  }
}
```

**Integration:**
```javascript
const health = require('./lib/health-monitor');

// Register components
health.registerComponent('supabase', async () => {
  const { data, error } = await supabase.query();
  return !error;
}, 10000); // Check every 10s

health.registerComponent('ollama', async () => {
  const res = await fetch('http://localhost:11434/api/tags');
  return res.ok;
});

// Expose endpoint
app.get('/health', (req, res) => {
  const status = health.getStatus();
  res.status(health.getStatusCode()).json(status);
});
```

**Status:** ✅ Deployed

---

## Phase 4: 24-Hour Soak Test ✅

**What it does:**
- Steady request load (1 req/30s)
- Network blip simulation (5s downtime/hour)
- Memory leak detection
- Latency tracking
- Success rate reporting

**Commands:**
```bash
npm run soak-test       # Full 24-hour test
npm run soak-test:1h    # Quick 1-hour test
SOAK_DURATION=3600000 npm run soak-test  # Custom duration
```

**Example output:**
```
🧪 Starting 24-hour soak test
  duration: 24h
  testInterval: 30s
  chaosInterval: 60m

[Every 10 requests]
✅ Soak test progress: 1h
  requests: 120
  success: 119
  failures: 1
  latency_avg: 45ms
  latency_max: 250ms
  memory: 256MB
  successRate: 99.2%

🌊 Injecting network blip (5s downtime)...
✅ Network recovered

[At end]
============================================================
📊 SOAK TEST REPORT
============================================================
Duration: 24.00h
Total requests: 2880
Successful: 2869 (99.62%)
Failed: 11
Avg latency: 48ms
Max latency: 1250ms
Final memory: 312MB
============================================================
✅ PASSED: System stable over soak period
```

**Failure thresholds:**
- Success rate < 99.5% → FAILED
- Memory growth > 100MB/10 checks → WARNING
- Latency > 30s → Logged as failure

**Status:** ✅ Deployed

---

## Production Readiness Checklist

| Item | Status | Tests |
|------|--------|-------|
| Port conflicts eliminated | ✅ | `npm run check:ports` |
| Dependency-aware startup | ✅ | `npm run start:hydi` |
| Worker crash handling | ✅ | N/A (built-in) |
| Graceful shutdown | ✅ | SIGTERM → drain → exit |
| Structured logging | ✅ | `LOG_LEVEL=DEBUG npm run dev` |
| Health monitoring | ✅ | `curl localhost:3000/health` |
| Auto-recovery | ✅ | `npm run soak-test:1h` |
| Memory leak detection | ✅ | Monitored in soak test |
| Latency tracking | ✅ | `/health` endpoint + logs |
| **24-hour stability** | ✅ | `npm run soak-test` |

---

## Integration Into Services

### 1. Next.js Frontend

```javascript
// pages/api/health.js
const health = require('../lib/health-monitor');

export default async (req, res) => {
  const status = health.getStatus();
  res.status(health.getStatusCode()).json(status);
};
```

### 2. HEIDI Core

```javascript
// heidi-core/index-clean-3458.js
const errorRecovery = require('../lib/error-recovery');
const logger = require('../lib/structured-logger');
const health = require('../lib/health-monitor');

// Setup
errorRecovery.setupGlobalErrorHandlers();
health.registerComponent('supabase', checkSupabase);
health.registerComponent('ollama', checkOllama);

// Startup
logger.info('HEIDI Core starting', { port: 3458 });
server.listen(3458);

// Shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  await errorRecovery.gracefulShutdown();
});
```

### 3. Workers

```javascript
// workers/example.js
const { retryWithBackoff, wrapAsyncFunction } = require('../lib/error-recovery');
const logger = require('../lib/structured-logger');

async function processJob(job) {
  return retryWithBackoff(
    () => supabase.from('jobs').update({ status: 'processing' }),
    {
      maxRetries: 3,
      onRetry: (attempt, waitMs, err) => {
        logger.warn('Retry', {
          component: 'job-processor',
          attempt,
          waitMs: Math.round(waitMs),
          error: err.message,
        });
      },
    }
  );
}

const safeProcess = wrapAsyncFunction('job-process', processJob, {
  rethrow: false,
  onError: (err) => logger.error('Job processing failed', { error: err.message }),
});
```

---

## Monitoring & Alerts

### Log Queries (JSON Lines Format)

```bash
# View all errors in last hour
cat app.log | jq 'select(.level == "ERROR")'

# Find slow requests
cat app.log | jq 'select(.latency_ms > 5000)'

# Memory usage over time
cat app.log | jq 'select(.memory) | {timestamp, memory}'

# Component health
cat app.log | jq 'select(.component) | .component' | sort | uniq -c
```

### Real-time Monitoring

```bash
# Tail with color (using jq)
tail -f app.log | jq 'if .level == "ERROR" then . | @base64 else empty end'

# Count errors per hour
cat app.log | jq '.timestamp' | sort | uniq -c

# Alert on failures
tail -f app.log | jq 'select(.message | contains("error") or contains("failed"))'
```

---

## Deployment Checklist

Before deploying to production:

- [ ] Run `npm run soak-test:1h` and confirm > 99% success rate
- [ ] Monitor memory during soak test (should grow < 50MB over 1h)
- [ ] Run `npm run check:ports` to verify no conflicts
- [ ] Set `LOG_LEVEL=WARN` (reduce noise in prod)
- [ ] Set `LOG_FILE` path for persistent logging
- [ ] Configure alert system on `/health` endpoint (503 = alert)
- [ ] Test SIGTERM handling (should exit cleanly within 10s)
- [ ] Verify all components registered with health monitor
- [ ] Confirm error-recovery is initialized at startup
- [ ] Test graceful shutdown under load (kill -15 during soak test)

---

## Operational Commands

### Daily

```bash
# Check system health
curl https://hydi.example.com/health | jq

# Monitor logs for errors
tail -1000 app.log | jq 'select(.level == "ERROR")'

# Check memory trend
tail -100 app.log | jq 'select(.memory) | .memory' | tail -1
```

### Weekly

```bash
# Run 1-hour soak test
npm run soak-test:1h

# Analyze log trends
cat app.log | jq -r '.timestamp' | while read ts; do
  date -d "$ts" +%Y-%m-%d
done | sort | uniq -c
```

### Monthly

```bash
# Full 24-hour soak test
npm run soak-test

# Review memory usage patterns
cat app.log | jq 'select(.memory) | {timestamp, memory}' > memory-trends.json
```

---

## What's NOT Included (Future Work)

- [ ] Distributed tracing (requires OpenTelemetry)
- [ ] Custom Prometheus metrics
- [ ] Slack/PagerDuty alerting (requires webhook)
- [ ] Database connection pooling (needs profiling)
- [ ] Load-based auto-scaling

These are valuable but not blocking for "production ready".

---

## Summary

HYDI is now:
- ✅ **Failure-tolerant** (auto-retries, graceful shutdown)
- ✅ **Observable** (structured logs, health endpoint)
- ✅ **Validated** (24-hour soak test)
- ✅ **Production-ready** (all critical stability systems in place)

To start using these systems:

```bash
npm run start:hydi    # Orchestrated startup with all checks
npm run soak-test:1h  # Quick 1-hour validation
```

Ship with confidence. 🚀
