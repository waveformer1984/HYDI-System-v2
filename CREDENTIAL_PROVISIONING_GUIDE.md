# Credential Provisioning Guide

## The One Answer: How does the owner add a credential?

**Drop it in `.env.local`. That's it.**

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

The running daemon re-reads `.env.local` on every cycle (every 60 seconds by default).
It picks up new env vars **without a restart**. You do NOT need to run `keys-cli.ts provision`
or any other command to make the daemon see the credential.

### Does `keys-cli.ts provision` conflict?

No. `keys-cli.ts provision` is for **programmatic provisioning** (e.g., when the Key
Management Service rotates a key and writes the new value to `.env.local`). It is NOT
the primary owner flow. The primary owner flow is always: **edit `.env.local`, wait up
to 60 seconds, run `verify-credential.ts` to confirm.**

### Does the KeyManagementService/EnvVarVault conflict?

No. `EnvVarVault.retrieve('STRIPE_SECRET_KEY')` reads from `process.env.STRIPE_SECRET_KEY`.
When the daemon loads `.env.local`, the value enters `process.env`. Both the existing
`EnhancedCredentialProbes` and the new `KeyManagementService` read from the same
`process.env`. They are complementary layers, not competing flows.

---

## The Single Command: verify-credential.ts

After adding a credential to `.env.local`, run ONE command:

```
npx tsx scripts/verify-credential.ts <provider>
```

This command does three things in sequence:

1. **(a) Confirms the daemon picked it up without a restart** — re-reads `.env.local`
   (same logic the daemon uses every cycle) and reports whether the env vars are now
   in `process.env`.

2. **(b) Confirms the capability transitions from BLOCKED → READY** — runs the
   `CapabilityHealthManager` probe, which makes a **real API call** to the provider
   to verify the key is valid. This is NOT a string presence check. If the key is
   fake/expired/revoked, the probe returns `DEGRADED`, not `READY`.

3. **(c) Runs one safe, reversible, test-mode action** against the real provider:
   - **Stripe**: creates a test-mode PaymentIntent ($0.50) and immediately cancels it
   - **SendGrid/SMTP**: sends one test email to the owner's own address
   - **Google Places**: runs one read-only nearby search query (no side effects)

### Exit codes

- `0` = READY, safe action succeeded
- `1` = BLOCKED, DEGRADED, or safe action failed
- `2` = script error (bad args, missing module)

---

## Copy-Pasteable Checklist: All Three Providers

### Stripe

```bash
# 1. Add to .env.local:
#    STRIPE_SECRET_KEY=sk_test_your_real_test_key_here
#    STRIPE_WEBHOOK_SECRET=whsec_your_real_webhook_secret_here

# 2. Verify (wait up to 60 seconds if daemon is running, or run immediately):
npx tsx scripts/verify-credential.ts stripe

# 3. Expected output:
#    Step (a): ✅ Required env vars present: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
#    Step (b): State: READY — Stripe API verified — balance available: $X.XX usd
#    Step (c): Created and canceled PaymentIntent pi_... — key can create charges
#    ✅ RESULT: READY — credential is valid and the safe action succeeded
```

### Email (SendGrid or Gmail SMTP)

```bash
# Option A — SendGrid:
#    Add to .env.local:
#    SENDGRID_API_KEY=SG.your_real_key_here
#
# Option B — Gmail SMTP:
#    Add to .env.local:
#    SMTP_HOST=smtp.gmail.com
#    SMTP_PORT=587
#    SMTP_USER=your@gmail.com
#    SMTP_PASS=your_16_char_app_password

# Verify:
npx tsx scripts/verify-credential.ts email

# Expected output:
#    Step (a): ✅ Required env vars present: SENDGRID_API_KEY
#    Step (b): State: READY — SendGrid API verified — account accessible
#    Step (c): SendGrid accepted email for delivery to ... (HTTP 202)
#    ✅ RESULT: READY — credential is valid and the safe action succeeded
```

### Google Places

```bash
# 1. Add to .env.local:
#    GOOGLE_PLACES_API_KEY=AIzaSy_your_real_key_here

# 2. Verify:
npx tsx scripts/verify-credential.ts google_places

# 3. Expected output:
#    Step (a): ✅ Required env vars present: GOOGLE_PLACES_API_KEY
#    Step (b): State: READY — Google Places API verified — returned N results
#    Step (c): Google Places query returned N results (top: ...). Key can run searches.
#    ✅ RESULT: READY — credential is valid and the safe action succeeded
```

---

## Negative Test: Proving the system rejects fake keys

Before handing the system a real key, you can prove it correctly rejects fake keys:

```bash
# This injects format-valid but FAKE keys and confirms the system reports DEGRADED, not READY:
npx tsx scripts/verify-credential.ts stripe --negative-test
npx tsx scripts/verify-credential.ts email --negative-test
npx tsx scripts/verify-credential.ts google_places --negative-test
```

**Expected result for all three:**
```
Step (b): State: DEGRADED
✅ NEGATIVE TEST PASSED — fake key correctly rejected as DEGRADED
```

This proves the system calls the real provider API and rejects invalid keys. It does
NOT false-READY on string presence alone.

### Verified negative test results (2026-01-23):

| Provider | Fake key | API response | System result |
|----------|----------|--------------|---------------|
| Stripe | `sk_test_dummy...wxyz` | 401 Invalid API Key | DEGRADED ✅ |
| SendGrid | `SG.dummy...dummy` | 401 Unauthorized | DEGRADED ✅ |
| Google Places | `AIzaSyDummy...wxyz` | REQUEST_DENIED | DEGRADED ✅ |

All three negative tests passed — the system correctly rejected every fake key.

---

## What happens behind the scenes

When the owner adds `STRIPE_SECRET_KEY=sk_test_...` to `.env.local`:

1. **Within 60 seconds**, the daemon's next cycle re-reads `.env.local`
   (`scripts/heidi-daemon.ts` line 299-314). New env vars are loaded into
   `process.env` without overwriting existing values.

2. `CredentialRunbookRegistry.getNewlyResolved()` detects the transition
   from missing → present and records the resolution timestamp.

3. The daemon calls `bridge.capabilityHealthManager.checkCapability('commercial.stripe')`,
   which runs `createStripeVerifyProbe().probe()` — a real `GET /v1/balance` call
   to the Stripe API.

4. If the API returns 200, the capability transitions from `BLOCKED` → `READY`
   with evidence: `"Stripe API verified — balance available: $X.XX usd"`.

5. If the API returns 401 (invalid key), the capability transitions to `DEGRADED`
   with evidence: `"Stripe API returned 401: Invalid API Key provided"`.

6. The daemon logs: `[daemon] 📤 Credential resolution detected: stripe — triggering re-verification`
   and `[daemon] ✅ Re-verified commercial.stripe after credential resolution`.

7. The acquisition engine runs for any still-blocked capabilities and escalates
   those that remain blocked.

**No restart required. No manual provisioning command required. Just edit `.env.local`.**
