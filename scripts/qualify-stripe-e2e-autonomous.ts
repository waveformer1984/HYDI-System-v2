/**
 * Stripe E2E Autonomous Qualification Runner
 *
 * This is a REAL qualification runner — not a mocked test.
 * It exercises:
 *   - The real Stripe CLI (not a mock)
 *   - A real `stripe listen` process (not a fake)
 *   - Real webhook delivery via `stripe trigger checkout.session.completed`
 *   - Real Stripe signature verification (HMAC-SHA256)
 *   - The real credential lifecycle (extract from CLI, store, validate, clean up)
 *   - A real evidence trail (every transition recorded)
 *
 * Acceptance criterion:
 *   Human intervention occurs only at the Stripe OAuth boundary.
 *   Everything downstream of successful authentication must execute and
 *   verify autonomously.
 *
 * Usage:
 *   npx ts-node scripts/qualify-stripe-e2e-autonomous.ts                  # auto-detect state
 *   npx ts-node scripts/qualify-stripe-e2e-autonomous.ts --phase=unauth   # force unauth phase
 *   npx ts-node scripts/qualify-stripe-e2e-autonomous.ts --phase=auth     # force auth phase
 *
 * Output:
 *   - Machine-readable JSON certification at docs/stripe-e2e-certification.json
 *   - Human-readable report on stdout
 *   - Evidence records in the HYDI EvidenceStore
 *
 * Fail-closed rules:
 *   - If any observation is ambiguous → FAIL, not PASS
 *   - If the CLI state cannot be determined → BLOCKED
 *   - If the webhook secret cannot be captured → BLOCKED
 *   - If the webhook never arrives → BLOCKED
 *   - If signature verification fails → FAIL
 *   - If the credential is live-mode → BLOCKED (never use live for test E2E)
 *   - If the credential is a placeholder → BLOCKED
 *   - Simulated evidence NEVER satisfies EXTERNAL_VERIFIED
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import http from 'http';
import crypto from 'crypto';
import { execSync, spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { createEvidence, getEvidenceStore, type VerificationLevel, type EvidenceBlocker } from '../lib/operational/EvidenceModel';
import { getCredentialSourceManager } from '../lib/operational/CredentialSource';
import { getCredentialStateMachine } from '../lib/operational/CredentialStateMachine';

// ─── Types ───────────────────────────────────────────────────────────────

type CliState = 'NOT_INSTALLED' | 'NOT_AUTHENTICATED' | 'AUTHENTICATED' | 'EXPIRED' | 'INVALID' | 'UNKNOWN';

interface TransitionRecord {
  step: string;
  timestamp: string;
  fromState: string;
  toState: string;
  evidence: string;
  verificationLevel: VerificationLevel;
  result: 'PASS' | 'FAIL' | 'BLOCKED' | 'SIMULATED' | 'UNKNOWN';
  durationMs: number;
}

interface WebhookReceipt {
  received: boolean;
  eventId: string | null;
  eventType: string | null;
  signatureValid: boolean;
  signatureHeader: string | null;
  payloadHash: string | null;
  receivedAt: string | null;
  body: string | null;
}

interface CertificationResult {
  certificationId: string;
  generatedAt: string;
  runId: string;
  phase: 'unauth' | 'auth' | 'auto';
  cliState: CliState;
  cliVersion: string | null;
  accountId: string | null;
  accountMode: 'test' | 'live' | 'unknown';
  blockerOwnership: 'AUTONOMOUS' | 'HUMAN_AUTH_REQUIRED' | 'HUMAN_EXTERNAL_ACTION_REQUIRED' | 'BLOCKED';
  transitions: TransitionRecord[];
  webhookReceipt: WebhookReceipt | null;
  allReceivedWebhooks: { eventId: string | null; eventType: string | null; signatureValid: boolean; payloadHash: string | null; receivedAt: string | null }[];
  checkoutSessionId: string | null;
  stripeEventId: string | null;
  credentialFingerprint: string | null;
  credentialSource: string | null;
  webhookSecretFingerprint: string | null;
  listenerStarted: boolean;
  listenerPid: number | null;
  cleanedUp: boolean;
  humanActionRequest: {
    id: string;
    action: string;
    createdAt: string;
    resolved: boolean;
  } | null;
  recommendation: 'READY' | 'READY_WITH_BLOCKERS' | 'NOT_READY';
  failClosedReason: string | null;
  evidenceIds: string[];
}

// ─── Runner ──────────────────────────────────────────────────────────────

class StripeE2EQualificationRunner {
  private runId: string;
  private correlationId: string;
  private transitions: TransitionRecord[] = [];
  private evidenceIds: string[] = [];
  private listenerProcess: ChildProcess | null = null;
  private listenerWasStarted = false; // Track separately from listenerProcess (which is nulled in cleanup)
  private webhookServer: http.Server | null = null;
  private webhookReceipt: WebhookReceipt = {
    received: false,
    eventId: null,
    eventType: null,
    signatureValid: false,
    signatureHeader: null,
    payloadHash: null,
    receivedAt: null,
    body: null,
  };
  // Track ALL received webhooks — stripe trigger sends multiple events
  // (checkout.session.completed, charge.updated, payment_intent.succeeded, etc.)
  // We must not let a later event overwrite the one we verified.
  private allReceivedWebhooks: WebhookReceipt[] = [];
  // The specific webhook that was signature-verified (locked once verified)
  private verifiedWebhook: WebhookReceipt | null = null;
  private currentWebhookSecret: string | null = null;
  private checkoutSessionId: string | null = null;
  private stripeEventId: string | null = null;
  private credentialFingerprint: string | null = null;
  private credentialSource: string | null = null;
  private cleanedUp = false;
  private failClosedReason: string | null = null;
  private humanActionRequest: CertificationResult['humanActionRequest'] = null;
  private savedEnvKeys: Record<string, string | undefined> = {};

  private phase: 'unauth' | 'auth' | 'auto';

  constructor(phase: 'unauth' | 'auth' | 'auto') {
    this.phase = phase;
    this.runId = randomUUID();
    this.correlationId = `stripe-e2e-runner-${this.runId}`;
  }

  async run(): Promise<CertificationResult> {
    const cliState = await this.detectCliState();
    const cliVersion = this.getCliVersion();
    const accountInfo = this.getAccountInfo();

    // Determine ownership classification
    let ownership: CertificationResult['blockerOwnership'];
    if (cliState === 'AUTHENTICATED' && accountInfo.mode === 'test') {
      ownership = 'AUTONOMOUS';
    } else if (cliState === 'NOT_INSTALLED') {
      ownership = 'BLOCKED';
    } else {
      ownership = 'HUMAN_EXTERNAL_ACTION_REQUIRED';
    }

    // If phase=unauth, force the unauth path even if authenticated
    if (this.phase === 'unauth' && cliState === 'AUTHENTICATED') {
      console.log('[RUNNER] Phase=unauth but CLI is authenticated — simulating unauth by skipping E2E');
      ownership = 'HUMAN_AUTH_REQUIRED';
    }

    // If phase=auth but CLI is not authenticated, fail closed
    if (this.phase === 'auth' && cliState !== 'AUTHENTICATED') {
      this.recordTransition('phase_check', cliState, cliState, 'Phase=auth but CLI is not authenticated', 'BLOCKED', 'BLOCKED');
      this.failClosedReason = `Phase=auth requires authenticated CLI, but state is ${cliState}`;
      ownership = 'HUMAN_EXTERNAL_ACTION_REQUIRED';
      this.createHumanActionRequest(cliState);
    }

    // Execute based on ownership
    if (ownership === 'AUTONOMOUS' && this.phase !== 'unauth') {
      await this.runAuthenticatedE2E();
    } else if (ownership === 'HUMAN_EXTERNAL_ACTION_REQUIRED' || ownership === 'HUMAN_AUTH_REQUIRED' || ownership === 'BLOCKED') {
      await this.runUnauthenticatedFlow(cliState, ownership);
    }

    // Always clean up
    await this.cleanup();

    // Generate certification
    return this.generateCertification(cliState, cliVersion, accountInfo, ownership);
  }

  // ─── CLI State Detection ─────────────────────────────────────────────

  private async detectCliState(): Promise<CliState> {
    const start = Date.now();

    // Step 1: Check if stripe CLI is installed
    try {
      execSync('where stripe 2>NUL', { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      this.recordTransition('cli_detect', 'UNKNOWN', 'NOT_INSTALLED', 'Stripe CLI not found in PATH', 'BLOCKED', 'VERIFIED_INTERNAL');
      return 'NOT_INSTALLED';
    }

    // Step 2: Check if CLI is authenticated by making a real API call
    // Capture both stdout and stderr — the Stripe CLI puts error messages on stderr
    try {
      let stdout = '';
      let stderr = '';
      try {
        stdout = execSync('stripe get /v1/balance 2>&1', {
          encoding: 'utf8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch (err: unknown) {
        // execSync throws on non-zero exit code, but the output is in err.stdout/err.stderr
        const e = err as { stdout?: string; stderr?: string; message?: string };
        stdout = (e.stdout || '').toString().trim();
        stderr = (e.stderr || '').toString().trim();
        if (!stdout && !stderr) {
          stderr = e.message || 'unknown error';
        }
      }

      const combined = `${stdout}\n${stderr}`.trim();

      if (combined.includes('available') || combined.includes('livemode') || combined.includes('pending')) {
        this.recordTransition('cli_auth_check', 'UNKNOWN', 'AUTHENTICATED',
          `CLI authenticated — balance API responded (${Date.now() - start}ms)`, 'PASS', 'VERIFIED_EXTERNAL');
        return 'AUTHENTICATED';
      }

      if (combined.includes('expired') || combined.includes('API key provided has expired')) {
        this.recordTransition('cli_auth_check', 'UNKNOWN', 'EXPIRED',
          'CLI session expired — API key rejected by Stripe', 'BLOCKED', 'VERIFIED_EXTERNAL');
        return 'EXPIRED';
      }

      if (combined.includes('401') || combined.includes('Unauthorized') || combined.includes('authentication')) {
        this.recordTransition('cli_auth_check', 'UNKNOWN', 'NOT_AUTHENTICATED',
          'CLI not authenticated — 401/Unauthorized', 'BLOCKED', 'VERIFIED_EXTERNAL');
        return 'NOT_AUTHENTICATED';
      }

      // Ambiguous response — fail closed
      this.recordTransition('cli_auth_check', 'UNKNOWN', 'UNKNOWN',
        `Ambiguous CLI response: ${combined.substring(0, 120)}`, 'UNKNOWN', 'VERIFIED_INTERNAL');
      this.failClosedReason = `Ambiguous CLI response from /v1/balance: ${combined.substring(0, 120)}`;
      return 'UNKNOWN';
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'unknown';

      if (errMsg.includes('expired') || errMsg.includes('401') || errMsg.includes('Unauthorized')) {
        this.recordTransition('cli_auth_check', 'UNKNOWN', 'EXPIRED',
          `CLI session expired: ${errMsg.substring(0, 80)}`, 'BLOCKED', 'VERIFIED_EXTERNAL');
        return 'EXPIRED';
      }

      if (errMsg.includes('not authenticated') || errMsg.includes('login') || errMsg.includes('config')) {
        this.recordTransition('cli_auth_check', 'UNKNOWN', 'NOT_AUTHENTICATED',
          `CLI not authenticated: ${errMsg.substring(0, 80)}`, 'BLOCKED', 'VERIFIED_INTERNAL');
        return 'NOT_AUTHENTICATED';
      }

      // Ambiguous error — fail closed
      this.recordTransition('cli_auth_check', 'UNKNOWN', 'UNKNOWN',
        `Ambiguous CLI error: ${errMsg.substring(0, 100)}`, 'UNKNOWN', 'VERIFIED_INTERNAL');
      this.failClosedReason = `Ambiguous CLI error: ${errMsg.substring(0, 100)}`;
      return 'UNKNOWN';
    }
  }

  private getCliVersion(): string | null {
    try {
      return execSync('stripe --version 2>NUL', { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  }

  private getAccountInfo(): { accountId: string | null; mode: 'test' | 'live' | 'unknown' } {
    try {
      const config = execSync('stripe config --list 2>NUL', {
        encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      let accountId: string | null = null;
      let mode: 'test' | 'live' | 'unknown' = 'unknown';

      for (const line of config.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('account_id')) {
          accountId = trimmed.split('=')[1]?.trim().replace(/'/g, '') || null;
        }
        if (trimmed.includes('test_mode') && !trimmed.includes('false')) {
          mode = 'test';
        }
        if (trimmed.includes('live_mode') && !trimmed.includes('false')) {
          mode = 'live';
        }
      }

      return { accountId, mode };
    } catch {
      return { accountId: null, mode: 'unknown' };
    }
  }

  // ─── Unauthenticated Flow ────────────────────────────────────────────

  private async runUnauthenticatedFlow(cliState: CliState, ownership: string): Promise<void> {
    console.log(`\n[RUNNER] Unauthenticated flow — CLI state: ${cliState}`);
    console.log('[RUNNER] Creating durable human action request...');
    console.log('[RUNNER] Exiting cleanly as HUMAN_EXTERNAL_ACTION_REQUIRED');
    console.log('[RUNNER] No readiness fabricated.\n');

    this.createHumanActionRequest(cliState);

    this.recordTransition('unauth_flow', cliState, 'HUMAN_EXTERNAL_ACTION_REQUIRED',
      `CLI state ${cliState} requires human action — durable request created`, 'BLOCKED', 'VERIFIED_INTERNAL');
  }

  private createHumanActionRequest(cliState: CliState): void {
    this.humanActionRequest = {
      id: `AR-${randomUUID().substring(0, 8)}`,
      action: cliState === 'NOT_INSTALLED'
        ? 'Install Stripe CLI: https://docs.stripe.com/stripe-cli'
        : cliState === 'EXPIRED'
          ? 'Stripe CLI session expired — run "stripe login" to re-authenticate'
          : 'Complete Stripe CLI browser authentication: run "stripe login" in a terminal and complete the browser OAuth flow',
      createdAt: new Date().toISOString(),
      resolved: false,
    };

    this.recordEvidence('human_action_request', 'BLOCKED',
      `Durable action request created: ${this.humanActionRequest.action}`,
      'VERIFIED_INTERNAL', null);
  }

  // ─── Authenticated E2E Flow ──────────────────────────────────────────

  private async runAuthenticatedE2E(): Promise<void> {
    console.log('\n[RUNNER] Authenticated flow — starting full E2E qualification');

    // Step 1: Obtain and validate the test credential from CLI
    await this.stepObtainTestCredential();

    // Step 2: Start a temporary webhook receiver server
    await this.stepStartWebhookReceiver();

    // Step 3: Start stripe listen
    await this.stepStartStripeListener();

    // Step 4: Capture the webhook secret
    await this.stepCaptureWebhookSecret();

    // Step 5: Configure local environment
    await this.stepConfigureEnvironment();

    // Step 6: Create a real test-mode Checkout Session
    await this.stepCreateCheckoutSession();

    // Step 7: Trigger checkout.session.completed via stripe trigger
    await this.stepTriggerCheckoutEvent();

    // Step 8: Verify webhook delivery
    await this.stepVerifyWebhookDelivery();

    // Step 9: Verify signature
    await this.stepVerifySignature();

    // Step 10: Verify idempotency (no duplicate delivery)
    await this.stepVerifyIdempotency();
  }

  private async stepObtainTestCredential(): Promise<void> {
    const start = Date.now();
    console.log('[STEP 1] Obtaining test credential from CLI...');

    try {
      // Read the test-mode key from the CLI config
      // The CLI stores it after `stripe login`
      const config = execSync('stripe config --list 2>NUL', {
        encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      let testKey: string | null = null;
      for (const line of config.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('test_mode_api_key')) {
          const value = trimmed.split('=')[1]?.trim().replace(/'/g, '');
          if (value && value.startsWith('sk_test_')) {
            testKey = value;
            break;
          }
        }
      }

      if (!testKey) {
        this.recordTransition('obtain_credential', 'AUTHENTICATED', 'BLOCKED',
          'Could not extract test key from CLI config', 'BLOCKED', 'VERIFIED_INTERNAL');
        this.failClosedReason = 'No test_mode_api_key in CLI config despite authenticated state';
        return;
      }

      // Validate the key by making a real API call
      const balanceResult = execSync('stripe get /v1/balance 2>NUL', {
        encoding: 'utf8', timeout: 20000, stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      if (!balanceResult.includes('available') && !balanceResult.includes('livemode')) {
        this.recordTransition('obtain_credential', 'AUTHENTICATED', 'BLOCKED',
          `Test key validation failed — balance API returned: ${balanceResult.substring(0, 80)}`, 'BLOCKED', 'VERIFIED_EXTERNAL');
        this.failClosedReason = 'Test key validation failed';
        return;
      }

      // Verify it's test mode (not live)
      if (balanceResult.includes('"livemode": true') || balanceResult.includes('"livemode":true')) {
        this.recordTransition('obtain_credential', 'AUTHENTICATED', 'BLOCKED',
          'LIVE mode credential detected — refusing to use for test E2E', 'BLOCKED', 'VERIFIED_EXTERNAL');
        this.failClosedReason = 'Live-mode credential used for test E2E — policy violation';
        return;
      }

      // Store in secure credential source (not in env, not in tracked files)
      const sourceManager = getCredentialSourceManager();
      await sourceManager.storeCredential('stripe', 'stripe_secret_key', 'test', testKey, {
        actor: 'stripe-e2e-runner',
        role: 'system',
      });

      // Set in process.env for the duration of this run only
      this.savedEnvKeys['STRIPE_SECRET_KEY'] = process.env.STRIPE_SECRET_KEY;
      process.env.STRIPE_SECRET_KEY = testKey;

      // Compute fingerprint (never the actual key)
      this.credentialFingerprint = crypto.createHash('sha256').update(testKey).digest('hex').substring(0, 16);
      this.credentialSource = 'stripe_cli_config';

      // Also set in env for Stripe API calls in this process
      const durationMs = Date.now() - start;
      this.recordTransition('obtain_credential', 'AUTHENTICATED', 'CREDENTIAL_VALIDATED',
        `Test credential obtained from CLI, validated via /v1/balance, stored in secure source (fingerprint: ${this.credentialFingerprint})`,
        'PASS', 'VERIFIED_EXTERNAL', durationMs);

      console.log(`[STEP 1] ✓ Test credential validated (fingerprint: ${this.credentialFingerprint})`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'unknown';
      this.recordTransition('obtain_credential', 'AUTHENTICATED', 'BLOCKED',
        `Failed to obtain credential: ${errMsg.substring(0, 100)}`, 'BLOCKED', 'VERIFIED_INTERNAL');
      this.failClosedReason = `Credential extraction failed: ${errMsg.substring(0, 100)}`;
    }
  }

  private async stepStartWebhookReceiver(): Promise<void> {
    const start = Date.now();
    console.log('[STEP 2] Starting temporary webhook receiver...');

    return new Promise((resolve) => {
      const port = 3030 + Math.floor(Math.random() * 100);
      const receivedEvents: string[] = [];

      this.webhookServer = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/api/webhooks/stripe') {
          let body = '';
          req.on('data', (chunk) => { body += chunk.toString(); });
          req.on('end', () => {
            const signatureHeader = req.headers['stripe-signature'] as string || null;

            // Create a receipt for this specific webhook delivery
            const receipt: WebhookReceipt = {
              received: true,
              eventId: null,
              eventType: null,
              signatureValid: false, // Will be verified in step 9
              signatureHeader,
              payloadHash: crypto.createHash('sha256').update(body).digest('hex').substring(0, 16),
              receivedAt: new Date().toISOString(),
              body,
            };

            // Try to parse the event ID and type from the body
            try {
              const event = JSON.parse(body);
              receipt.eventId = event.id || null;
              receipt.eventType = event.type || null;

              // Check for duplicate delivery
              if (receivedEvents.includes(event.id)) {
                // Duplicate — record but don't overwrite primary receipt
              }
              receivedEvents.push(event.id);
            } catch {
              // Body is not valid JSON — fail closed
              this.failClosedReason = 'Webhook body is not valid JSON';
            }

            // Track ALL received webhooks
            this.allReceivedWebhooks.push(receipt);

            // Only set the primary webhookReceipt if we haven't verified one yet
            // This prevents later events (charge.updated, etc.) from overwriting
            // the checkout.session.completed event that we verified.
            if (!this.verifiedWebhook && !this.webhookReceipt.received) {
              this.webhookReceipt = receipt;
              this.stripeEventId = receipt.eventId;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: true }));
          });
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      this.webhookServer.listen(port, 'localhost', () => {
        const durationMs = Date.now() - start;
        this.webhookPort = port;
        this.recordTransition('start_webhook_receiver', 'NOT_RUNNING', 'RUNNING',
          `Webhook receiver listening on localhost:${port}`, 'PASS', 'VERIFIED_INTERNAL', durationMs);
        console.log(`[STEP 2] ✓ Webhook receiver on localhost:${port}`);
        resolve();
      });

      this.webhookServer.on('error', (err) => {
        this.recordTransition('start_webhook_receiver', 'NOT_RUNNING', 'FAILED',
          `Webhook receiver failed: ${err.message}`, 'FAIL', 'VERIFIED_INTERNAL');
        this.failClosedReason = `Webhook receiver failed: ${err.message}`;
        resolve();
      });
    });
  }

  private webhookPort: number = 0;

  private async stepStartStripeListener(): Promise<void> {
    const start = Date.now();
    console.log('[STEP 3] Starting stripe listen...');

    const forwardTo = `localhost:${this.webhookPort}/api/webhooks/stripe`;

    try {
      this.listenerProcess = spawn('stripe', ['listen', '--forward-to', forwardTo], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
        windowsHide: true,
      });

      // Wait for the listener to start and capture the webhook secret
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.recordTransition('start_listener', 'NOT_RUNNING', 'TIMEOUT',
            'Listener start timed out (15s)', 'BLOCKED', 'VERIFIED_INTERNAL');
          this.failClosedReason = 'Listener start timed out';
          resolve();
        }, 15000);

        this.listenerProcess!.stdout?.on('data', (data: Buffer) => {
          const output = data.toString();
          // Look for the webhook secret
          const match = output.match(/whsec_([A-Za-z0-9]+)/);
          if (match) {
            this.currentWebhookSecret = `whsec_${match[1]}`;
            clearTimeout(timeout);
            const durationMs = Date.now() - start;
            this.recordTransition('start_listener', 'NOT_RUNNING', 'RUNNING',
              `Listener started, forwarding to ${forwardTo}`, 'PASS', 'VERIFIED_EXTERNAL', durationMs);
            this.listenerWasStarted = true;
            console.log('[STEP 3] ✓ stripe listen running');
            resolve();
          }
        });

        this.listenerProcess!.stderr?.on('data', (data: Buffer) => {
          const output = data.toString();
          const match = output.match(/whsec_([A-Za-z0-9]+)/);
          if (match) {
            this.currentWebhookSecret = `whsec_${match[1]}`;
            clearTimeout(timeout);
            const durationMs = Date.now() - start;
            this.recordTransition('start_listener', 'NOT_RUNNING', 'RUNNING',
              `Listener started (stderr), forwarding to ${forwardTo}`, 'PASS', 'VERIFIED_EXTERNAL', durationMs);
            this.listenerWasStarted = true;
            console.log('[STEP 3] ✓ stripe listen running');
            resolve();
          }
        });

        this.listenerProcess!.on('error', (err: Error) => {
          clearTimeout(timeout);
          this.recordTransition('start_listener', 'NOT_RUNNING', 'FAILED',
            `Listener failed: ${err.message}`, 'FAIL', 'VERIFIED_INTERNAL');
          this.failClosedReason = `Listener failed: ${err.message}`;
          resolve();
        });

        this.listenerProcess!.on('exit', (code: number) => {
          clearTimeout(timeout);
          if (code !== 0 && code !== null) {
            this.recordTransition('start_listener', 'NOT_RUNNING', 'FAILED',
              `Listener exited with code ${code}`, 'FAIL', 'VERIFIED_INTERNAL');
            this.failClosedReason = `Listener exited with code ${code}`;
            resolve();
          }
        });
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'unknown';
      this.recordTransition('start_listener', 'NOT_RUNNING', 'FAILED',
        `Listener spawn error: ${errMsg}`, 'FAIL', 'VERIFIED_INTERNAL');
      this.failClosedReason = `Listener spawn error: ${errMsg}`;
    }
  }

  private async stepCaptureWebhookSecret(): Promise<void> {
    const start = Date.now();
    console.log('[STEP 4] Capturing webhook secret...');

    if (!this.currentWebhookSecret) {
      // Wait a bit more for the secret to appear
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    if (!this.currentWebhookSecret) {
      this.recordTransition('capture_webhook_secret', 'UNKNOWN', 'BLOCKED',
        'No webhook secret captured from listener', 'BLOCKED', 'VERIFIED_INTERNAL');
      this.failClosedReason = 'No webhook secret captured from listener';
      console.log('[STEP 4] ✗ No webhook secret captured');
      return;
    }

    // Compute fingerprint (never the actual secret)
    const fingerprint = crypto.createHash('sha256').update(this.currentWebhookSecret).digest('hex').substring(0, 16);
    this.recordTransition('capture_webhook_secret', 'UNKNOWN', 'SECRET_CAPTURED',
      `Webhook secret captured (fingerprint: ${fingerprint})`, 'PASS', 'VERIFIED_INTERNAL', Date.now() - start);
    console.log(`[STEP 4] ✓ Webhook secret captured (fingerprint: ${fingerprint})`);
  }

  private async stepConfigureEnvironment(): Promise<void> {
    const start = Date.now();
    console.log('[STEP 5] Configuring local environment...');

    if (!this.currentWebhookSecret) {
      this.recordTransition('configure_env', 'UNKNOWN', 'BLOCKED',
        'Cannot configure — no webhook secret', 'BLOCKED', 'VERIFIED_INTERNAL');
      return;
    }

    // Save current env state for restoration
    this.savedEnvKeys['STRIPE_WEBHOOK_SECRET_01'] = process.env.STRIPE_WEBHOOK_SECRET_01;
    this.savedEnvKeys['WEBHOOK_PROCESSING_ENABLED'] = process.env.WEBHOOK_PROCESSING_ENABLED;

    // Set the webhook secret and enable processing
    process.env.STRIPE_WEBHOOK_SECRET_01 = this.currentWebhookSecret;
    process.env.WEBHOOK_PROCESSING_ENABLED = 'true';

    this.recordTransition('configure_env', 'UNCONFIGURED', 'CONFIGURED',
      'STRIPE_WEBHOOK_SECRET_01 and WEBHOOK_PROCESSING_ENABLED set', 'PASS', 'VERIFIED_INTERNAL', Date.now() - start);
    console.log('[STEP 5] ✓ Environment configured');
  }

  private async stepCreateCheckoutSession(): Promise<void> {
    const start = Date.now();
    console.log('[STEP 6] Creating real test-mode Checkout Session...');

    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      this.recordTransition('create_checkout', 'UNKNOWN', 'BLOCKED',
        'No STRIPE_SECRET_KEY in environment', 'BLOCKED', 'VERIFIED_INTERNAL');
      this.failClosedReason = 'No STRIPE_SECRET_KEY for checkout creation';
      return;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);

      const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          'mode': 'payment',
          'success_url': 'http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}',
          'cancel_url': 'http://localhost:3000/cancel',
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][product_data][name]': 'HYDI E2E Qualification Test',
          'line_items[0][price_data][unit_amount]': '100',
          'line_items[0][quantity]': '1',
          'metadata[source]': 'hydi_e2e_qualification',
          'metadata[run_id]': this.runId,
        }).toString(),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        const session = await response.json() as { id: string; url: string };
        this.checkoutSessionId = session.id;
        const durationMs = Date.now() - start;
        this.recordTransition('create_checkout', 'NOT_CREATED', 'CREATED',
          `Checkout session created: ${session.id}`, 'PASS', 'VERIFIED_EXTERNAL', durationMs);
        console.log(`[STEP 6] ✓ Checkout session: ${session.id}`);
      } else {
        const errorBody = await response.text().catch(() => 'unknown');
        this.recordTransition('create_checkout', 'NOT_CREATED', 'FAILED',
          `Checkout creation failed (${response.status}): ${errorBody.substring(0, 150)}`, 'FAIL', 'VERIFIED_EXTERNAL');
        this.failClosedReason = `Checkout creation failed: ${response.status}`;
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'unknown';
      this.recordTransition('create_checkout', 'NOT_CREATED', 'BLOCKED',
        `Checkout creation error: ${errMsg.substring(0, 100)}`, 'BLOCKED', 'VERIFIED_INTERNAL');
      this.failClosedReason = `Checkout creation error: ${errMsg.substring(0, 100)}`;
    }
  }

  private async stepTriggerCheckoutEvent(): Promise<void> {
    const start = Date.now();
    console.log('[STEP 7] Triggering checkout.session.completed via stripe trigger...');

    if (!this.listenerProcess) {
      this.recordTransition('trigger_event', 'UNKNOWN', 'BLOCKED',
        'No listener running — cannot trigger event', 'BLOCKED', 'VERIFIED_INTERNAL');
      this.failClosedReason = 'No listener for trigger';
      return;
    }

    try {
      // Use stripe trigger to send a real checkout.session.completed event
      // This creates real Stripe objects and sends a real webhook
      const output = execSync('stripe trigger checkout.session.completed 2>NUL', {
        encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      const durationMs = Date.now() - start;

      // The trigger command outputs the event ID
      const eventIdMatch = output.match(/evt_[A-Za-z0-9]+/);
      if (eventIdMatch) {
        this.stripeEventId = eventIdMatch[0];
      }

      this.recordTransition('trigger_event', 'NOT_TRIGGERED', 'TRIGGERED',
        `stripe trigger checkout.session.completed executed${this.stripeEventId ? ` — event: ${this.stripeEventId}` : ''}`,
        'PASS', 'VERIFIED_EXTERNAL', durationMs);
      console.log(`[STEP 7] ✓ Event triggered${this.stripeEventId ? ` — ${this.stripeEventId}` : ''}`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'unknown';
      this.recordTransition('trigger_event', 'NOT_TRIGGERED', 'FAILED',
        `stripe trigger failed: ${errMsg.substring(0, 100)}`, 'FAIL', 'VERIFIED_EXTERNAL');
      this.failClosedReason = `stripe trigger failed: ${errMsg.substring(0, 100)}`;
    }
  }

  private async stepVerifyWebhookDelivery(): Promise<void> {
    const start = Date.now();
    console.log('[STEP 8] Verifying webhook delivery (waiting for checkout.session.completed)...');

    // Wait for the checkout.session.completed event specifically
    // stripe trigger checkout.session.completed sends multiple side-effect events
    // (product.created, price.created, charge.succeeded, etc.) but we need
    // the actual checkout.session.completed event for the causal chain.
    const targetEventType = 'checkout.session.completed';
    const maxWait = 30000;
    const checkInterval = 500;
    let waited = 0;

    while (waited < maxWait) {
      // Check if we've received the target event
      const targetEvent = this.allReceivedWebhooks.find(w => w.eventType === targetEventType);
      if (targetEvent) {
        // Set this as the primary webhook receipt for signature verification
        this.webhookReceipt = targetEvent;
        this.stripeEventId = targetEvent.eventId;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
    }

    // Check if we got the target event
    const targetEvent = this.allReceivedWebhooks.find(w => w.eventType === targetEventType);
    if (!targetEvent) {
      // Did we receive any webhooks at all?
      const anyReceived = this.allReceivedWebhooks.length > 0;
      this.recordTransition('verify_webhook_delivery', 'WAITING', 'BLOCKED',
        anyReceived
          ? `Received ${this.allReceivedWebhooks.length} webhooks but none was ${targetEventType} (types: ${this.allReceivedWebhooks.map(w => w.eventType).join(', ')})`
          : `No webhook received after ${maxWait / 1000}s`,
        'BLOCKED', 'VERIFIED_EXTERNAL');
      this.failClosedReason = anyReceived
        ? `Target event ${targetEventType} not received (got: ${this.allReceivedWebhooks.map(w => w.eventType).join(', ')})`
        : `No webhook received after ${maxWait / 1000}s`;
      console.log(`[STEP 8] ✗ ${this.failClosedReason}`);
      return;
    }

    const durationMs = Date.now() - start;
    this.recordTransition('verify_webhook_delivery', 'WAITING', 'RECEIVED',
      `Target webhook received — event: ${targetEvent.eventId}, type: ${targetEvent.eventType}, payload hash: ${targetEvent.payloadHash} (${this.allReceivedWebhooks.length} total events received)`,
      'PASS', 'VERIFIED_EXTERNAL', durationMs);
    console.log(`[STEP 8] ✓ checkout.session.completed received — ${targetEvent.eventId} (${this.allReceivedWebhooks.length} total events)`);
  }

  private async stepVerifySignature(): Promise<void> {
    const start = Date.now();
    console.log('[STEP 9] Verifying Stripe signature...');

    if (!this.webhookReceipt.received || !this.webhookReceipt.body || !this.webhookReceipt.signatureHeader) {
      this.recordTransition('verify_signature', 'UNKNOWN', 'BLOCKED',
        'No webhook body or signature header to verify', 'BLOCKED', 'VERIFIED_INTERNAL');
      this.failClosedReason = 'No webhook body or signature for verification';
      return;
    }

    if (!this.currentWebhookSecret) {
      this.recordTransition('verify_signature', 'UNKNOWN', 'BLOCKED',
        'No webhook secret for signature verification', 'BLOCKED', 'VERIFIED_INTERNAL');
      this.failClosedReason = 'No webhook secret for verification';
      return;
    }

    // Real Stripe signature verification
    // The signature header looks like: t=1234567890,v1=abc123...,v1=def456...
    const signatureValid = this.verifyStripeSignature(
      this.webhookReceipt.body,
      this.webhookReceipt.signatureHeader,
      this.currentWebhookSecret,
    );

    this.webhookReceipt.signatureValid = signatureValid;

    // Lock the verified webhook so subsequent events don't overwrite it
    if (signatureValid) {
      this.verifiedWebhook = { ...this.webhookReceipt };
      const durationMs = Date.now() - start;
      this.recordTransition('verify_signature', 'UNVERIFIED', 'VERIFIED',
        `Stripe signature verified (HMAC-SHA256) — event: ${this.webhookReceipt.eventId}, type: ${this.webhookReceipt.eventType}`,
        'PASS', 'VERIFIED_EXTERNAL', durationMs);
      console.log(`[STEP 9] ✓ Signature verified — ${this.webhookReceipt.eventId} (${this.webhookReceipt.eventType})`);
    } else {
      this.recordTransition('verify_signature', 'UNVERIFIED', 'INVALID',
        `Stripe signature verification FAILED — event: ${this.webhookReceipt.eventId}, type: ${this.webhookReceipt.eventType}`,
        'FAIL', 'VERIFIED_EXTERNAL');
      this.failClosedReason = 'Stripe signature verification failed';
      console.log(`[STEP 9] ✗ Signature verification FAILED — ${this.webhookReceipt.eventId}`);
    }
  }

  private verifyStripeSignature(payload: string, header: string, secret: string): boolean {
    // Parse the signature header
    const parts = header.split(',');
    let timestamp: string | null = null;
    const signatures: string[] = [];

    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 't') timestamp = value;
      if (key === 'v1') signatures.push(value);
    }

    if (!timestamp || signatures.length === 0) {
      return false;
    }

    // Compute the expected signature
    const signedPayload = `${timestamp}.${payload}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    // Check if any of the provided signatures match
    // Use timing-safe comparison
    for (const sig of signatures) {
      if (sig.length === expectedSignature.length) {
        try {
          if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSignature))) {
            return true;
          }
        } catch {
          // Length mismatch — continue
        }
      }
    }

    return false;
  }

  private async stepVerifyIdempotency(): Promise<void> {
    const start = Date.now();
    console.log('[STEP 10] Verifying idempotency (no duplicate delivery)...');

    // Wait a bit more to see if a duplicate arrives
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check all received webhooks for duplicates
    const eventIds = this.allReceivedWebhooks.map(w => w.eventId).filter(Boolean) as string[];
    const uniqueEventIds = new Set(eventIds);
    const duplicates = eventIds.length - uniqueEventIds.size;

    // Find the checkout.session.completed event specifically
    const checkoutEvent = this.allReceivedWebhooks.find(w => w.eventType === 'checkout.session.completed');
    const verifiedEvent = this.verifiedWebhook || checkoutEvent;

    if (!verifiedEvent) {
      this.recordTransition('verify_idempotency', 'UNKNOWN', 'BLOCKED',
        'No verified webhook to check idempotency against', 'BLOCKED', 'VERIFIED_INTERNAL');
      this.failClosedReason = 'No verified webhook for idempotency check';
      return;
    }

    // Check if the verified event was delivered more than once
    const verifiedEventDeliveries = eventIds.filter(id => id === verifiedEvent.eventId).length;

    const durationMs = Date.now() - start;
    if (duplicates === 0 && verifiedEventDeliveries === 1) {
      this.recordTransition('verify_idempotency', 'UNKNOWN', 'VERIFIED',
        `Idempotency verified — ${uniqueEventIds.size} unique events received, 0 duplicates, verified event ${verifiedEvent.eventId} delivered exactly once`,
        'PASS', 'VERIFIED_EXTERNAL', durationMs);
      console.log(`[STEP 10] ✓ Idempotency verified — ${uniqueEventIds.size} unique events, 0 duplicates`);
    } else if (verifiedEventDeliveries === 1) {
      // Other events had duplicates but the verified one didn't — still PASS
      this.recordTransition('verify_idempotency', 'UNKNOWN', 'VERIFIED',
        `Idempotency verified for target event — ${uniqueEventIds.size} unique events, ${duplicates} duplicate(s) of other events, verified event ${verifiedEvent.eventId} delivered exactly once`,
        'PASS', 'VERIFIED_EXTERNAL', durationMs);
      console.log(`[STEP 10] ✓ Idempotency verified — target event delivered once (${duplicates} other duplicates)`);
    } else {
      this.recordTransition('verify_idempotency', 'UNKNOWN', 'FAILED',
        `Idempotency FAILED — verified event ${verifiedEvent.eventId} delivered ${verifiedEventDeliveries} times`,
        'FAIL', 'VERIFIED_EXTERNAL');
      this.failClosedReason = `Duplicate delivery of verified event ${verifiedEvent.eventId}`;
      console.log(`[STEP 10] ✗ Idempotency FAILED — ${verifiedEventDeliveries} deliveries of ${verifiedEvent.eventId}`);
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────

  private async cleanup(): Promise<void> {
    console.log('\n[CLEANUP] Stopping listener and cleaning up...');

    // Stop the Stripe CLI listener
    if (this.listenerProcess) {
      try {
        this.listenerProcess.kill('SIGTERM');
      } catch {
        // Process may have already exited
      }
      this.listenerProcess = null;
    }

    // Close the webhook receiver server
    if (this.webhookServer) {
      await new Promise<void>((resolve) => {
        this.webhookServer!.close(() => resolve());
      });
      this.webhookServer = null;
    }

    // Restore environment variables
    for (const [key, value] of Object.entries(this.savedEnvKeys)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    // Remove the credential from the secure source
    try {
      const sourceManager = getCredentialSourceManager();
      await sourceManager.removeCredential('stripe', 'stripe_secret_key', 'test');
    } catch {
      // Best effort
    }

    this.cleanedUp = true;
    this.recordTransition('cleanup', 'RUNNING', 'CLEANED',
      'Listener stopped, webhook server closed, env vars restored, credential removed',
      'PASS', 'VERIFIED_INTERNAL');
    console.log('[CLEANUP] ✓ All resources cleaned up');
  }

  // ─── Evidence Recording ──────────────────────────────────────────────

  private recordTransition(
    step: string,
    fromState: string,
    toState: string,
    evidence: string,
    result: TransitionRecord['result'],
    verificationLevel: VerificationLevel,
    durationMs?: number,
  ): void {
    const transition: TransitionRecord = {
      step,
      timestamp: new Date().toISOString(),
      fromState,
      toState,
      evidence,
      verificationLevel,
      result,
      durationMs: durationMs ?? 0,
    };
    this.transitions.push(transition);

    // Also record in the HYDI EvidenceStore
    this.recordEvidence(step, result, evidence, verificationLevel, null);

    console.log(`  [${step}] ${fromState} → ${toState}: ${result}`);
  }

  private recordEvidence(
    action: string,
    result: TransitionRecord['result'],
    observation: string,
    verificationLevel: VerificationLevel,
    blocker: EvidenceBlocker | null,
  ): void {
    try {
      const record = createEvidence({
        operationId: `stripe-e2e-runner-${this.runId}`,
        capability: 'stripe-e2e-qualification',
        provider: 'stripe',
        environment: 'test',
        action,
        authorization: { mode: 'autonomous', actor: 'stripe-e2e-runner', role: 'system', permission: 'credentials:e2e:qualify' },
        observation,
        verificationLevel,
        verificationMethod: `stripe.e2e.runner.${action}`,
        result,
        confidence: result === 'PASS' ? 1.0 : result === 'BLOCKED' ? 0.0 : 0.5,
        externalEvidence: [],
        internalEvidence: [`run: ${this.runId}`],
        correlationId: this.correlationId,
        blocker,
      });
      this.evidenceIds.push(record.id);
    } catch (e) {
      // EvidenceStore may not be available in all contexts
    }
  }

  // ─── Certification ───────────────────────────────────────────────────

  private generateCertification(
    cliState: CliState,
    cliVersion: string | null,
    accountInfo: { accountId: string | null; mode: 'test' | 'live' | 'unknown' },
    ownership: CertificationResult['blockerOwnership'],
  ): CertificationResult {
    const allPass = this.transitions.length > 0 &&
      this.transitions.every(t => t.result === 'PASS' || t.result === 'SIMULATED');
    const anyFail = this.transitions.some(t => t.result === 'FAIL');
    const anyBlocked = this.transitions.some(t => t.result === 'BLOCKED');

    let recommendation: CertificationResult['recommendation'];
    if (ownership === 'AUTONOMOUS' && allPass && !anyFail && !anyBlocked && this.cleanedUp) {
      recommendation = 'READY';
    } else if (anyFail || this.failClosedReason) {
      recommendation = 'NOT_READY';
    } else {
      recommendation = 'READY_WITH_BLOCKERS';
    }

    const webhookSecretFingerprint = this.currentWebhookSecret
      ? crypto.createHash('sha256').update(this.currentWebhookSecret).digest('hex').substring(0, 16)
      : null;

    // Use the verified webhook for the certification, not the last received one
    const certWebhookReceipt = this.verifiedWebhook || (this.webhookReceipt.received ? this.webhookReceipt : null);

    return {
      certificationId: `CERT-E2E-${randomUUID().substring(0, 8)}`,
      generatedAt: new Date().toISOString(),
      runId: this.runId,
      phase: this.phase,
      cliState,
      cliVersion,
      accountId: accountInfo.accountId,
      accountMode: accountInfo.mode,
      blockerOwnership: ownership,
      transitions: this.transitions,
      webhookReceipt: certWebhookReceipt,
      allReceivedWebhooks: this.allReceivedWebhooks.map(w => ({
        eventId: w.eventId,
        eventType: w.eventType,
        signatureValid: w.signatureValid,
        payloadHash: w.payloadHash,
        receivedAt: w.receivedAt,
      })),
      checkoutSessionId: this.checkoutSessionId,
      stripeEventId: certWebhookReceipt?.eventId || this.stripeEventId,
      credentialFingerprint: this.credentialFingerprint,
      credentialSource: this.credentialSource,
      webhookSecretFingerprint,
      listenerStarted: this.listenerWasStarted, // Use tracked state, not process reference
      listenerPid: null, // Not available cross-platform
      cleanedUp: this.cleanedUp,
      humanActionRequest: this.humanActionRequest,
      recommendation,
      failClosedReason: this.failClosedReason,
      evidenceIds: this.evidenceIds,
    };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let phase: 'unauth' | 'auth' | 'auto' = 'auto';

  for (const arg of args) {
    if (arg.startsWith('--phase=')) {
      const value = arg.split('=')[1] as 'unauth' | 'auth' | 'auto';
      if (['unauth', 'auth', 'auto'].includes(value)) {
        phase = value;
      }
    }
  }

  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  HYDI Stripe E2E Autonomous Qualification Runner');
  console.log('  Real CLI • Real Listener • Real Webhook • Real Evidence');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  Phase: ${phase}`);
  console.log(`  Time:  ${new Date().toISOString()}`);
  console.log('');

  const runner = new StripeE2EQualificationRunner(phase);
  const result = await runner.run();

  // Write machine-readable certification
  const certPath = path.resolve(process.cwd(), 'docs', 'stripe-e2e-certification.json');
  fs.mkdirSync(path.dirname(certPath), { recursive: true });
  fs.writeFileSync(certPath, JSON.stringify(result, null, 2));

  // Print human-readable summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  CERTIFICATION RESULT');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  Certification ID:     ${result.certificationId}`);
  console.log(`  CLI State:            ${result.cliState}`);
  console.log(`  CLI Version:          ${result.cliVersion || 'N/A'}`);
  console.log(`  Account ID:           ${result.accountId || 'N/A'}`);
  console.log(`  Account Mode:         ${result.accountMode}`);
  console.log(`  Blocker Ownership:    ${result.blockerOwnership}`);
  console.log(`  Transitions:          ${result.transitions.length}`);
  console.log(`  Webhook Received:     ${result.webhookReceipt?.received ?? false}`);
  console.log(`  Signature Valid:      ${result.webhookReceipt?.signatureValid ?? false}`);
  console.log(`  Verified Event:       ${result.webhookReceipt?.eventId || 'N/A'} (${result.webhookReceipt?.eventType || 'N/A'})`);
  console.log(`  All Events Received:  ${result.allReceivedWebhooks.length}`);
  console.log(`  Checkout Session:     ${result.checkoutSessionId || 'N/A'}`);
  console.log(`  Stripe Event ID:      ${result.stripeEventId || 'N/A'}`);
  console.log(`  Credential Fingerprint: ${result.credentialFingerprint || 'N/A'}`);
  console.log(`  Webhook Secret FP:    ${result.webhookSecretFingerprint || 'N/A'}`);
  console.log(`  Cleaned Up:           ${result.cleanedUp}`);
  console.log(`  Human Action Request: ${result.humanActionRequest?.id || 'N/A'}`);
  console.log(`  Fail-Closed Reason:   ${result.failClosedReason || 'None'}`);
  console.log(`  Recommendation:       ${result.recommendation}`);
  console.log('');
  console.log(`  Certification file:   ${certPath}`);
  console.log('═══════════════════════════════════════════════════════════════════════');

  // Exit with appropriate code
  if (result.recommendation === 'READY') {
    process.exit(0);
  } else if (result.recommendation === 'READY_WITH_BLOCKERS') {
    process.exit(2); // Blocked but not failed
  } else {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('FATAL: Runner crashed:', error instanceof Error ? error.message : 'unknown');
  process.exit(1);
});
