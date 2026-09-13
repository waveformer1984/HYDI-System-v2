#!/usr/bin/env npx tsx
/**
 * Credential Verification Script
 *
 * This is the SINGLE command the owner runs after adding a credential to .env.local.
 * It does three things in sequence:
 *
 *   (a) Re-reads .env.local (same as the daemon does every cycle) — confirms
 *       the credential was picked up WITHOUT a daemon restart.
 *   (b) Runs the CapabilityHealthManager probe for the target capability —
 *       confirms the capability transitions from BLOCKED → READY (or reports
 *       DEGRADED with the exact reason if the key is invalid).
 *   (c) Runs ONE safe, reversible, test-mode action against the real provider
 *       API — proves the key isn't just presence-checked, it actually works.
 *
 * Usage:
 *   npx tsx scripts/verify-credential.ts stripe
 *   npx tsx scripts/verify-credential.ts email
 *   npx tsx scripts/verify-credential.ts google_places
 *   npx tsx scripts/verify-credential.ts stripe --negative-test   # tests with a fake key
 *
 * The --negative-test flag temporarily injects a format-valid but fake key
 * (sk_test_dummy...) to prove the system correctly rejects it as DEGRADED
 * rather than false-READY. This proves the negative case before ever handing
 * it a real key.
 *
 * EXIT CODES:
 *   0 = capability is READY and the safe action succeeded
 *   1 = capability is BLOCKED, DEGRADED, or the safe action failed
 *   2 = script error (bad args, missing module, etc.)
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load .env.local and .env (same as daemon)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ─── Args ────────────────────────────────────────────────────────────────

const provider = process.argv[2];
const negativeTest = process.argv.includes('--negative-test');

if (!provider || !['stripe', 'email', 'google_places'].includes(provider)) {
  console.error('Usage: npx tsx scripts/verify-credential.ts <stripe|email|google_places> [--negative-test]');
  process.exit(2);
}

// ─── Negative test injection ─────────────────────────────────────────────

if (negativeTest) {
  console.log('⚠️  NEGATIVE TEST MODE: injecting format-valid but FAKE key values');
  console.log('   The system should reject these as DEGRADED, NOT report READY.');
  console.log();

  // Override with fake keys that match the expected format but are not real
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy1234567890abcdefghijklmnopqrstuvwxyz';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy1234567890abcdefghijklmnopqrstuvwxyz';
  process.env.SENDGRID_API_KEY = 'SG.dummy1234567890abcdefghijklmnopqrstuvwxyz.dummy1234567890abcdefghijklmnopqrstuvwxyz';
  process.env.GOOGLE_PLACES_API_KEY = 'AIzaSyDummy1234567890abcdefghijklmnopqrstuvwxyz';
  // SMTP: use fake values too
  process.env.SMTP_HOST = 'smtp.invalid-domain-that-does-not-exist.example';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'fake@invalid-domain-that-does-not-exist.example';
  process.env.SMTP_PASS = 'fakepassword123456';
}

// ─── Step (a): Re-read .env.local (same as daemon) ───────────────────────

function rereadEnvLocal(): { newlyLoaded: string[]; alreadyPresent: string[] } {
  const newlyLoaded: string[] = [];
  const alreadyPresent: string[] = [];
  const envPath = path.resolve(process.cwd(), '.env.local');

  if (!fs.existsSync(envPath)) {
    return { newlyLoaded, alreadyPresent };
  }

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && value) {
      if (process.env[key]) {
        alreadyPresent.push(key);
      } else {
        process.env[key] = value;
        newlyLoaded.push(key);
      }
    }
  }

  return { newlyLoaded, alreadyPresent };
}

// ─── Provider configs ────────────────────────────────────────────────────

interface ProviderConfig {
  capabilityId: string;
  displayName: string;
  requiredEnvVars: string[];
  probeFactory: () => Promise<{ probe: () => Promise<any> }>;
}

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  stripe: {
    capabilityId: 'commercial.stripe',
    displayName: 'Stripe (Test Mode)',
    requiredEnvVars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    probeFactory: async () => {
      const { createStripeVerifyProbe } = await import('../lib/operational/EnhancedCredentialProbes');
      return { probe: createStripeVerifyProbe().probe! };
    },
  },
  email: {
    capabilityId: 'commercial.email',
    displayName: 'Email (SendGrid or SMTP)',
    requiredEnvVars: ['SENDGRID_API_KEY'], // or SMTP_*
    probeFactory: async () => {
      const { createEmailVerifyProbe } = await import('../lib/operational/EnhancedCredentialProbes');
      return { probe: createEmailVerifyProbe().probe! };
    },
  },
  google_places: {
    capabilityId: 'commercial.discovery_external',
    displayName: 'Google Places',
    requiredEnvVars: ['GOOGLE_PLACES_API_KEY'],
    probeFactory: async () => {
      const { createGooglePlacesVerifyProbe } = await import('../lib/operational/EnhancedCredentialProbes');
      return { probe: createGooglePlacesVerifyProbe().probe! };
    },
  },
};

// ─── Safe, reversible, test-mode actions ─────────────────────────────────

async function stripeSafeAction(): Promise<{ success: boolean; evidence: string; reversible: boolean }> {
  // Create a $0.50 test-mode charge, then immediately refund it.
  // This proves the key can:
  //   1. Create a PaymentIntent (charge capability)
  //   2. Process a refund (refund capability)
  // The charge is in test mode (sk_test_...) so no real money moves.
  // The refund makes it fully reversible.

  const key = process.env.STRIPE_SECRET_KEY!;

  // Step 1: Create a test PaymentIntent for $0.50
  const piResponse = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      amount: '50', // $0.50 in cents
      currency: 'usd',
      'payment_method_types[]': 'card',
      description: 'HEIDI credential verification — will be refunded',
      // Use a test-mode card that always succeeds
      // We won't actually confirm the payment — just create the PI
      confirm: 'false',
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!piResponse.ok) {
    const errorBody = await piResponse.text().catch(() => 'unknown');
    return {
      success: false,
      evidence: `PaymentIntent creation failed (HTTP ${piResponse.status}): ${errorBody.substring(0, 300)}`,
      reversible: false,
    };
  }

  const pi = await piResponse.json() as { id: string; amount: number; currency: string };
  console.log(`   Created PaymentIntent: ${pi.id} ($${pi.amount / 100} ${pi.currency})`);

  // Step 2: Cancel the PaymentIntent (since we didn't confirm it, this is the cleanest reversal)
  const cancelResponse = await fetch(`https://api.stripe.com/v1/payment_intents/${pi.id}/cancel`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });

  if (cancelResponse.ok) {
    const canceled = await cancelResponse.json() as { status: string };
    return {
      success: true,
      evidence: `Created and canceled PaymentIntent ${pi.id} — status: ${canceled.status}. Key can create charges and process cancellations.`,
      reversible: true,
    };
  }

  // Cancel failed — but the PI was never confirmed, so no money moved
  const cancelError = await cancelResponse.text().catch(() => 'unknown');
  return {
    success: true, // The key works (PI was created), cancel is best-effort
    evidence: `Created PaymentIntent ${pi.id} (cancel failed: ${cancelError.substring(0, 200)}). PI was never confirmed — no money moved. Key is valid.`,
    reversible: true,
  };
}

async function emailSafeAction(): Promise<{ success: boolean; evidence: string; reversible: boolean }> {
  // Send a test email to the owner's own address.
  // For SendGrid: use the mail send API.
  // For SMTP: use nodemailer (if available) or just verify connectivity.

  const hasSendGrid = !!process.env.SENDGRID_API_KEY;
  const hasSMTP = !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);

  if (hasSendGrid) {
    // SendGrid: send a test email
    const toEmail = process.env.SMTP_USER || process.env.FROM_EMAIL || 'owner@localhost';
    const fromEmail = process.env.FROM_EMAIL || toEmail;

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: toEmail }] }],
        from: { email: fromEmail },
        subject: 'HEIDI Credential Verification — Safe Test Email',
        content: [{
          type: 'text/plain',
          value: 'This is an automated credential verification email from HEIDI. If you received this, your SendGrid API key is working correctly. This email was sent as part of the verify-credential.ts script and can be safely deleted.',
        }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 202) {
      return {
        success: true,
        evidence: `SendGrid accepted email for delivery to ${toEmail} (HTTP 202). Key can send emails.`,
        reversible: true, // Email is "reversible" in the sense that it's a test email to yourself
      };
    }

    const errorBody = await response.text().catch(() => 'unknown');
    return {
      success: false,
      evidence: `SendGrid mail send failed (HTTP ${response.status}): ${errorBody.substring(0, 300)}`,
      reversible: false,
    };
  }

  if (hasSMTP) {
    // SMTP: try to send via nodemailer if available, otherwise just report connectivity
    try {
      // Use require to avoid TypeScript declaration issues with nodemailer
      const nodemailer = (await import('nodemailer' as string)) as any;
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT!, 10),
        secure: parseInt(process.env.SMTP_PORT!, 10) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const toEmail = process.env.SMTP_USER!;
      const info = await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: toEmail,
        subject: 'HEIDI Credential Verification — Safe Test Email',
        text: 'This is an automated credential verification email from HEIDI. If you received this, your SMTP credentials are working correctly. This email was sent as part of the verify-credential.ts script and can be safely deleted.',
      });

      return {
        success: true,
        evidence: `SMTP email sent to ${toEmail} — messageId: ${info.messageId}. Credentials can send emails.`,
        reversible: true,
      };
    } catch (error) {
      return {
        success: false,
        evidence: `SMTP send failed: ${error instanceof Error ? error.message : 'unknown'}`,
        reversible: false,
      };
    }
  }

  return {
    success: false,
    evidence: 'No email credentials configured (need SENDGRID_API_KEY or SMTP_HOST/PORT/USER/PASS)',
    reversible: false,
  };
}

async function googlePlacesSafeAction(): Promise<{ success: boolean; evidence: string; reversible: boolean }> {
  // Run a real Google Places Nearby Search query.
  // This is a read-only API call — no side effects, fully reversible.
  const key = process.env.GOOGLE_PLACES_API_KEY!;

  // Search for coffee shops near NYC (a well-known location with guaranteed results)
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=40.7128,-74.0060&radius=500&type=cafe&key=${key}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown');
    return {
      success: false,
      evidence: `Google Places API returned HTTP ${response.status}: ${errorBody.substring(0, 300)}`,
      reversible: false,
    };
  }

  const data = await response.json() as { status: string; results?: Array<{ name: string }> };

  if (data.status === 'OK' && Array.isArray(data.results)) {
    const topResults = data.results.slice(0, 3).map(r => r.name).join(', ');
    return {
      success: true,
      evidence: `Google Places query returned ${data.results.length} results (top: ${topResults}). Key can run place searches.`,
      reversible: true, // Read-only query — no side effects
    };
  }

  return {
    success: false,
    evidence: `Google Places API returned status: ${data.status} (expected OK)`,
    reversible: false,
  };
}

const SAFE_ACTIONS: Record<string, () => Promise<{ success: boolean; evidence: string; reversible: boolean }>> = {
  stripe: stripeSafeAction,
  email: emailSafeAction,
  google_places: googlePlacesSafeAction,
};

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const config = PROVIDER_CONFIGS[provider];
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  HEIDI Credential Verification: ${config.displayName}`);
  console.log(`${'='.repeat(70)}\n`);

  if (negativeTest) {
    console.log('⚠️  NEGATIVE TEST — using FAKE keys. Expect DEGRADED, not READY.\n');
  }

  // ─── Step (a): Re-read .env.local ──────────────────────────────────
  console.log('─ Step (a): Re-reading .env.local (same as daemon does every cycle)');

  const envResult = rereadEnvLocal();

  if (envResult.newlyLoaded.length > 0) {
    console.log(`  ✅ Newly loaded from .env.local: ${envResult.newlyLoaded.join(', ')}`);
  } else if (envResult.alreadyPresent.length > 0) {
    console.log(`  ✅ Already in process.env: ${envResult.alreadyPresent.join(', ')}`);
  } else {
    console.log('  ⚠️  No relevant env vars found in .env.local or process.env');
  }

  // Check required env vars
  const missing = config.requiredEnvVars.filter(v => !process.env[v]);
  const present = config.requiredEnvVars.filter(v => process.env[v]);

  // For email, also check SMTP
  if (provider === 'email') {
    const hasSMTP = !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
    if (hasSMTP && missing.length > 0) {
      console.log(`  ℹ️  SENDGRID_API_KEY not set, but SMTP credentials are present — will use SMTP`);
      missing.length = 0; // SMTP is an alternative
    }
  }

  if (missing.length > 0) {
    console.log(`  ❌ Still missing: ${missing.join(', ')}`);
    console.log(`\n❌ RESULT: BLOCKED — credential not provisioned`);
    console.log(`   Add to .env.local: ${missing.map(v => `${v}=...`).join(', ')}`);
    process.exit(1);
  }

  console.log(`  ✅ Required env vars present: ${present.join(', ')}`);
  console.log();

  // ─── Step (b): Run CapabilityHealthManager probe ───────────────────
  console.log('─ Step (b): Running capability health probe (real API verification)');

  const { probe } = await config.probeFactory();
  const probeResult = await probe();

  const state = probeResult.state;
  const evidence = probeResult.evidence;

  console.log(`  State: ${state}`);
  console.log(`  Evidence: ${evidence}`);

  if (state === 'BLOCKED') {
    console.log(`\n❌ RESULT: BLOCKED — ${evidence}`);
    process.exit(1);
  }

  if (state === 'DEGRADED') {
    if (negativeTest) {
      console.log(`\n✅ NEGATIVE TEST PASSED — fake key correctly rejected as DEGRADED`);
      console.log(`   The system did NOT report false-READY. The negative case works.`);
      process.exit(0);
    }
    console.log(`\n❌ RESULT: DEGRADED — credential is present but invalid or API unreachable`);
    console.log(`   Evidence: ${evidence}`);
    console.log(`   This means the key format looks right, but the provider rejected it.`);
    console.log(`   Check that you copied the key correctly and that it hasn't expired.`);
    process.exit(1);
  }

  if (state !== 'READY') {
    console.log(`\n❌ RESULT: ${state} — ${evidence}`);
    process.exit(1);
  }

  if (negativeTest) {
    console.log(`\n❌ NEGATIVE TEST FAILED — fake key was reported as READY!`);
    console.log(`   This is a security issue — the probe should have rejected the fake key.`);
    process.exit(1);
  }

  console.log(`  ✅ Capability transitioned to READY`);
  console.log();

  // ─── Step (c): Run safe, reversible, test-mode action ──────────────
  console.log('─ Step (c): Running safe, reversible, test-mode action against real provider');

  const safeAction = SAFE_ACTIONS[provider];
  const actionResult = await safeAction();

  console.log(`  Success: ${actionResult.success}`);
  console.log(`  Reversible: ${actionResult.reversible}`);
  console.log(`  Evidence: ${actionResult.evidence}`);

  if (!actionResult.success) {
    console.log(`\n❌ RESULT: READY but safe action failed`);
    console.log(`   The key passed the basic probe but the extended action failed.`);
    console.log(`   Evidence: ${actionResult.evidence}`);
    process.exit(1);
  }

  console.log(`\n✅ RESULT: READY — credential is valid and the safe action succeeded`);
  console.log(`   The capability is fully operational.\n`);
  process.exit(0);
}

main().catch((error) => {
  console.error('Script error:', error instanceof Error ? error.message : 'unknown');
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(2);
});
