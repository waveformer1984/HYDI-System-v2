# Heidi Reflect Deployment Checklist
## Execute these steps to get status_code = 200

---

## STEP 1: Deploy Function via Supabase Dashboard (5 min)

1. Go to https://supabase.com/dashboard/project/akbnfovjdcobifeupvbn
2. Navigate to **Edge Functions** in left sidebar
3. Find `heidi-reflect` function
4. Click **Edit**
5. Replace code with contents of `supabase/functions/heidi-reflect/index.ts`
6. **CRITICAL**: Click **Settings** tab
   - Set **Verify JWT** = `false`
7. Click **Deploy**

---

## STEP 2: Set Environment Variable (2 min)

1. In Supabase Dashboard, go to **Project Settings** → **API** → **Environment Variables**
2. Add:
   - Name: `HEIDI_REFLECT_SECRET`
   - Value: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6` (or generate your own)
3. Click **Save**

---

## STEP 3: Update Cron Job (3 min)

1. Go to **SQL Editor** in Supabase Dashboard
2. Run: `c:\Users\Owner\HYDI_System\update-cron-simple.sql`
3. Or copy/paste this SQL:

```sql
SELECT cron.unschedule('heidi-reflect-every-10-min');

SELECT cron.schedule(
  'heidi-reflect-every-10-min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/heidi-reflect',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-heidi-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'heidi_reflect_secret' ORDER BY created_at DESC LIMIT 1)
    ),
    body := jsonb_build_object('window_minutes', 10),
    timeout_milliseconds := 30000
  );
  $$
);
```

---

## STEP 4: Test Immediately (2 min)

```bash
# Replace with your actual secret from vault
curl -X POST "https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/heidi-reflect" \
  -H "Content-Type: application/json" \
  -H "x-heidi-secret: YOUR_SECRET_HERE" \
  -d '{"window_minutes": 10}'
```

**Expected Response:**
```json
{"ok": true, "reflection": {"correlation_id": "...", "insights_generated": 3}}
```

HTTP Status: **200** ✅

---

## STEP 5: Verify Cron Works (Wait 10 min)

Run this SQL in Supabase SQL Editor:

```sql
SELECT created, status_code, error_msg
FROM net._http_response
WHERE created > now() - interval '15 minutes'
ORDER BY created DESC
LIMIT 5;
```

**Success Criteria:**
- All entries show `status_code = 200`
- No more 401 errors

---

## Files That Changed

- `supabase/functions/heidi-reflect/index.ts` - Simplified auth
- `supabase/config.toml` - Added `verify_jwt = false`
- `modules/adaptation-executor.js` - NEW
- `src/server.js` - Added structured logging
- `update-cron-simple.sql` - NEW

---

## If Still Getting 401

1. Check secret is set: `SELECT * FROM vault.decrypted_secrets WHERE name = 'heidi_reflect_secret';`
2. Verify cron uses same secret: Check `command` column in `cron.job`
3. Confirm function deployed with `verify_jwt = false`

---

## After 200s Confirmed

1. Check insights are being generated:
   ```sql
   SELECT * FROM heidi_insights ORDER BY created_at DESC LIMIT 5;
   ```

2. Verify adaptations queued:
   ```sql
   SELECT * FROM heidi_adaptation_queue WHERE status = 'queued';
   ```

3. Monitor model performance logs in application output
