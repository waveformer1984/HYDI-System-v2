# HYDI "Stable-Core" Deployment Commands

## Pre-Deployment

```bash
# 1. Run pre-flight checklist
node preflight-check.js

# 2. Set up production environment
cp .env.production .env

# 3. Install dependencies
npm ci --production

# 4. Build (if applicable)
npm run build
```

## Stage 1: Heartbeat (24 Hours)

```bash
# Start ghost producer for 24-hour verification
node ghost-producer.js start

# Monitor ghost producer health
node ghost-producer.js health

# Check ghost producer stats
node ghost-producer.js stats

# Stop ghost producer (after 24 hours)
node ghost-producer.js stop
```

## Stage 2: Shadow Launch (Partial Traffic)

```bash
# Start shadow launch monitoring (10% traffic)
node shadow-launch.js monitor

# Simulate traffic for testing
node shadow-launch.js simulate 300000  # 5 minutes

# Check shadow launch health
node shadow-launch.js health

# Test single request
node shadow-launch.js test

# Stop shadow launch monitoring
node shadow-launch.js stop
```

## Stage 3: Full Throttle (Public)

```bash
# Start persistence monitoring
node persistence-monitor.js start

# Start services with PM2
pm2 start ecosystem.config.js --env production

# Check PM2 status
pm2 status

# View PM2 logs
pm2 logs

# Restart services
pm2 restart all

# Stop services
pm2 stop all
```

## Operational Guardrails

```bash
# Kill switch operations
node kill-switch.js status
node kill-switch.js activate "Database performance issue"
node kill-switch.js deactivate
node kill-switch.js logs

# Persistence monitoring
node persistence-monitor.js check
node persistence-monitor.js alerts 24  # Last 24 hours
node persistence-monitor.js status

# Stop monitoring
node persistence-monitor.js stop
```

## Health Checks

```bash
# Service health
curl http://localhost:3001/health
curl http://localhost:3002/health

# SSE stream test
curl -m 5 http://localhost:3002/events/stream

# Database connectivity test
node verify-unified-system.js
```

## Emergency Procedures

```bash
# Emergency kill switch activation
node kill-switch.js activate "Emergency - manual intervention"

# Replay buffered events (after recovery)
node kill-switch.js deactivate

# Check emergency logs
tail -f /var/log/hydi/emergency.log

# Service restart
pm2 restart hydi-protoforge
pm2 restart hydi-processor
pm2 restart hydi-ursula
```

## Monitoring & Debugging

```bash
# Real-time logs
pm2 logs --lines 100

# Memory usage
pm2 monit

# Process details
pm2 show hydi-protoforge
pm2 show hydi-processor
pm2 show hydi-ursula

# Database stats
node -e "require('dotenv').config(); const { createClient } = require('@supabase/supabase-js'); const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); s.from('hydi_events').select('status').then(r => console.log(r.data.reduce((acc, e) => { acc[e.status] = (acc[e.status] || 0) + 1; return acc; }, {})))"
```

## Deployment Automation

```bash
# Full deployment script
#!/bin/bash
echo "=== HYDI DEPLOYMENT ==="

# Pre-flight check
echo "Running pre-flight checks..."
node preflight-check.js
if [ $? -ne 0 ]; then
  echo "Pre-flight checks failed. Aborting deployment."
  exit 1
fi

# Start services
echo "Starting services..."
pm2 start ecosystem.config.js --env production

# Start monitoring
echo "Starting monitoring..."
node persistence-monitor.js start &
MONITOR_PID=$!

# Health check
echo "Waiting for services to start..."
sleep 30

curl -f http://localhost:3001/health
if [ $? -ne 0 ]; then
  echo "Health check failed. Rolling back..."
  pm2 stop all
  kill $MONITOR_PID
  exit 1
fi

echo "Deployment successful!"
echo "Services: pm2 status"
echo "Monitoring: node persistence-monitor.js status"
```

## Environment Verification

```bash
# Verify production environment
node -e "console.log('NODE_ENV:', process.env.NODE_ENV); console.log('ENVIRONMENT:', process.env.ENVIRONMENT); console.log('SUPABASE_URL:', process.env.SUPABASE_URL); console.log('CORS_ORIGIN:', process.env.CORS_ORIGIN)"

# Verify key separation
node -e "console.log('Service Key:', !!process.env.SUPABASE_SERVICE_ROLE_KEY); console.log('Anon Key:', !!process.env.SUPABASE_ANON_KEY)"
```

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `node preflight-check.js` | Full system validation |
| `node ghost-producer.js start` | 24-hour heartbeat verification |
| `node shadow-launch.js monitor` | 10% traffic testing |
| `pm2 start ecosystem.config.js` | Production deployment |
| `node persistence-monitor.js start` | Operational monitoring |
| `node kill-switch.js activate` | Emergency data protection |

## Success Criteria

- [ ] Pre-flight checks: 100% pass
- [ ] Ghost producer: 24 hours, 99.9%+ success rate
- [ ] Shadow launch: <200ms latency, 95%+ success rate
- [ ] Full deployment: All services healthy
- [ ] Monitoring: No critical alerts for 1 hour

---

**Last Updated**: 2026-04-21
**Version**: 1.0.0
**Strategy**: Stable-Core
