# Stripe Webhook Permanent Fix - Complete Setup Guide

## Prerequisites
- Stripe Dashboard access
- Vercel Dashboard access
- Supabase CLI installed locally

---

## Step 1: Stripe Dashboard Configuration

### 1.1 Create Webhook Endpoint
1. Log into [Stripe Dashboard](https://dashboard.stripe.com)
2. Navigate to **Developers → Webhooks**
3. Click **+ Add endpoint**
4. Enter endpoint URL:
   ```
   https://heidi-chat-portal.vercel.app/api/webhooks/stripe
   ```
5. Click **Select events** and choose:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
6. Click **Add endpoint**

### 1.2 Copy Webhook Signing Secret
1. In the webhook details page, find **Signing secret**
2. Copy the value (starts with `whsec_`)
3. Save it temporarily - you'll paste it in Step 2

---

## Step 2: Vercel Environment Variables

### Option A: Vercel Dashboard (Web UI)
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select **heidi-chat-portal** project
3. Click **Settings → Environment Variables**
4. Add the following variables:

| Name | Value | Environment |
|------|-------|-------------|
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (from Step 1.2) | Production |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_...` or `pk_test_...` | Production |
| `STRIPE_SECRET_KEY` | `sk_live_...` or `sk_test_...` | Production |

5. Click **Save**
6. Redeploy the project (Vercel will auto-redeploy with new env vars)

### Option B: Vercel CLI (Command Line)

```bash
# Install Vercel CLI if not already installed
npm i -g vercel

# Login to Vercel
vercel login

# Add environment variables
vercel env add STRIPE_WEBHOOK_SECRET production
# Paste your whsec_... value when prompted

vercel env add STRIPE_PUBLISHABLE_KEY production
# Paste your pk_... value when prompted

vercel env add STRIPE_SECRET_KEY production
# Paste your sk_... value when prompted

# Pull env vars locally
vercel env pull

# Redeploy
vercel --prod
```

---

## Step 3: Deploy Supabase Edge Function

The Edge Function is already fixed at:
`supabase/functions/stripe-webhook/index.ts`

### 3.1 Deploy the Function

```bash
# Navigate to project root
cd C:\Users\Owner\HYDI_System

# Deploy the stripe-webhook function
supabase functions deploy stripe-webhook

# Or if you need to link first:
supabase link --project-ref akbnfovjdcobifeupvbn
supabase functions deploy stripe-webhook
```

### 3.2 Verify Function Deployment

Check that the function is live:
```bash
# Get function URL
supabase functions list

# Should show:
# stripe-webhook  https://akbnfovjdcobifeupvbn.supabase.co/functions/v1/stripe-webhook
```

---

## Step 4: Test the Webhook

### 4.1 Send Test Event from Stripe Dashboard

1. In Stripe Dashboard → Developers → Webhooks
2. Find your endpoint
3. Click **Send test event**
4. Select `payment_intent.succeeded`
5. Click **Send test event**

### 4.2 Check Function Logs

```bash
# View real-time logs
supabase functions logs stripe-webhook --tail
```

Look for:
```
[WEBHOOK] Processing event: payment_intent.succeeded (ID: evt_test_...)
[WEBHOOK] Successfully processed event: payment_intent.succeeded
```

### 4.3 Verify Database Entry

In Supabase SQL Editor:
```sql
SELECT event_id, type, status, processed, created_at
FROM public.webhook_events
ORDER BY created_at DESC
LIMIT 5;
```

Expected result:
- `status`: 'completed'
- `event_id`: matches Stripe test event ID

---

## Step 5: Verification PowerShell Script

Save this as `test-stripe-webhook.ps1` and run it:

```powershell
# Stripe Webhook Test Script
$ErrorActionPreference = "Stop"

Write-Host "=== Stripe Webhook Verification ===" -ForegroundColor Cyan

# Check Vercel env vars
Write-Host "`n[1] Checking Vercel Environment Variables..." -ForegroundColor Yellow
$vercelVars = vercel env ls 2>&1

if ($vercelVars -match "STRIPE_WEBHOOK_SECRET") {
    Write-Host "✓ STRIPE_WEBHOOK_SECRET found" -ForegroundColor Green
} else {
    Write-Host "✗ STRIPE_WEBHOOK_SECRET NOT found" -ForegroundColor Red
}

if ($vercelVars -match "STRIPE_PUBLISHABLE_KEY") {
    Write-Host "✓ STRIPE_PUBLISHABLE_KEY found" -ForegroundColor Green
} else {
    Write-Host "✗ STRIPE_PUBLISHABLE_KEY NOT found" -ForegroundColor Red
}

# Check Supabase function
Write-Host "`n[2] Checking Supabase Edge Function..." -ForegroundColor Yellow
$functions = supabase functions list 2>&1

if ($functions -match "stripe-webhook") {
    Write-Host "✓ stripe-webhook function deployed" -ForegroundColor Green
} else {
    Write-Host "✗ stripe-webhook function NOT deployed" -ForegroundColor Red
}

# Test webhook endpoint (requires webhook secret for signature)
Write-Host "`n[3] Testing Webhook Endpoint..." -ForegroundColor Yellow

$payload = @{
    id = "evt_test_001"
    type = "payment_intent.succeeded"
    data = @{
        object = @{
            id = "pi_test_001"
            amount = 2000
            currency = "usd"
        }
    }
} | ConvertTo-Json -Depth 3

try {
    $response = Invoke-WebRequest `
        -Uri "https://heidi-chat-portal.vercel.app/api/webhooks/stripe" `
        -Method POST `
        -Headers @{
            "Content-Type" = "application/json"
            "stripe-signature" = "t=1234567890,v1=test_signature"
        } `
        -Body $payload `
        -ErrorAction Stop
    
    Write-Host "✓ Webhook endpoint responded" -ForegroundColor Green
    Write-Host "  Status: $($response.StatusCode)" -ForegroundColor Gray
    Write-Host "  Response: $($response.Content)" -ForegroundColor Gray
} catch {
    Write-Host "✗ Webhook endpoint error" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = $reader.ReadToEnd()
        Write-Host "  Error body: $body" -ForegroundColor Yellow
    } else {
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host "`n=== Verification Complete ===" -ForegroundColor Cyan
```

---

## Troubleshooting

### Issue: "Invalid signature" errors
**Fix**: Ensure `STRIPE_WEBHOOK_SECRET` in Vercel matches exactly what Stripe Dashboard shows. Regenerate in Stripe if needed.

### Issue: "No such event" in database
**Fix**: Check `webhook_events` table exists and RPC function `claim_webhook_event` is deployed.

### Issue: Function timeout
**Fix**: The function has 10s timeout. Complex operations should queue jobs, not block.

### Issue: Duplicate events processed
**Fix**: The idempotency logic is in place via `claim_webhook_event` RPC. Check database for existing event IDs.

---

## Complete Checklist

- [ ] Stripe webhook endpoint created in Dashboard
- [ ] Webhook events selected (payment_intent.succeeded, etc.)
- [ ] Signing secret copied (whsec_...)
- [ ] Vercel env vars added (STRIPE_WEBHOOK_SECRET, etc.)
- [ ] Project redeployed on Vercel
- [ ] Supabase function deployed (`supabase functions deploy stripe-webhook`)
- [ ] Test event sent from Stripe Dashboard
- [ ] Logs show "Successfully processed event"
- [ ] Database row exists in `webhook_events` table
- [ ] Run PowerShell verification script

**Once all checked → Webhook integration is complete and locked.**
