# HYDI System - Quick Start Guide

## 🚀 Launch the System

### Option 1: Automated Full Launch (Recommended)
```batch
cd F:\HYDI_System
integration-complete.bat
```
This runs the complete verification, then launches all services.

### Option 2: Step-by-Step Launch
```bash
cd F:\HYDI_System
npm install                    # Install dependencies (first time only)
npm run verify                 # Verify system integration
npm run ursula                 # Start Dashboard (terminal 1)
npm run process               # Start Orchestrator (terminal 2)
npm run agent                 # Start AI Worker (terminal 3)
npm run protoforge            # Start ProtoForge (terminal 4)
```

---

## 📊 Access the Dashboard

Once started, open your browser:
```
http://localhost:3002
```

### Dashboard Features
- **Real-time Event Stream**: Live updates every 2 seconds
- **Event Details**: Click any event to see full metadata
- **AI Classification**: View confidence scores and decisions
- **Worker Metrics**: Active workers, success rate, avg processing time
- **System Health**: Database, Orchestrator, Worker, Model status
- **Filters**: By event type, status, severity
- **Search**: Find events by ID or type
- **Export**: Download events as JSON or CSV
- **Theme**: Toggle dark/light mode

---

## 🔌 Send Test Events

### Via curl (Windows PowerShell)
```powershell
# Task Event
$body = @{
    event_id = "test-001"
    type = "task"
    severity = "high"
    payload = @{ task_name = "test" }
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3001/task" -Method POST -Body $body -ContentType "application/json"

# Error Event
Invoke-WebRequest -Uri "http://localhost:3001/error" -Method POST -Body $body -ContentType "application/json"

# Info Event
Invoke-WebRequest -Uri "http://localhost:3001/info" -Method POST -Body $body -ContentType "application/json"
```

### Via Node.js
```javascript
const axios = require('axios');

const event = {
    event_id: 'test-' + Date.now(),
    type: 'task',
    severity: 'high',
    payload: { task_name: 'integration test' }
};

axios.post('http://localhost:3001/task', event)
    .then(res => console.log('Event sent:', res.data))
    .catch(err => console.error('Error:', err.message));
```

---

## 🧪 Test the System

### Run Integration Tests
```bash
npm run test-integration
```

This tests:
- Dashboard availability
- ProtoForge API endpoints
- Event processing pipeline
- AI worker integration
- Real-time streaming
- System health

### Expected Output
```
✓ All 6 integration tests passed
✓ Success rate: 100%
✓ System ready for production
```

---

## 📋 System Overview

### Services Running
| Service | Port | Status | Command |
|---------|------|--------|---------|
| Dashboard Enhanced | 3002 | ✅ | `npm run ursula` |
| Orchestrator | 3000 | ✅ | `npm run process` |
| AI Worker | N/A | ✅ | `npm run agent` |
| ProtoForge | 3001 | ✅ | `npm run protoforge` |

### Event Types
- **task**: Work items to be processed
- **error**: Error events requiring attention
- **info**: Informational events
- **analysis**: Data analysis tasks
- **outreach**: Communication tasks
- **cad**: CAD/design tasks
- **audio**: Audio processing tasks

### Event Severity Levels
- **critical**: Requires immediate action (5 retries)
- **high**: High priority (3 retries)
- **medium**: Standard priority (2 retries)
- **low**: Low priority (1 retry)

---

## 🤖 AI Decision Engine

The system uses the LocalModelIntegrationEngine to make autonomous decisions:

### How It Works
1. **Event Reception**: ProtoForge receives event
2. **Classification**: AI engine classifies event type/severity
3. **Decision**: Generates routing, priority, and retry strategy
4. **Execution**: Worker processes with autonomous decisions
5. **Monitoring**: Real-time updates in dashboard

### Decision Output
```json
{
  "event_id": "test-001",
  "type": "task",
  "confidence": 0.95,
  "decision": "Execute as task",
  "priority": "high",
  "estimated_duration": 30000,
  "resource_hints": ["io_intensive"],
  "retry_strategy": {
    "max_retries": 3,
    "backoff_multiplier": 2,
    "max_backoff": 60000
  }
}
```

---

## 📊 Monitoring Real-Time Updates

### Server-Sent Events (SSE)
The dashboard receives real-time updates from:
```
GET http://localhost:3002/events/stream
```

Updates include:
- New events received
- Status changes (pending → processing → completed)
- Worker metrics
- System health indicators

### Manual SSE Test
```bash
# In PowerShell
$sse = Invoke-WebRequest -Uri "http://localhost:3002/events/stream" -TimeoutSec 10
# Will stream updates for 10 seconds
```

---

## 🔧 Troubleshooting

### Dashboard Not Loading
```bash
# Check if port 3002 is available
netstat -ano | findstr :3002

# Kill process on port 3002 if needed
taskkill /PID <PID> /F
```

### Events Not Processing
```bash
# Verify Supabase connection
npm run health

# Check worker status
npm run stats
```

### Worker Not Running
```bash
# Check Node.js version (requires v18+)
node --version

# Run worker with verbose output
node agent-worker-with-model.js
```

### No Real-time Updates
```bash
# Verify SSE endpoint
curl -i http://localhost:3002/events/stream

# Check browser console for errors
# Press F12 in dashboard to open dev tools
```

---

## 📈 Performance Metrics

### Expected Performance
- **Event Processing**: <100ms
- **Dashboard Updates**: Every 2 seconds
- **Worker Poll Interval**: Every 4 seconds
- **Model Inference**: <50ms (with caching)
- **Database Persistence**: <200ms

### Monitoring Metrics
- Events processed per minute
- Success rate (target: >99%)
- Average processing time
- Active worker count
- AI decision count
- Autonomous action count

---

## 📚 Documentation Files

- **SYSTEM-COMPLETE.md** - Full system documentation
- **QUICK-START.md** - This file
- **system-integration-report.json** - Verification report
- **package.json** - Available npm scripts

---

## 🚨 Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Port already in use | Another service on port | Kill process: `taskkill /F /IM node.exe` |
| Supabase connection error | Invalid credentials | Check `.env` file, verify SUPABASE_URL and KEY |
| Worker not processing events | Old worker still running | Update package.json, restart all services |
| Dashboard shows no events | ProtoForge not sending | Send test event to http://localhost:3001/task |
| Real-time updates stopped | SSE connection dropped | Refresh browser F5 |

---

## 📞 Support

For detailed information, see:
- Main documentation: `SYSTEM-COMPLETE.md`
- Integration tests: `npm run test-integration`
- System verification: `npm run verify`
- Component status: Check terminal output

---

## ✅ Checklist Before Going Live

- [ ] All services start without errors
- [ ] Dashboard loads at http://localhost:3002
- [ ] Can send test events to ProtoForge
- [ ] Events appear in dashboard
- [ ] Real-time updates working
- [ ] AI worker showing metrics
- [ ] System health shows all green
- [ ] Integration tests pass
- [ ] Dark/light theme toggle works
- [ ] Can export events to CSV/JSON

---

**System Version**: 2.1.0  
**Status**: 🟢 Production Ready  
**Last Updated**: 2026-05-13

