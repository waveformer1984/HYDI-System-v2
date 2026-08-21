/**
 * Enhanced Credential Probes
 *
 * These probes go beyond checking env var presence — they actually call
 * the external API to verify the credential is valid and working.
 *
 * Each probe:
 *   1. Checks if the env vars are present (fast path)
 *   2. If present, makes a real API call to verify validity
 *   3. Returns READY only if the API call succeeds
 *   4. Returns BLOCKED if env vars are missing
 *   5. Returns DEGRADED if env vars are present but the API call fails
 *
 * This prevents false READY states from invalid/expired credentials.
 */

import type {
  CapabilityProbe,
  CapabilityHealthState,
  BlockerClassification,
} from './CapabilityHealthManager';

// ─── Stripe Probe ─────────────────────────────────────────────────────────

export function createStripeVerifyProbe(): CapabilityProbe {
  return {
    capabilityId: 'commercial.stripe',
    description: 'Stripe payment processing (verified)',
    provider: 'stripe',
    dependencies: [],
    requiredCredentials: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    requiredAuthorization: 'R0',
    verificationProcedure: 'Call Stripe API to retrieve balance — confirms key validity',
    recoveryProcedure: 'Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in .env.local',
    async probe() {
      const missing = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'].filter((k) => !process.env[k]);
      if (missing.length > 0) {
        return {
          state: 'BLOCKED' as CapabilityHealthState,
          evidence: `Missing credentials: ${missing.join(', ')}`,
          lastFailure: new Date().toISOString(),
          failureClassification: 'MISSING_EXTERNAL_CREDENTIAL' as BlockerClassification,
        };
      }

      // Verify the key works by calling the Stripe balance API
      try {
        const key = process.env.STRIPE_SECRET_KEY!;
        const response = await fetch('https://api.stripe.com/v1/balance', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${key}`,
          },
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const balance = await response.json() as { available?: { amount: number; currency?: string }[] };
          const availableAmount = balance.available?.[0]?.amount ?? 0;
          return {
            state: 'READY' as CapabilityHealthState,
            evidence: `Stripe API verified — balance available: ${availableAmount / 100} ${balance.available?.[0]?.currency || 'usd'}`,
            lastSuccessfulVerification: new Date().toISOString(),
            failureClassification: 'NOT_BLOCKED' as BlockerClassification,
          };
        }

        // API returned an error — key is present but invalid
        const errorBody = await response.text().catch(() => 'unknown');
        return {
          state: 'DEGRADED' as CapabilityHealthState,
          evidence: `Stripe API returned ${response.status}: ${errorBody.substring(0, 200)}`,
          lastFailure: new Date().toISOString(),
          failureClassification: 'MISSING_EXTERNAL_CREDENTIAL' as BlockerClassification,
        };
      } catch (error) {
        return {
          state: 'DEGRADED' as CapabilityHealthState,
          evidence: `Stripe API call failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          lastFailure: new Date().toISOString(),
          failureClassification: 'EXTERNAL_SERVICE_UNAVAILABLE' as BlockerClassification,
        };
      }
    },
  };
}

// ─── Email Probe (SMTP verification) ──────────────────────────────────────

