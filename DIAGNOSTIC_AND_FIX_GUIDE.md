# HYDI System Diagnostic & Fix Guide

## Overview
Your HYDI system has identified two critical issues:
1. **Dashboard Crash**: hydi-ursula stopped after 10 restart attempts
2. **Engine Failures**: heidi is experiencing persistent network and database errors

---

## Issues Identified

### Issue 1: Missing Database Column
**Error Message**: `Poll error: column hydi_events.created_at does not exist`

**Root Cause**: The hydi_events table is missing the `created_at` column that the application expects.

**Impact**: 
- heidi engine cannot query or write events
- Processing pipeline halts with polling errors
- Network failures cascade from this

**Status**: 🔴 CRITICAL

---

### Issue 2: Ollama Service Offline
**Error Message**: `[ATQ] ollama — ok:false models:none`

**Root Cause**: The Ollama service is not running.

**Impact**:
- AI decision making disabled
- Automated Task Queue cannot function
- System health degraded

**Status**: 🔴 CRITICAL

---

### Issue 3: hydi-ursula Dashboard Crashed
**Error Message**: `Script F:\HYDI_System\ursula-dashboard.js had too many unstable restarts (10). Stopped. 'errored'`

**Likely Causes**:
1. Port 3002 conflict (another process using it)
2. Missing environment variable in startup
3. Supabase connection failure from earlier credential issues
4. Database schema validation failure during startup

**Status**: 🟡 CRITICAL (cascading from Issue 1)

---

## Fix Instructions

### STEP 1: Add Missing created_at Column (URGENT)

This is the root cause of cascading failures.

**Execute in Supabase SQL Editor:**

1. Go to: https://app.supabase.com
2. Select your project: `akbnfovjdcobifeupvbn`
3. Click "SQL Editor" in the left sidebar
4. Click "New Query"
5. Copy and paste the following SQL:

```sql
-- Add missing created_at column to hydi_events
ALTER TABLE public.hydi_events 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_hydi_events_created_at ON public.hydi_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hydi_events_created_at_status ON public.hydi_events(created_at DESC, status);

-- Verify the column was added
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'hydi_events'
  AND column_name IN ('event_id', 'created_at', 'timestamp')
ORDER BY ordinal_position;

-- Check table size
SELECT COUNT(*) as total_events FROM public.hydi_events;
```

6. Click "Run" button
7. Verify you see output showing `created_at` column with type `TIMESTAMPTZ`

**Expected Result:**
```
column_name    | data_type  | is_nullable | column_default
event_id       | text       | false       | 
created_at     | timestamptz| true        | now()
timestamp      | timestamptz| true        | 
```

---

### STEP 2: Start Ollama Service

This is required for the AI decision-making system.

**Option A - Windows PowerShell (Recommended):**

1. Open PowerShell as Administrator
2. Run:
```powershell
ollama serve
```

3. Wait until you see: `Listening on...` message
4. Keep PowerShell window open (Ollama will run in background after)

**Option B - Manual Installation:**

If Ollama is not installed:
1. Download from: https://ollama.ai
2. Install the application
3. Run `ollama serve` from PowerShell

**Verification:**
- Ollama should listen on: http://localhost:11434
- You should see models loading (pull with `ollama pull mistral` if needed)

---

### STEP 3: Restart HYDI Services

After the database fix, restart all services.

**Via PM2 (Recommended):**

```powershell
# Terminal/PowerShell in F:\HYDI_System directory:

# Restart individual services
pm2 restart hydi-ursula --update-env
pm2 restart hydi-processor --update-env
pm2 restart heidi --update-env

# OR restart all at once
pm2 restart all --update-env

# Check status
pm2 status

# View logs
pm2 logs hydi-ursula --err
pm2 logs heidi --err
```

**Via Batch File:**

```powershell
# Run from F:\HYDI_System
.\start_full_system.bat
```

---

## Verification Checklist

After applying fixes, verify each step:

### ✓ Database Column Added
```powershell
# In Supabase SQL Editor, run:
SELECT column_name FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'hydi_events' 
  AND column_name = 'created_at';

# Should return: column_name = created_at
```

### ✓ Ollama Running
```powershell
# In PowerShell:
curl http://localhost:11434/api/tags

# Should return JSON with model list
```

### ✓ Services Starting Without Errors
```powershell
pm2 status

# All apps should show "online" status:
# hydi-ursula     online
# hydi-processor  online  
# heidi           online
# hydi-protoforge online
```

### ✓ No Database Polling Errors
```powershell
pm2 logs heidi | findstr /i "created_at"
pm2 logs heidi | findstr /i "poll error"

# Should return: (no results)
```

### ✓ Ollama Connected
```powershell
pm2 logs hydi-processor | findstr /i "ollama"

# Should show connection successful
```

---

## If Issues Persist

### hydi-ursula Still Won't Start

**Diagnose Port Conflict:**
```powershell
# Check what's using port 3002
netstat -ano | findstr :3002

# If something is there, kill it (replace PID):
taskkill /PID [PID] /F
```

**Check Logs:**
```powershell
pm2 logs hydi-ursula --err --lines 100
```

### heidi Still Shows Polling Errors

**Verify Column Added:**
```powershell
# Run in Supabase SQL Editor:
SELECT created_at FROM public.hydi_events LIMIT 1;
```

**Force Restart Cache:**
```powershell
# In Supabase SQL Editor:
NOTIFY pgrst, 'reload schema';
```

### Ollama Connection Failed

**Verify Ollama Port:**
```powershell
netstat -ano | findstr :11434

# Should show ollama.exe process listening
```

**Check Ollama Status:**
```powershell
# Restart Ollama
ollama serve --debug
```

---

## Database Schema Summary

After fix, hydi_events should have these columns:

```
event_id          TEXT (PRIMARY KEY)
type              TEXT
status            TEXT
timestamp         TIMESTAMPTZ
payload           JSONB
source            TEXT
retry_count       INTEGER
correlation_id    TEXT
schema_version    TEXT
created_at        TIMESTAMPTZ ← ADDED BY THIS FIX
```

---

## Next Steps

1. **Execute SQL in Supabase** (5 minutes)
2. **Start Ollama service** (2 minutes)  
3. **Restart HYDI services** (1 minute)
4. **Verify no errors** (5 minutes)
5. **Monitor logs** (ongoing)

**Total Time**: ~15 minutes

---

## Emergency Reset

If everything goes wrong, reset the system:

```powershell
# Kill all HYDI processes
pm2 delete all

# Clear PM2 cache
pm2 flush

# In Supabase, run reset script:
# See setup-production-database.sql for full database reset

# Restart from scratch:
# 1. Run setup-production-database.sql
# 2. Run fix-preflight-sql.sql  
# 3. Run this guide's SQL fix
# 4. Restart services
```

---

Generated: 2026-05-21
For: HYDI System Maintenance
Status: Ready for Execution
