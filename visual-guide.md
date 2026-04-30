# VISUAL GUIDE: Where to Find the Service Role Key

## ❌ NOT This (JWK - JSON Web Key)
```
Discovery URL: https://akbnfovjdcobifeupvbn.supabase.co/auth/v1/.well-known/jwks.json
Public Key: { "x": "kNIYKbaZkMQi08-CDvGocBdUJn0FmBv2ItGAn_H4CQk", ... }
```
This is for verifying JWT signatures, NOT for API access.

## ✅ THIS IS WHAT YOU NEED (Service Role JWT)

### Step 1: Go to Settings
```
https://supabase.com/dashboard/project/wufhlhrbskacneneylqa/settings/api
```

### Step 2: Scroll Down to "Project API keys"
You will see:

```
┌─────────────────────────────────────────────────┐
│ Project API keys                                 │
│                                                 │
│ anon public                                     │
│ eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3Mi... │
│ [Copy]                                          │
│                                                 │
│ service_role  ←←← THIS IS THE ONE!               │
│ eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3Mi... │
│ [Copy] ←←← CLICK HERE                           │
└─────────────────────────────────────────────────┘
```

### Step 3: Click Copy on service_role
The key will look like:
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1ZmhsaHJic2thY25lbmV5bHFhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxMzU2Njg3MCwiZXhwIjoyMDI5MTQyODcwfQ.pBfkSsN_x5-t9y2glOVLCbG2xIzZr3s5cWFLnG3J0q4
```

### Step 4: Replace in .env
Change line 5 from:
```
SUPABASE_SERVICE_ROLE_KEY="eyJ.PASTE.SERVICE_ROLE.KEY.HERE"
```
To:
```
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1ZmhsaHJic2thY25lbmV5bHFhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxMzU2Njg3MCwiZXhwIjoyMDI5MTQyODcwfQ.pBfkSsN_x5-t9y2glOVLCbG2xIzZr3s5cWFLnG3J0q4"
```

## Key Differences:
- ❌ JWK: Has `"x":`, `"y":`, `"alg": "ES256"` - NOT for API access
- ✅ Service Role: Starts with `eyJ`, has dots, is a JWT token

## Test After Updating:
```bash
node test-single-worker.js
```

If successful, run:
```bash
node start-workers.js
```