export function createEmailVerifyProbe(): CapabilityProbe {
  return {
    capabilityId: 'commercial.email',
    description: 'Email delivery (SendGrid or SMTP, verified)',
    provider: 'sendgrid',
    dependencies: [],
    requiredCredentials: ['SENDGRID_API_KEY'],
    requiredAuthorization: 'R0',
    verificationProcedure: 'Check SMTP connectivity or SendGrid API key validity',
    recoveryProcedure: 'Set SENDGRID_API_KEY or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS in .env.local',
    async probe() {
      const hasSendGrid = !!process.env.SENDGRID_API_KEY;
      const hasSMTP = !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);

      if (!hasSendGrid && !hasSMTP) {
        const missing = ['SENDGRID_API_KEY or SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
        return {
          state: 'BLOCKED' as CapabilityHealthState,
          evidence: `Missing credentials: ${missing.join(', ')}`,
          lastFailure: new Date().toISOString(),
          failureClassification: 'MISSING_EXTERNAL_CREDENTIAL' as BlockerClassification,
        };
      }

      // If SendGrid is configured, verify the API key
      if (hasSendGrid) {
        try {
          const response = await fetch('https://api.sendgrid.com/v3/user/account', {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
            },
            signal: AbortSignal.timeout(10000),
          });

          if (response.ok) {
            return {
              state: 'READY' as CapabilityHealthState,
              evidence: 'SendGrid API verified — account accessible',
              lastSuccessfulVerification: new Date().toISOString(),
              failureClassification: 'NOT_BLOCKED' as BlockerClassification,
            };
          }

          return {
            state: 'DEGRADED' as CapabilityHealthState,
            evidence: `SendGrid API returned ${response.status}`,
            lastFailure: new Date().toISOString(),
            failureClassification: 'MISSING_EXTERNAL_CREDENTIAL' as BlockerClassification,
          };
        } catch (error) {
          return {
            state: 'DEGRADED' as CapabilityHealthState,
            evidence: `SendGrid API call failed: ${error instanceof Error ? error.message : 'unknown'}`,
            lastFailure: new Date().toISOString(),
            failureClassification: 'EXTERNAL_SERVICE_UNAVAILABLE' as BlockerClassification,
          };
        }
      }

      // If SMTP is configured, verify connectivity (connect to the SMTP server)
      if (hasSMTP) {
        try {
          const net = await import('net');
          const host = process.env.SMTP_HOST!;
          const port = parseInt(process.env.SMTP_PORT!, 10);

          return await new Promise((resolve) => {
            const socket = new net.Socket();
            const timeout = setTimeout(() => {
              socket.destroy();
              resolve({
                state: 'DEGRADED' as CapabilityHealthState,
                evidence: `SMTP connection to ${host}:${port} timed out`,
                lastFailure: new Date().toISOString(),
                failureClassification: 'EXTERNAL_SERVICE_UNAVAILABLE' as BlockerClassification,
              });
            }, 10000);

            socket.connect(port, host, () => {
              clearTimeout(timeout);
              socket.destroy();
              resolve({
                state: 'READY' as CapabilityHealthState,
                evidence: `SMTP server reachable at ${host}:${port}`,
                lastSuccessfulVerification: new Date().toISOString(),
                failureClassification: 'NOT_BLOCKED' as BlockerClassification,
              });
            });

            socket.on('error', (err) => {
              clearTimeout(timeout);
              socket.destroy();
              resolve({
                state: 'DEGRADED' as CapabilityHealthState,
                evidence: `SMTP connection to ${host}:${port} failed: ${err.message}`,
                lastFailure: new Date().toISOString(),
                failureClassification: 'EXTERNAL_SERVICE_UNAVAILABLE' as BlockerClassification,
              });
            });
          });
        } catch (error) {
          return {
            state: 'DEGRADED' as CapabilityHealthState,
            evidence: `SMTP check failed: ${error instanceof Error ? error.message : 'unknown'}`,
            lastFailure: new Date().toISOString(),
            failureClassification: 'SOFTWARE_BUG' as BlockerClassification,
          };
        }
      }

      return {
        state: 'BLOCKED' as CapabilityHealthState,
        evidence: 'No email credentials configured',
        lastFailure: new Date().toISOString(),
        failureClassification: 'MISSING_EXTERNAL_CREDENTIAL' as BlockerClassification,
      };
    },
  };
}

// ─── Google Places Probe ──────────────────────────────────────────────────

