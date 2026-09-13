/**
 * Credential Runbook Registry
 *
 * Maps each external credential to a human-readable runbook with:
 *   - What the credential gates (which capability it unblocks)
 *   - Where to get it (service URL, signup flow)
 *   - Step-by-step instructions
 *   - Which env vars to set
 *   - How to verify it works
 *   - Cost and time estimates
 *   - Priority relative to other credentials
 *
 * The BlockerResolutionEngine uses this to generate actionable escalations
 * instead of silently working around missing credentials forever.
 */

export interface CredentialRunbook {
  /** The env vars this runbook covers */
  envVars: string[];
  /** The capability ID this unblocks */
  capabilityId: string;
  /** Human-readable service name */
  service: string;
  /** Provider identifier */
  provider: string;
  /** URL to get started */
  signupUrl: string;
  /** One-line summary of what this enables */
  gates: string;
  /** Priority: 1 = highest (gates revenue), 4 = lowest */
  priority: 1 | 2 | 3 | 4;
  /** Estimated time to obtain */
  estimatedTime: string;
  /** Cost description */
  cost: string;
  /** Whether a credit card is required to obtain */
  requiresCard: boolean;
  /** Whether this can be done with an existing account (e.g., Gmail for SMTP) */
  usesExistingAccount: boolean;
  /** Step-by-step instructions */
  steps: RunbookStep[];
  /** How to verify the credential works once set */
  verification: {
    description: string;
    /** A safe (non-secret) check that can be run to verify validity */
    checkType: 'api_ping' | 'smtp_send' | 'places_query' | 'twilio_lookup' | 'env_presence';
  };
  /** Alternative approaches if the primary path isn't available */
  alternatives?: { description: string; envVars: string[] }[];
}

export interface RunbookStep {
  /** Step number */
  step: number;
  /** What to do */
  action: string;
  /** What you'll see when it's done */
  expected: string;
  /** Whether this step requires sensitive input (card, password, ToS) */
  requiresHumanInput: boolean;
  /** Optional URL for this specific step */
  url?: string;
}

// ─── Registry ─────────────────────────────────────────────────────────────

