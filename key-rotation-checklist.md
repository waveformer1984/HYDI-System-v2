# Key Rotation Checklist
# Follow this EXACTLY to avoid breaking everything

## 🚨 CRITICAL: DO NOT ROTATE ALL KEYS AT ONCE
# Rotate one service at a time, test, then proceed

## 📋 STEP 1: SUPABASE KEYS
### Service Role Key (if needed)
- [ ] Go to Supabase Dashboard → Settings → API
- [ ] Click "Regenerate" next to service_role
- [ ] Copy NEW key immediately
- [ ] Update .env file: SUPABASE_SERVICE_ROLE_KEY
- [ ] Test: `node verify-keys-status.js`
- [ ] Update Edge Function secrets: `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=NEW_KEY`

### Anon Key (if needed)
- [ ] Go to Supabase Dashboard → Settings → API  
- [ ] Click "Regenerate" next to anon
- [ ] Copy NEW key immediately
- [ ] Update .env file: SUPABASE_ANON_KEY
- [ ] Test: `node verify-keys-status.js`

## 📋 STEP 2: STRIPE KEYS
### Secret Key (if needed)
- [ ] Go to Stripe Dashboard → Developers → API keys
- [ ] Create new secret key (sk_...)
- [ ] Update .env file: STRIPE_SECRET_KEY
- [ ] Update Edge Function secrets: `supabase secrets set STRIPE_SECRET_KEY=NEW_KEY`
- [ ] Test: `./test-api-clean.ps1`

### Webhook Secret (if needed)
- [ ] Go to Stripe Dashboard → Developers → Webhooks
- [ ] Update webhook endpoint with new signing secret
- [ ] Update .env file: STRIPE_WEBHOOK_SECRET_01
- [ ] Update Edge Function secrets: `supabase secrets set STRIPE_WEBHOOK_SECRET_01=NEW_SECRET`

## 📋 STEP 3: OTHER KEYS
### Break Glass Token
- [x] Generate new token
- [x] Update .env file: KEEPER_BREAK_GLASS_TOKEN
- [ ] Update Edge Function secrets (remote only): `supabase secrets set KEEPER_BREAK_GLASS_TOKEN=NEW_TOKEN`

## 📋 STEP 4: VERIFICATION
After EACH key rotation:
- [ ] Run: `node verify-keys-status.js`
- [ ] Run: `./test-api-clean.ps1`
- [ ] Check logs for 401/403 errors
- [ ] Test critical functions manually

## 📋 STEP 5: STABILIZATION
- [ ] Freeze all deployments
- [ ] Monitor for auth failures
- [ ] Document what was changed
- [ ] Create backup of working .env

## 🚨 EMERGENCY ROLLBACK
If everything breaks:
1. Restore .env from backup
2. Redeploy functions with old secrets
3. Test again
4. Fix what broke, then retry rotation

## 📊 CURRENT STATUS
- Service Role Key: ✅ WORKING
- Anon Key: ✅ PRESENT (test has schema issue)
- Stripe Keys: ✅ PRESENT
- Break Glass Token: ✅ PRESENT (local .env/.env.local) — remote Edge Function secrets set pending