export function createGooglePlacesVerifyProbe(): CapabilityProbe {
  return {
    capabilityId: 'commercial.discovery_external',
    description: 'External prospect discovery (Google Places, verified)',
    provider: 'google_places',
    dependencies: [],
    requiredCredentials: ['GOOGLE_PLACES_API_KEY'],
    requiredAuthorization: 'R0',
    verificationProcedure: 'Call Google Places API with a test query',
    recoveryProcedure: 'Set GOOGLE_PLACES_API_KEY in .env.local',
    async probe() {
      if (!process.env.GOOGLE_PLACES_API_KEY) {
        return {
          state: 'BLOCKED' as CapabilityHealthState,
          evidence: 'Missing credentials: GOOGLE_PLACES_API_KEY',
          lastFailure: new Date().toISOString(),
          failureClassification: 'MISSING_EXTERNAL_CREDENTIAL' as BlockerClassification,
        };
      }

      // Verify the key works with a real Places API call
      try {
        const key = process.env.GOOGLE_PLACES_API_KEY!;
        // Use the Places Nearby Search to find coffee shops in a test location
        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=40.7128,-74.0060&radius=100&type=cafe&key=${key}`;
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const data = await response.json() as { status?: string; results?: unknown[] };
          if (data.status === 'OK' && Array.isArray(data.results)) {
            return {
              state: 'READY' as CapabilityHealthState,
              evidence: `Google Places API verified — returned ${data.results.length} results for test query`,
              lastSuccessfulVerification: new Date().toISOString(),
              failureClassification: 'NOT_BLOCKED' as BlockerClassification,
            };
          }
          return {
            state: 'DEGRADED' as CapabilityHealthState,
            evidence: `Google Places API returned status: ${data.status}`,
            lastFailure: new Date().toISOString(),
            failureClassification: 'MISSING_EXTERNAL_CREDENTIAL' as BlockerClassification,
          };
        }

        return {
          state: 'DEGRADED' as CapabilityHealthState,
          evidence: `Google Places API returned HTTP ${response.status}`,
          lastFailure: new Date().toISOString(),
          failureClassification: 'MISSING_EXTERNAL_CREDENTIAL' as BlockerClassification,
        };
      } catch (error) {
        return {
          state: 'DEGRADED' as CapabilityHealthState,
          evidence: `Google Places API call failed: ${error instanceof Error ? error.message : 'unknown'}`,
          lastFailure: new Date().toISOString(),
          failureClassification: 'EXTERNAL_SERVICE_UNAVAILABLE' as BlockerClassification,
        };
      }
    },
  };
}

// ─── Twilio Probe ─────────────────────────────────────────────────────────

export function createTwilioVerifyProbe(): CapabilityProbe {
  return {
    capabilityId: 'commercial.sms',
    description: 'SMS delivery (Twilio, verified)',
    provider: 'twilio',
    dependencies: [],
    requiredCredentials: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
    requiredAuthorization: 'R0',
    verificationProcedure: 'Call Twilio API to retrieve account balance',
    recoveryProcedure: 'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in .env.local',
    async probe() {
      const missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'].filter((k) => !process.env[k]);
      if (missing.length > 0) {
        return {
          state: 'BLOCKED' as CapabilityHealthState,
          evidence: `Missing credentials: ${missing.join(', ')}`,
          lastFailure: new Date().toISOString(),
          failureClassification: 'MISSING_EXTERNAL_CREDENTIAL' as BlockerClassification,
        };
      }

      // Verify the credentials work by calling the Twilio balance API
      try {
        const sid = process.env.TWILIO_ACCOUNT_SID!;
        const token = process.env.TWILIO_AUTH_TOKEN!;
        const auth = Buffer.from(`${sid}:${token}`).toString('base64');

        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${auth}`,
          },
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const data = await response.json() as { balance?: string; currency?: string };
          return {
            state: 'READY' as CapabilityHealthState,
            evidence: `Twilio API verified — balance: ${data.balance} ${data.currency || 'USD'}`,
            lastSuccessfulVerification: new Date().toISOString(),
            failureClassification: 'NOT_BLOCKED' as BlockerClassification,
          };
        }

        return {
          state: 'DEGRADED' as CapabilityHealthState,
          evidence: `Twilio API returned ${response.status}`,
          lastFailure: new Date().toISOString(),
          failureClassification: 'MISSING_EXTERNAL_CREDENTIAL' as BlockerClassification,
        };
      } catch (error) {
        return {
          state: 'DEGRADED' as CapabilityHealthState,
          evidence: `Twilio API call failed: ${error instanceof Error ? error.message : 'unknown'}`,
          lastFailure: new Date().toISOString(),
          failureClassification: 'EXTERNAL_SERVICE_UNAVAILABLE' as BlockerClassification,
        };
      }
    },
  };
}