const RUNBOOKS: Record<string, CredentialRunbook> = {
  stripe: {
    envVars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    capabilityId: 'commercial.stripe',
    service: 'Stripe (Test Mode)',
    provider: 'stripe',
    signupUrl: 'https://dashboard.stripe.com/register',
    gates: 'Verified revenue — payment processing, Checkout Sessions, webhook-confirmed transactions, revenue ledger entries',
    priority: 1,
    estimatedTime: '5-10 minutes',
    cost: 'Free in test mode — no card required for test-mode keys',
    requiresCard: false,
    usesExistingAccount: false,
    steps: [
      {
        step: 1,
        action: 'Go to dashboard.stripe.com/register and create an account with your email',
        expected: 'You receive a verification email from Stripe',
        requiresHumanInput: true,
        url: 'https://dashboard.stripe.com/register',
      },
      {
        step: 2,
        action: 'Click the verification link in the email',
        expected: 'You land on the Stripe dashboard',
        requiresHumanInput: true,
      },
      {
        step: 3,
        action: 'Toggle "Test mode" ON (top-right corner of the dashboard)',
        expected: 'The toggle shows "Test mode" and the test key prefix is sk_test_',
        requiresHumanInput: false,
      },
      {
        step: 4,
        action: 'Go to Developers → API keys. Copy the Secret key (sk_test_...)',
        expected: 'You have a string starting with sk_test_',
        requiresHumanInput: true,
      },
      {
        step: 5,
        action: 'Go to Developers → Webhooks → Add endpoint. Set URL to http://localhost:3000/api/webhooks/stripe. Select events: checkout.session.completed, payment_intent.succeeded, invoice.paid',
        expected: 'The endpoint is created and listed',
        requiresHumanInput: false,
      },
      {
        step: 6,
        action: 'Click the endpoint, then click "Signing secret". Copy it (whsec_...)',
        expected: 'You have a string starting with whsec_',
        requiresHumanInput: true,
      },
      {
        step: 7,
        action: 'Add both values to .env.local: STRIPE_SECRET_KEY=sk_test_... and STRIPE_WEBHOOK_SECRET=whsec_...',
        expected: 'The env vars are set in the file',
        requiresHumanInput: true,
      },
    ],
    verification: {
      description: 'Call Stripe API to retrieve balance — confirms the key is valid and the account is accessible',
      checkType: 'api_ping',
    },
  },

  email: {
    envVars: ['SENDGRID_API_KEY'],
    capabilityId: 'commercial.email',
    service: 'Email — SendGrid or Gmail SMTP',
    provider: 'sendgrid',
    signupUrl: 'https://sendgrid.com/free/',
    gates: 'Real outreach — sending emails to prospects, delivery confirmation, response tracking',
    priority: 2,
    estimatedTime: '3 minutes (SMTP) or 10 minutes (SendGrid)',
    cost: 'Free — Gmail SMTP is free, SendGrid free tier is 100 emails/day forever',
    requiresCard: false,
    usesExistingAccount: true,
    steps: [
      {
        step: 1,
        action: 'FASTEST: Use Gmail SMTP. Enable 2-Step Verification on your Google Account (Google Account → Security)',
        expected: '2-Step Verification is enabled',
        requiresHumanInput: true,
        url: 'https://myaccount.google.com/security',
      },
      {
        step: 2,
        action: 'Go to Google Account → Security → App passwords. Generate one for "Mail"',
        expected: 'You get a 16-character app password',
        requiresHumanInput: true,
      },
      {
        step: 3,
        action: 'Add to .env.local: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER=your@gmail.com, SMTP_PASS=your-16-char-app-password',
        expected: 'All four SMTP env vars are set',
        requiresHumanInput: true,
      },
    ],
    verification: {
      description: 'Send a test email to yourself via SMTP — confirms credentials are valid and the server accepts them',
      checkType: 'smtp_send',
    },
    alternatives: [
      {
        description: 'SendGrid free tier (100 emails/day) — better for higher volume outreach. Sign up at sendgrid.com/free, create an API key in Settings → API Keys, set SENDGRID_API_KEY=SG....',
        envVars: ['SENDGRID_API_KEY'],
      },
    ],
  },

  discovery: {
    envVars: ['GOOGLE_PLACES_API_KEY'],
    capabilityId: 'commercial.discovery_external',
    service: 'Google Places API',
    provider: 'google_places',
    signupUrl: 'https://console.cloud.google.com/',
    gates: 'Automatic prospect discovery — finding new businesses via Google Places nearby search instead of manual CSV import',
    priority: 3,
    estimatedTime: '10-15 minutes',
    cost: 'Free monthly credit ($200/month), but requires a card on file. Set a budget cap to prevent runaway charges.',
    requiresCard: true,
    usesExistingAccount: true,
    steps: [
      {
        step: 1,
        action: 'Go to console.cloud.google.com and create or select a project',
        expected: 'You have an active Cloud project selected',
        requiresHumanInput: true,
        url: 'https://console.cloud.google.com/',
      },
      {
        step: 2,
        action: 'Enable billing — add a card. Then immediately set a budget cap under Billing → Budgets & alerts (e.g., $1/month)',
        expected: 'Billing is enabled and a budget cap is set',
        requiresHumanInput: true,
      },
      {
        step: 3,
        action: 'Go to APIs & Services → Library → search for "Places API" → Enable it',
        expected: 'Places API shows as Enabled',
        requiresHumanInput: false,
      },
      {
        step: 4,
        action: 'Go to APIs & Services → Credentials → Create credentials → API key. Copy the key.',
        expected: 'You have an API key string',
        requiresHumanInput: true,
      },
      {
        step: 5,
        action: 'Restrict the key: click it → API restrictions → restrict to Places API only',
        expected: 'The key is restricted to Places API',
        requiresHumanInput: false,
      },
      {
        step: 6,
        action: 'Add to .env.local: GOOGLE_PLACES_API_KEY=your-key-here',
        expected: 'The env var is set',
        requiresHumanInput: true,
      },
    ],
    verification: {
      description: 'Run a real Google Places nearby search query — confirms the key is valid and returns business results',
      checkType: 'places_query',
    },
    alternatives: [
      {
        description: 'CSV import — the system already supports manual prospect import via CSV. No external credential needed. Use this until you want automatic discovery.',
        envVars: [],
      },
    ],
  },

  sms: {
    envVars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
    capabilityId: 'commercial.sms',
    service: 'Twilio SMS',
    provider: 'twilio',
    signupUrl: 'https://www.twilio.com/try-twilio',
    gates: 'SMS outreach — sending text messages to prospects. Email covers the same job for cheaper.',
    priority: 4,
    estimatedTime: '10-15 minutes',
    cost: 'Limited trial credit, then per-message billing. Requires a verified phone number.',
    requiresCard: false,
    usesExistingAccount: false,
    steps: [
      {
        step: 1,
        action: 'Go to twilio.com/try-twilio and sign up',
        expected: 'You have a Twilio account',
        requiresHumanInput: true,
        url: 'https://www.twilio.com/try-twilio',
      },
      {
        step: 2,
        action: 'Get a trial phone number',
        expected: 'You have a phone number',
        requiresHumanInput: true,
      },
      {
        step: 3,
        action: 'Copy Account SID and Auth Token from the console dashboard',
        expected: 'You have both values',
        requiresHumanInput: true,
      },
      {
        step: 4,
        action: 'Add to .env.local: TWILIO_ACCOUNT_SID=AC..., TWILIO_AUTH_TOKEN=..., TWILIO_PHONE_NUMBER=+1...',
        expected: 'All three env vars are set',
        requiresHumanInput: true,
      },
    ],
    verification: {
      description: 'Twilio API lookup — confirms the credentials are valid',
      checkType: 'twilio_lookup',
    },
  },
};

