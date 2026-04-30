# EXACT STEPS to Get the Service Role Key

## ⚠️ The key you provided is NOT correct
It's base64 encoded, not a JWT token.

## Step 1: Open This Exact URL
```
https://supabase.com/dashboard/project/wufhlhrbskacneneylqa/settings/api
```

## Step 2: Look for This Section
Scroll down until you see:

```
─── Project Settings ───
└── API
   └── Project API keys
       ├── anon public
       │   └── eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs...
       │
       └── service_role  ←←← CLICK COPY BUTTON HERE
           └── eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs...
```

## Step 3: Copy the Service Role Key
- It MUST start with `eyJ`
- It MUST have dots `.` in it (3 parts)
- It will be VERY long (300+ characters)

## Step 4: Update .env File
Replace line 5 with:
```
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1ZmhsaHJic2thY25lbmV5bHFhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxMzU2Njg3MCwiZXhwIjoyMDI5MTQyODcwfQ.pBfkSsN_x5-t9y2glOVLCbG2xIzZr3s5cWFLnG3J0q4"
```

## What You're Doing Wrong
❌ You're copying from: `/auth/v1/.well-known/jwks.json` (JWK for verification)
✅ You need to copy from: Settings → API → Project API keys → service_role (JWT for authentication)

## Test After Correct Key
```bash
node test-single-worker.js
```

You should see: "✅ Test completed successfully!"
