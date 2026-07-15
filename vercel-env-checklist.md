# Vercel Environment Variables Master List
# ProtoForge HYDI Monetization Deployment

## ursula-nine.vercel.app
Required environment variables:

```
SUPABASE_URL=https://akbnfovjdcobifeupvbn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<rotate-and-set-from-dashboard-never-commit>
```

## hydi-monitor.vercel.app (or hydi.protoforgeindustries.com)
Required environment variables:

```
# Supabase
SUPABASE_URL=https://akbnfovjdcobifeupvbn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<rotate-and-set-from-dashboard-never-commit>

# Stripe
STRIPE_SECRET_KEY=<rotate-and-set-from-dashboard-never-commit>
STRIPE_WEBHOOK_SECRET_01=<rotate-and-set-from-dashboard-never-commit>

# HYDI Product Price IDs
STRIPE_HYDI_STARTER_PRICE_ID=price_1TPkhsF3prUQPYI3nRk79WQD
STRIPE_HYDI_PRO_PRICE_ID=price_1TPkhtF3prUQPYI3zE6sJy3l
STRIPE_HYDI_ENTERPRISE_PRICE_ID=price_1TPkhtF3prUQPYI3NNPDKzhq

# Site Configuration
NEXT_PUBLIC_SITE_URL=https://hydi.protoforgeindustries.com
```

## Environment Variable Setup Instructions

### 1. Vercel Dashboard Setup
1. Go to https://vercel.com/dashboard
2. Navigate to forgefinder organization
3. Select each project and add environment variables

### 2. Environment Variable Types
- **Production**: Live deployment values
- **Preview**: Staging/preview deployment values  
- **Development**: Local development values

### 3. Required Files to Deploy

#### ursula-nine.vercel.app
- `/api/hydi/sync.js` (from `ursula-api-hydi-sync.js`)

#### hydi-monitor.vercel.app  
- `pages/index.js` or `signup.html` (from `hydi-monitor-signup.html`)
- `/api/checkout.js` (from `hydi-api-checkout.js`)
- `/api/webhook.js` (from `hydi-api-webhook.js`)

### 4. Webhook Configuration
1. In Stripe Dashboard → Webhooks
2. Add endpoint: `https://hydi.protoforgeindustries.com/api/webhook`
3. Events to listen for:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `customer.subscription.deleted`

### 5. Verification Commands

After deployment, verify endpoints:

```bash
# Test Ursula sync endpoint
curl https://ursula-nine.vercel.app/api/hydi/sync

# Test HYDI monitor endpoints
curl https://hydi.protoforgeindustries.com/api/checkout \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"tier":"starter","email":"test@example.com","company":"Test Co"}'
```

## Security Notes

- Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code
- Only use `NEXT_PUBLIC_` prefixed variables in browser
- Ensure webhook secret matches Stripe dashboard exactly
- Use HTTPS for all production endpoints
