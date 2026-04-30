# Heidi Reflection System - Deployment Guide

## Current Status
✅ Code changes complete, ready for deployment  
⚠️ CLI deployment hanging - use manual method below

## What Was Fixed

### 1. Authentication (CRITICAL FIX)
**File:** `supabase/functions/heidi-reflect/index.ts`

Changed from complex HMAC signature validation to simple header-based auth:

```typescript
// HARD AUTH CHECK: Reject immediately without proper secret
const secret = req.headers.get("x-heidi-secret");
if (!secret || secret !== HEIDI_REFLECT_SECRET) {
  return new Response("Unauthorized", { status: 401 });
}
```

**Config:** `supabase/config.toml`
```toml
[functions.heidi-reflect]
verify_jwt = false
```

### 2. Adaptation Executor (NEW)
**File:** `modules/adaptation-executor.js`

Processes insights with confidence > 0.7 and executes safe adaptations:
- Auto-executes: `enable_caching`, `adjust_alert_thresholds`, `simplify_interface`
- Escalates to human: `delete_data`, `modify_production_config`, etc.

### 3. Structured Model Logging (NEW)
**File:** `src/server.js`

Added structured JSON logging for all local model events:
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "model": "gpt-4-local",
  "latency": 120,
  "success": true,
  "failover": false,
  "confidence": 0.82,
  "tier": "pro",
  "priority": "batched"
}
```

## Deployment Steps (Manual)

Since CLI deployment is hanging, use the Supabase Dashboard:

### Method 1: Supabase Dashboard (Recommended)

1. **Login to Supabase Dashboard**
   - URL: https://supabase.com/dashboard
   - Project: `akbnfovjdcobifeupvbn`

2. **Navigate to Edge Functions**
   - Go to "Edge Functions" in the left sidebar
   - Find `heidi-reflect` function

3. **Update Function Code**
   - Click "Edit" on the `heidi-reflect` function
   - Replace with contents from: `supabase/functions/heidi-reflect/index.ts`
   - Click "Deploy"

4. **Verify JWT Setting**
   - In the function settings, ensure "Verify JWT" is set to `false`
   - This enables header-based authentication

5. **Set Environment Variable**
   - Go to "Project Settings" → "API"
   - Add environment variable:
     - Name: `HEIDI_REFLECT_SECRET`
     - Value: Generate a strong random string (see below)

### Method 2: Using curl (Alternative)

```bash
# Generate a secret
HEIDI_SECRET=$(openssl rand -hex 32)

# Get your Supabase access token from dashboard
# Settings → API → Project API keys → service_role key

# Deploy via API
curl -X PUT "https://api.supabase.com/v1/projects/akbnfovjdcobifeupvbn/functions/heidi-reflect" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d @- << 'EOF'
{
  "slug": "heidi-reflect",
  "name": "heidi-reflect",
  "source": "$(cat supabase/functions/heidi-reflect/index.ts | sed 's/"/\\"/g')",
  "verify_jwt": false
}
EOF
```

### Method 3: Using Supabase CLI (If Network Issues Resolve)

```bash
# Set the secret in your .env file first:
# HEIDI_REFLECT_SECRET=your-generated-secret

# Deploy with --no-verify-jwt flag
supabase functions deploy heidi-reflect --no-verify-jwt

# Or with explicit project ref
supabase functions deploy heidi-reflect --project-ref akbnfovjdcobifeupvbn --no-verify-jwt
```

## Post-Deployment Verification

### 1. Test the Function Directly

```bash
# Replace with your actual secret
HEIDI_SECRET="your-secret-here"

# Test the endpoint
curl -X POST "https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/heidi-reflect" \
  -H "Content-Type: application/json" \
  -H "x-heidi-secret: $HEIDI_SECRET" \
  -d '{"window_minutes": 10}'
```

Expected response:
```json
{
  "ok": true,
  "reflection": {
    "correlation_id": "...",
    "insights_generated": 3,
    "adaptations_identified": 2,
    "confidence_updates": 1
  }
}
```

### 2. Verify Database Logs

Run this SQL in Supabase SQL Editor:

```sql
-- Check recent HTTP responses
SELECT 
  created,
  status_code,
  error_msg