// ─── Registry API ─────────────────────────────────────────────────────────

export class CredentialRunbookRegistry {
  private runbooks: Map<string, CredentialRunbook> = new Map();
  /** Track when credentials were first detected as missing */
  private firstSeenMissing: Map<string, string> = new Map();
  /** Track when credentials were resolved */
  private resolvedAt: Map<string, string> = new Map();

  constructor() {
    for (const [key, runbook] of Object.entries(RUNBOOKS)) {
      this.runbooks.set(key, runbook);
    }
  }

  /**
   * Get the runbook for a capability by its capability ID.
   */
  getRunbookForCapability(capabilityId: string): CredentialRunbook | null {
    for (const runbook of this.runbooks.values()) {
      if (runbook.capabilityId === capabilityId) return runbook;
    }
    return null;
  }

  /**
   * Get the runbook by its registry key (stripe, email, discovery, sms).
   */
  getRunbook(key: string): CredentialRunbook | null {
    return this.runbooks.get(key) || null;
  }

  /**
   * Get all runbooks, sorted by priority.
   */
  getAllRunbooks(): CredentialRunbook[] {
    return Array.from(this.runbooks.values()).sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get runbooks for all currently-missing credentials.
   * Checks env vars and returns only those that are not set.
   */
  getMissingCredentialRunbooks(): { key: string; runbook: CredentialRunbook; missingVars: string[] }[] {
    const result: { key: string; runbook: CredentialRunbook; missingVars: string[] }[] = [];

    for (const [key, runbook] of this.runbooks) {
      const missing = runbook.envVars.filter((v) => !process.env[v]);
      if (missing.length > 0) {
        // Track first-seen-missing
        if (!this.firstSeenMissing.has(key)) {
          this.firstSeenMissing.set(key, new Date().toISOString());
        }
        result.push({ key, runbook, missingVars: missing });
      } else if (this.firstSeenMissing.has(key) && !this.resolvedAt.has(key)) {
        // Credential appeared! Record resolution
        this.resolvedAt.set(key, new Date().toISOString());
      }
    }

    return result.sort((a, b) => a.runbook.priority - b.runbook.priority);
  }

  /**
   * Get all runbooks with their current status (missing, partial, or ready).
   */
  getRunbookStatuses(): {
    key: string;
    runbook: CredentialRunbook;
    status: 'missing' | 'partial' | 'ready';
    missingVars: string[];
    setVars: string[];
    firstSeenMissing: string | null;
    resolvedAt: string | null;
  }[] {
    return this.getAllRunbooks().map((runbook) => {
      const key = this.getKeyForRunbook(runbook);
      const missing = runbook.envVars.filter((v) => !process.env[v]);
      const set = runbook.envVars.filter((v) => process.env[v]);

      let status: 'missing' | 'partial' | 'ready' = 'ready';
      if (missing.length === runbook.envVars.length) status = 'missing';
      else if (missing.length > 0) status = 'partial';

      return {
        key,
        runbook,
        status,
        missingVars: missing,
        setVars: set,
        firstSeenMissing: this.firstSeenMissing.get(key) || null,
        resolvedAt: this.resolvedAt.get(key) || null,
      };
    });
  }

  /**
   * Check if any credentials have been newly resolved since the last check.
   * Returns the keys of credentials that transitioned from missing → ready.
   */
  getNewlyResolved(): string[] {
    const resolved: string[] = [];
    for (const [key, runbook] of this.runbooks) {
      const allSet = runbook.envVars.every((v) => process.env[v]);
      const wasMissing = this.firstSeenMissing.has(key);
      const alreadyRecorded = this.resolvedAt.has(key);

      if (allSet && wasMissing && !alreadyRecorded) {
        this.resolvedAt.set(key, new Date().toISOString());
        resolved.push(key);
      }
    }
    return resolved;
  }

  /**
   * Generate a human-readable escalation message for a missing credential.
   */
  generateEscalationMessage(capabilityId: string): string | null {
    const runbook = this.getRunbookForCapability(capabilityId);
    if (!runbook) return null;

    const missing = runbook.envVars.filter((v) => !process.env[v]);
    if (missing.length === 0) return null;

    const lines: string[] = [];
    lines.push(`BLOCKED: ${runbook.service}`);
    lines.push(`Capability: ${runbook.capabilityId}`);
    lines.push(`Missing: ${missing.join(', ')}`);
    lines.push(`Priority: ${runbook.priority}/4 (${runbook.priority === 1 ? 'HIGHEST — gates revenue' : runbook.priority === 2 ? 'high — gates outreach' : runbook.priority === 3 ? 'medium — gates auto-discovery' : 'low — email covers same job'})`);
    lines.push(`Time: ${runbook.estimatedTime}`);
    lines.push(`Cost: ${runbook.cost}`);
    lines.push('');
    lines.push('Steps:');
    for (const step of runbook.steps) {
      lines.push(`  ${step.step}. ${step.action}`);
      if (step.url) lines.push(`     URL: ${step.url}`);
      lines.push(`     Expected: ${step.expected}`);
    }
    if (runbook.alternatives && runbook.alternatives.length > 0) {
      lines.push('');
      lines.push('Alternatives:');
      for (const alt of runbook.alternatives) {
        lines.push(`  - ${alt.description}`);
      }
    }
    lines.push('');
    lines.push(`Verification: ${runbook.verification.description}`);
    lines.push(`Add to .env.local: ${missing.map((v) => `${v}=...`).join(', ')}`);

    return lines.join('\n');
  }

  private getKeyForRunbook(runbook: CredentialRunbook): string {
    for (const [key, rb] of this.runbooks) {
      if (rb === runbook) return key;
    }
    return runbook.capabilityId;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

let registryInstance: CredentialRunbookRegistry | null = null;

export function getCredentialRunbookRegistry(): CredentialRunbookRegistry {
  if (!registryInstance) {
    registryInstance = new CredentialRunbookRegistry();
  }
  return registryInstance;
}
