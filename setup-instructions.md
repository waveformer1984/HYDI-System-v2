# HYDI Security Patch Setup Instructions

## 🚨 Current Issue
Your `.env` file contains placeholder Supabase credentials:
```
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key-here"
```

## 🔧 Fix Steps

### 1. Get Your Real Supabase Credentials

Go to your Supabase Dashboard → Settings → API:

**Supabase URL:** `https://[your-project-id].supabase.co`
**Service Role Key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (long string starting with `eyJ`)

### 2. Update Your .env File

Replace the placeholder values with your actual credentials:

```bash
# Replace these placeholders:
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key-here"

# With your actual values:
SUPABASE_URL="https://your-actual-project-id.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 3. Apply the Security Patch

Once you've updated the credentials:

```bash
# Apply the security patch
node apply-patch-simple.js
```

### 4. Alternative: Manual Application

If the script doesn't work, apply manually:

1. **Open Supabase Dashboard**
2. **Go to SQL Editor**
3. **Copy contents of** `secure-hydi-rpc-patch.sql`
4. **Execute the SQL**

## 📋 What the Patch Does

✅ **Creates secure RPC functions:**
- `read_current_health()` - Full health record
- `check_system_health()` - Quick status check  
- `get_dashboard_data()` - Dashboard JSON

✅ **Enables security:**
- Row Level Security (RLS) on health table
- Service role only for writes
- Anon/auth can read via secure functions

✅ **Prepares for Heidi integration:**
- Mobile chat can securely read health data
- Local models get health context
- WebSocket server gets real-time updates

## 🧪 Test After Patch

```bash
# Test the new secure functions
curl -X POST "https://your-project.supabase.co/rest/v1/rpc/check_system_health" \
  -H "apikey: your-anon-key" \
  -H "Authorization: Bearer your-anon-key"
```

## 🚀 Launch Heidi Mobile Chat

After patch is applied:

```bash
# Set environment variables
$env:LOCAL_MODEL_URL="http://localhost:11434"
$env:LOCAL_MODEL_NAME="llama2"
$env:LOCAL_MODEL_PROVIDER="ollama"
$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_ANON_KEY="your-anon-key"

# Launch Heidi mobile chat
node launch-heidi-mobile.js
```

Then visit: `http://localhost:3006/heidi-mobile`

---

## 📞 Need Help?

1. Check your Supabase project is active
2. Verify the service role key has correct permissions
3. Ensure the project URL is correct
4. Try manual SQL execution if script fails

The security patch is essential for secure HYDI operations with Heidi mobile chat.
