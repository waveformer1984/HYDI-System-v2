# How to Get the CORRECT Supabase Service Role Key

## ⚠️ Important: You're using the wrong key format!

The key you used (`376cc9c6-dd48-455b-a8ae-b46ccc854b9a`) is a UUID, NOT a Service Role Key.

## The Correct Key Format
A Supabase Service Role Key looks like this:
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1ZmhsaHJic2thY25lbmV5bHFhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxMzU2Njg3MCwiZXhwIjoyMDI5MTQyODcwfQ.some_signature_here
```

## Step-by-Step Instructions

### 1. Go to Supabase Dashboard
Open: https://supabase.com/dashboard/project/wufhlhrbskacneneylqa/settings/api

### 2. Find the Service Role Key
Scroll down to the section titled **"Project API keys"**

You will see two keys:
- `anon` public - NOT this one
- `service_role` - **THIS IS THE ONE YOU NEED**

### 3. Copy the Service Role Key
Click the "copy" button next to the `service_role` key
It should be a very long string starting with `eyJ...`

### 4. Update Your .env File
Open `.env` and change line 5 from:
```
SUPABASE_SERVICE_ROLE_KEY="paste-your-key-here"
```
To:
```
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1ZmhsaHJic2thY25lbmV5bHFhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxMzU2Njg3MCwiZXhwIjoyMDI5MTQyODcwfQ.pBfkSsN_x5-t9y2glOVLCbG2xIzZr3s5cWFLnG3J0q4"
```
(Replace with your actual key)

### 5. Test Again
```bash
node test-single-worker.js
```

## Visual Guide
```
Supabase Dashboard
├── Project: wufhlhrbskacneneylqa
├── Settings → API
└── Project API keys
    ├── anon public (❌ not this)
    └── service_role (✅ COPY THIS ONE)
```

## Common Mistakes
❌ Using a UUID like `376cc9c6-dd48-455b-a8ae-b46ccc854b9a`
❌ Using the `anon` key
❌ Using a database connection string

✅ Use the `service_role` key (JWT token starting with `eyJ`)
