# FINAL GUIDE: Get the Correct Supabase Service Role Key

## ❌ What You Have Now
The key you're using: `HydWhDLJytLLPGfwSqw9gag==Nqiwe2vzqhjIeeIEz3UxizW1H`
This is NOT a Service Role Key. It's base64 encoded.

## ✅ What a Service Role Key Looks Like
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1ZmhsaHJic2thY25lbmV5bHFhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxMzU2Njg3MCwiZXhwIjoyMDI5MTQyODcwfQ.pBfkSsN_x5-t9y2glOVLCbG2xIzZr3s5cWFLnG3J0q4
```

## Step-by-Step with Screenshots

### 1. Open the Exact URL
https://supabase.com/dashboard/project/wufhlhrbskacneneylqa/settings/api

### 2. Scroll Down Until You See
```
Project API keys

anon public
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3Mi...

service_role  👈 CLICK COPY HERE
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3Mi...  👈 THIS IS THE KEY
```

### 3. Click the Copy Button Next to "service_role"

### 4. Paste It Into .env
Replace line 5 in .env with:
```
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1ZmhsaHJic2thY25lbmV5bHFhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxMzU2Njg3MCwiZXhwIjoyMDI5MTQyODcwfQ.pBfkSsN_x5-t9y2glOVLCbG2xIzZr3s5cWFLnG3J0q4"
```

## ⚠️ CRITICAL POINTS
- The key MUST start with `eyJ`
- It MUST be the `service_role` key, NOT `anon public`
- It will be VERY long (hundreds of characters)
- It will have dots `.` in the middle (JWT format)

## Test It
After updating .env:
```bash
node test-single-worker.js
```

If successful, you'll see:
```
✅ Test completed successfully!
```

Then run:
```bash
node start-workers.js
```