FROM net._http_response
WHERE created > now() - interval '15 minutes'
ORDER BY created DESC
LIMIT 10;
```

**Success criteria:** New entries show `status_code = 200`

### 3. Check Cron Job Status

```sql
-- Verify cron is targeting correct endpoint
SELECT 
  jobid,
  jobname,
  command
FROM cron.job 
WHERE jobname = 'heidi-reflect-every-10-min';
```

Expected: Command should reference `heidi-reflect` (not `hydi-reflect`)

## Environment Variables to Set

Add these to your Supabase project:

| Variable | Value | Required |
|----------|-------|----------|
| `HEIDI_REFLECT_SECRET` | Random 64-char hex string | ✅ Yes |
| `SUPABASE_URL` | https://akbnfovjdcobifeupvbn.supabase.co | ✅ Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service role key | ✅ Yes |
| `REDIS_URL` | Redis connection string | Optional |

## Testing the Complete Flow

After deployment, verify the full loop:

1. **Ingest an event:**
```bash
curl -X POST "https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/heidi-ingest-event" \
  -H "Content-Type: application/json" \
  -d '{
    "actor": "test-system",
    "event_type": "task.completed",
    "payload": {"duration_ms": 1500, "success": true}
  }'
```

2. **Trigger reflection manually:**
```bash
curl -X POST "https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/heidi-reflect" \
  -H "Content-Type: application/json" \
  -H "x-heidi-secret: $HEIDI_SECRET" \
  -d '{"window_minutes": 10}'
```

3. **Check results:**
```sql
-- Verify insights were generated
SELECT * FROM heidi_insights 
ORDER BY created_at DESC 
LIMIT 5;

-- Check adaptations queued
SELECT * FROM heidi_adaptation_queue 
WHERE status = 'queued'
ORDER BY created_at DESC 
LIMIT 5;
```

## Troubleshooting

### Still getting 401 errors?

1. Verify `HEIDI_REFLECT_SECRET` is set in Supabase environment variables
2. Ensure header name is exactly `x-heidi-secret` (case-sensitive)
3. Check that `verify_jwt = false` is set in config.toml
4. Verify the function was redeployed after config changes

### Cron still failing?

1. Check cron command is calling correct endpoint:
```sql
SELECT * FROM cron.job 
WHERE jobname LIKE '%heidi%' OR command LIKE '%heidi%';
```

2. Update cron if needed:
```sql
SELECT cron.unschedule('heidi-reflect-every-10-min');
SELECT cron.schedule('heidi-reflect-every-10-min', '*/10 * * * *', 
  $$SELECT net.http_post(
    url:='https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/heidi-reflect',
    headers:='{"x-heidi-secret": "YOUR_SECRET"}'::jsonb,
    body:='{"window_minutes": 10}'::jsonb
  )$$);
```

### Adaptations not executing?

1. Check adaptation queue table exists:
```sql
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_name = 'heidi_adaptation_queue'
);
```

2. If missing, create it:
```sql
CREATE TABLE IF NOT EXISTS heidi_adaptation_queue (
  id TEXT PRIMARY KEY,
  insight_id TEXT,
  action_type TEXT,
  config JSONB,
  confidence FLOAT,
  auto_safe BOOLEAN,
  status TEXT DEFAULT 'queued',
  result JSONB,
  error TEXT,
  execution_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  executed_at TIMESTAMPTZ,
  escalation_reason TEXT
);
```

## Files Changed Summary

1. **supabase/functions/heidi-reflect/index.ts** - Simplified auth, added adaptation logic
2. **supabase/config.toml** - Added `verify_jwt = false` for heidi-reflect
3. **modules/adaptation-executor.js** - NEW: Executes safe adaptations
4. **src/server.js** - Added AdaptationExecutor, structured model logging

## Next Steps After Deployment

1. ✅ Verify HTTP 200 responses in `net._http_response`
2. ✅ Monitor `heidi_insights` table for generated insights
3. ✅ Check `heidi_adaptation_queue` for pending adaptations
4. ✅ Review structured model logs in application logs
5. ✅ Monitor reflection cycle timing (should be ~10 min intervals)

## Success Metrics

When fully operational:
- Reflection cycles complete every 10 minutes
- Insights generated from event patterns
- Safe adaptations auto-execute (confidence > 0.7)
- Model performance logged in structured format
- Zero 401 errors in `net._http_response`
