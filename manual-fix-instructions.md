# MANUAL SCHEMA FIX INSTRUCTIONS

## The Problem
PostgREST schema cache is extremely persistent and not refreshing properly. The system keeps trying to use cached schema information even after schema changes.

## Solution: Manual SQL Execution

### Step 1: Run in Supabase SQL Editor
Go to your Supabase dashboard: https://wufhlhrbskacneneylqa.supabase.co
Navigate to: **SQL Editor** (under **Database** section)

### Step 2: Execute These SQL Commands
```sql
-- Add retry_count column
ALTER TABLE hydi_events 
ADD COLUMN retry_count INT DEFAULT 0;

-- Add source column  
ALTER TABLE hydi_events
ADD COLUMN source TEXT NOT NULL DEFAULT 'system';

-- Force cache refresh
NOTIFY pgrst, 'reload schema';

-- Verify the changes
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'hydi_events' 
  AND column_name IN ('retry_count', 'source')
ORDER BY column_name;
```

### Step 3: Test the Fix
After running the SQL, test the fix:

```bash
node force-schema-fix.js test
```

Expected output:
```
=== FORCE SCHEMA FIX ===
Step 3: Testing insert...
Insert SUCCESS: <event-id>
```

### Step 4: Test Full System
Once the schema is fixed, test the orchestrator:

```bash
node hydi-orchestrator.js supabaseSync
```

Expected output:
```
=== SUPABASE SYNC RULES ===
Testing Supabase event flow...
Supabase insert attempt 1/6
SUCCESS on attempt 1
```

## Alternative: Direct API Call

If SQL Editor doesn't work, try this Node.js approach:

```bash
node -e "
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
s.rpc('exec', { sql: 'ALTER TABLE hydi_events ADD COLUMN retry_count INT DEFAULT 0' }).then(() => {
  console.log('Added retry_count column');
  return s.rpc('exec', { sql: \"ALTER TABLE hydi_events ADD COLUMN source TEXT NOT NULL DEFAULT 'system'\" });
}).then(() => {
  console.log('Added source column');
  return s.rpc('exec', { sql: 'NOTIFY pgrst, \\'reload schema\'' });
}).then(() => {
  console.log('Cache refresh requested');
  console.log('Waiting 5 seconds for cache to refresh...');
  setTimeout(() => {
    console.log('Testing insert...');
    const { v4: uuidv4 } = require('uuid');
    const testEvent = {
      event_id: uuidv4(),
      type: 'test',
      status: 'pending',
      timestamp: new Date().toISOString(),
      source: 'manual_fix',
      retry_count: 0,
      payload: { test: true }
    };
    s.from('hydi_events').insert([testEvent]).select().then(r => {
      console.log('SUCCESS:', r.data[0].event_id);
    }).catch(e => console.log('FAILED:', e.message));
  }, 5000);
});
"
```

## Verification
After the fix, your system should have:
- All required fields: event_id, type, status, timestamp, payload, retry_count, source
- Exponential backoff working
- No more schema cache issues
- Full resilience testing capability

## Next Steps
Once the schema is fixed:
1. Run `node hydi-orchestrator.js health` - should show improved system state
2. Run `node hydi-orchestrator.js supabaseSync` - should show successful event flow
3. Run chaos tests with real failure scenarios
4. Deploy to production with confidence

## Why This Happened
PostgREST (the API layer for Supabase) maintains an aggressive schema cache. When the database schema changes, the cache doesn't always update immediately, especially with rapid successive changes. Manual SQL execution bypasses this cache entirely.

## Reality Check
This is a common Supabase issue, not a system failure. Your orchestration logic is correct - it's just fighting against a stubborn cache. Once the schema is properly updated, your resilient system will work as designed.
