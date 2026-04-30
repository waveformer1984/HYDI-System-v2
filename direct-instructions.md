# Quick Instructions to Fix Worker System

## The Problem
Your `.env` file has:
```
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY_HERE"
```

## The Solution

### Step 1: Get Your Service Role Key
1. Go to: https://supabase.com/dashboard/project/wufhlhrbskacneneylqa/settings/api
2. Scroll down to "Project API keys"
3. Copy the **service_role** key (it's a long string starting with `eyJ...`)

### Step 2: Update the .env File
Open `.env` in your editor and replace line 5:
```
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY_HERE"
```
With:
```
SUPABASE_SERVICE_ROLE_KEY="paste_your_actual_key_here"
```

### Step 3: Test It
```bash
node test-single-worker.js
```

If it shows "✅ Test completed successfully!", then run:
```bash
node start-workers.js
```

## Alternative: Use the Interactive Script
If you prefer, run:
```bash
node update-env-key.js
```
And paste your key when prompted.

## What the Service Role Key Looks Like
It should be a JWT token like:
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1ZmhsaHJic2thY25lbmV5bHFhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxMzU2Njg3MCwiZXhwIjoyMDI5MTQyODcwfQ.pBfkSsN_x5-t9y2glOVLCbG2xIzZr3s5cWFLnG3J0q4
```

## Common Issues
- Make sure you're copying the **service_role** key, not the `anon` key
- Don't include extra quotes or spaces
- The key should start with `eyJ`
