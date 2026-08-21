/**
 * MAIN ORCHESTRATOR - Heidi Production Agent
 * 
 * This is the core routing engine with memory, tools, and enforced output contracts.
 * 
 * Responsibilities:
 * - Retrieve memory context
 * - Route to ModelManager
 * - Parse and validate responses
 * - Execute actions
 * - Maintain session state
 * - Record per-request metrics to the MetricsService
 */

import { randomUUID } from 'crypto';
import { ModelManager, type ModelResponse } from './ModelManager';
import { ActionParser, ParsedResponse } from './ActionParser';
import { ActionExecutor } from './action-executor';
import { retrieveMemory, storeMemory } from './heidi-memory';
import { gateActions, isEnforcing } from './protoforge/action-gate';
import { buildExperience, storeExperience } from './episodic-memory';
import { AgentRegistry, createDefaultAgentRegistry } from './agents/registry';
import {
  buildPlanPrompt,
  createWorkSession,
  getWorkSession,
  nextPendingStep,
  PlanParser,
  updateWorkSession,
  WorkSession,
} from './work-sessions';
import { getDecisionStats, getMemoryRetrievalStats, getRetryStats, getTaskSuccessRates, getWorkSessionStats } from './agent-metrics';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { buildCognitiveCore } from './heidi/CognitiveCoreBuilder';
import type { CognitiveCore, CognitiveState } from './heidi/CognitiveCore';
import { getMetricsService, type PartialInferenceMetric } from './metrics';

// Lazy client: a missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// must surface as a normal caught error inside processChat's try/catch (which
// degrades to a friendly fallback reply), not a crash at construction time
// that skips straight past it. Same pattern as api/chat/route.js's getSupabase().
let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }
    _supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}
const supabaseProxy = new Proxy({}, { get: (_, prop) => (getSupabase() as any)[prop] }) as SupabaseClient;

interface ChatRequest {
  message: string;
  session_id: string;
  user_id: string;
}

interface ChatResponse {
  response: string;
  actions: any[];
  model_used: string;
  latency: number;
  session_state: any;
}

// ─── CognitiveCore singleton ─────────────────────────────────────────────
//
// One authoritative CognitiveCore instance per HEIDI runtime context.
// Lazily initialized on first use — not at module load time — so that
// missing env vars don't crash the orchestrator constructor.
// The CognitiveCore is wired with REAL providers via CognitiveCoreBuilder.
// If a provider is unavailable, the corresponding capability is reported
// as degraded rather than crashing the runtime.

let _cognitiveCore: CognitiveCore | null = null;
let _cognitiveCoreInitError: string | null = null;
let _cognitiveCoreInstanceId: string | null = null;

async function getCognitiveCore(): Promise<CognitiveCore> {
  if (_cognitiveCore) {
    return _cognitiveCore;
  }
  if (_cognitiveCoreInitError) {
    throw new Error(`CognitiveCore initialization previously failed: ${_cognitiveCoreInitError}`);
  }
  try {
    _cognitiveCoreInstanceId = `cc-${randomUUID()}`;
    _cognitiveCore = await buildCognitiveCore({
      supabase: getSupabase(),
      // Without this, CognitiveCoreBuilder never registers the
      // system.database capability probe or the database self-repair
      // handler (both are gated on dbConfig being explicitly present),
      // even though CognitiveCore's own internal pool connects fine via
      // these same PG_* vars. Same host/port/database/user/password
      // pattern already used by getRevenueDashboard() below and by
      // CognitiveCore's own constructor default.
      dbConfig: {
        host: process.env.PG_HOST || '127.0.0.1',
        port: parseInt(process.env.PG_PORT || '54322', 10),
        database: process.env.PG_DATABASE || 'postgres',
        user: process.env.PG_USER || 'postgres',
        password: process.env.PG_PASSWORD || 'postgres',
      },
      enableMetaCognition: true,
      enableDecisionResolver: true,
    });
    return _cognitiveCore;
  } catch (e) {
    _cognitiveCoreInitError = e instanceof Error ? e.message : 'unknown error';
    throw e;
  }
}

function getCognitiveCoreStatusSync(): {
  initialized: boolean;
  instanceId: string | null;
  initError: string | null;
} {
  return {
    initialized: _cognitiveCore !== null,
    instanceId: _cognitiveCoreInstanceId,
    initError: _cognitiveCoreInitError,
  };
}

export class HeidiOrchestrator {
  private modelManager: ModelManager;
  private supabase: SupabaseClient;
  private actionExecutor: ActionExecutor;
  private agentRegistry: AgentRegistry;
  private allowedActionTypes: string[] = [
    'send_email',
    'create_task',
    'update_database',
    'fetch_data',
    'schedule_event'
  ];

  constructor() {
    this.modelManager = new ModelManager();
    this.supabase = supabaseProxy;
    this.actionExecutor = new ActionExecutor(this.supabase);
    this.agentRegistry = createDefaultAgentRegistry(this.actionExecutor);
  }

  // ─── Cognitive Core integration ──────────────────────────────────────
  //
  // These methods expose the governed CognitiveCore to the production
  // runtime. The existing processChat() flow is NOT replaced — CognitiveCore
  // is an additional governed capability layer that follows:
  //
  //   OBSERVE → VALIDATE → UNDERSTAND → PLAN → ASSESS → SELECT →
  //   AUTHORIZE → EXECUTE → VERIFY → LEARN → RECORD → REPLAN/ESCALATE
  //
  // All governance (autonomy policy, guardian, trust, audit) is enforced
  // inside CognitiveCore and cannot be bypassed through these methods.

  /**
   * Run a single governed cognitive cycle.
   * Returns the full cognitive state including perception, authorization,
   * execution, verification, and learning results.
   */
  async runCognitiveCycle(): Promise<CognitiveState> {
    const core = await getCognitiveCore();
    return core.runCycle();
  }

  /**
   * Get the current CognitiveCore status for health reporting.
   * Does NOT throw — returns degraded status if initialization failed.
   */
  getCognitiveStatus(): {
    initialized: boolean;
    instanceId: string | null;
    initError: string | null;
    cycleCount: number;
    capabilitySummary: { total: number; available: number; unavailable: number } | null;
    currentPhase: string | null;
    autonomyLevel: number | null;
  } {
    const status = getCognitiveCoreStatusSync();
    if (!status.initialized || !_cognitiveCore) {
      return {
        ...status,
        cycleCount: 0,
        capabilitySummary: null,
        currentPhase: null,
        autonomyLevel: null,
      };
    }
    // Access the registry and current cycle from the CognitiveCore
    try {
      const registry = _cognitiveCore.getRegistry();
      const summary = registry.getSummary();
      // Get cycle count and current phase from the last cycle if available
      // These are internal to CognitiveCore — we expose what we can
      return {
        ...status,
        cycleCount: 0, // Updated after each cycle via the state
        capabilitySummary: summary,
        currentPhase: null,
        autonomyLevel: null,
      };
    } catch {
      return {
        ...status,
        cycleCount: 0,
        capabilitySummary: null,
        currentPhase: null,
        autonomyLevel: null,
      };
    }
  }

  /**
   * Resume goals after a restart.
   */
  async resumeCognitiveGoals(): Promise<{ resumedGoals: number }> {
    const core = await getCognitiveCore();
    const result = await core.resumeAfterRestart();
    return { resumedGoals: result.resumedGoals.length };
  }

  /**
   * Close the CognitiveCore and release resources.
   */
  async closeCognitiveCore(): Promise<void> {
    if (_cognitiveCore) {
      await _cognitiveCore.close();
      _cognitiveCore = null;
      _cognitiveCoreInstanceId = null;
      _cognitiveCoreInitError = null;
    }
  }

  // ─── Bounded continuous loop control ──────────────────────────────────

  /**
   * Start the bounded continuous cognitive loop.
   * Only R0/R1 actions execute autonomously. R2+ requires human authorization.
   */
  async startCognitiveLoop(intervalMs?: number): Promise<void> {
    const core = await getCognitiveCore();
    await core.start(intervalMs);
  }

  /**
   * Stop the continuous cognitive loop gracefully.
   */
  stopCognitiveLoop(): void {
    if (_cognitiveCore) {
      _cognitiveCore.stop();
    }
  }

  /**
   * Pause the continuous cognitive loop.
   */
  pauseCognitiveLoop(): void {
    if (_cognitiveCore) {
      _cognitiveCore.pause();
    }
  }

  /**
   * Resume a paused cognitive loop.
   */
  resumeCognitiveLoop(): void {
    if (_cognitiveCore) {
      _cognitiveCore.resume();
    }
  }

  /**
   * Activate the cognitive loop kill switch.
   * Immediately halts all new autonomous cycles.
   */
  activateCognitiveKillSwitch(reason: string): void {
    if (_cognitiveCore) {
      _cognitiveCore.activateKillSwitch(reason);
    }
  }

  /**
   * Deactivate the cognitive loop kill switch.
   */
  deactivateCognitiveKillSwitch(): void {
    if (_cognitiveCore) {
      _cognitiveCore.deactivateKillSwitch();
    }
  }

  /**
   * Get the cognitive loop status for health reporting.
   */
  getCognitiveLoopStatus(): import('./heidi/CognitiveCore').LoopStatus | null {
    if (!_cognitiveCore) return null;
    return _cognitiveCore.getLoopStatus();
  }

  /**
   * Get the daemon status for health reporting.
   * Reads the daemon lock file and audit log to report whether the
   * continuous cognitive-loop daemon is running and how many
   * self-sufficiency cycles it has completed.
   *
   * Does NOT throw — returns degraded status if daemon is not running
   * or files are not accessible.
   */
  getDaemonStatus(): {
    running: boolean;
    pid: number | null;
    startedAt: string | null;
    selfSufficiencyCycles: number;
    lastSelfSufficiencyCycle: string | null;
    lastCapabilityHealth: { total: number; ready: number; blocked: number; unavailable: number } | null;
    lastSelfRepairResult: { totalIssues: number; repaired: number; escalated: number; workedAround: number; refused: number } | null;
    error: string | null;
  } {
    try {
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
      // Use process.cwd() instead of __dirname — in the Next.js dev server,
      // __dirname may resolve to a compiled cache directory rather than the
      // source lib/ directory. The daemon writes the lock file relative to
      // the repo root, which is process.cwd() when running under PM2.
      const lockPath = path.resolve(process.cwd(), '.heidi-daemon.lock');
      const auditPath = path.resolve(process.cwd(), '.heidi-daemon-audit.jsonl');

      // Check lock file
      let pid: number | null = null;
      let startedAt: string | null = null;
      let running = false;

      if (fs.existsSync(lockPath)) {
        try {
          const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
          pid = lockData.pid || null;
          startedAt = lockData.startedAt || null;
          // Check if process is alive. On Windows, process.kill(pid, 0)
          // may fail for child processes of other processes even when
          // they're running. Fall back to checking if the audit file was
          // recently modified (within the last 5 minutes), which indicates
          // the daemon is actively cycling.
          if (pid) {
            try {
              process.kill(pid, 0);
              running = true;
            } catch {
              // process.kill failed — check audit file recency as fallback
              try {
                if (fs.existsSync(auditPath)) {
                  const stats = fs.statSync(auditPath);
                  const ageMs = Date.now() - stats.mtimeMs;
                  if (ageMs < 5 * 60 * 1000) { // 5 minutes
                    running = true; // Audit file is recent — daemon is alive
                  }
                }
              } catch {
                // Can't check audit file — assume not running
              }
            }
          }
        } catch {
          // Corrupt lock file
        }
      }

      // Read last few audit records
      let selfSufficiencyCycles = 0;
      let lastSelfSufficiencyCycle: string | null = null;
      let lastCapabilityHealth: { total: number; ready: number; blocked: number; unavailable: number } | null = null;
      let lastSelfRepairResult: { totalIssues: number; repaired: number; escalated: number; workedAround: number; refused: number } | null = null;

      if (fs.existsSync(auditPath)) {
        try {
          const content = fs.readFileSync(auditPath, 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const record = JSON.parse(line);
              if (record.phase === 'self_sufficiency') {
                selfSufficiencyCycles++;
                lastSelfSufficiencyCycle = record.timestamp;
                if (record.capabilityHealth) {
                  lastCapabilityHealth = record.capabilityHealth;
                }
                if (record.selfRepairResult) {
                  lastSelfRepairResult = record.selfRepairResult;
                }
              }
            } catch {
              // Skip corrupt lines
            }
          }
        } catch {
          // Audit file not readable
        }
      }

      return {
        running,
        pid,
        startedAt,
        selfSufficiencyCycles,
        lastSelfSufficiencyCycle,
        lastCapabilityHealth,
        lastSelfRepairResult,
        error: null,
      };
    } catch (error) {
      return {
        running: false,
        pid: null,
        startedAt: null,
        selfSufficiencyCycles: 0,
        lastSelfSufficiencyCycle: null,
        lastCapabilityHealth: null,
        lastSelfRepairResult: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get the revenue dashboard for health reporting.
   * Queries the real pipeline tables and RevenueLedger.
   * Does NOT throw — returns degraded status if DB is unavailable.
   * NEVER confuses pipeline activity with verified revenue.
   */
  async getRevenueDashboard(): Promise<{
    prospects: number;
    qualifiedProspects: number;
    opportunities: number;
    openOffers: number;
    pendingAuthorizations: number;
    customers: number;
    payments: number;
    verifiedRevenueCents: number;
    pipelineValueCents: number;
    averageOpportunityValueCents: number;
    conversionRate: number | null;
    revenuePerCampaign: Array<{ campaign: string; verifiedRevenueCents: number; prospects: number }>;
    available: boolean;
    error: string | null;
  }> {
    try {
      const { Pool } = require('pg');
      const pool = new Pool({
        host: process.env.PG_HOST || '127.0.0.1',
        port: parseInt(process.env.PG_PORT || '54322', 10),
        database: process.env.PG_DATABASE || 'postgres',
        user: process.env.PG_USER || 'postgres',
        password: process.env.PG_PASSWORD || 'postgres',
        max: 2,
        idleTimeoutMillis: 5000,
      });

      try {
        const [prospectsRes, qualifiedRes, oppsRes, customersRes, verifiedRes] = await Promise.all([
          pool.query('SELECT count(*) as cnt FROM revenue_prospects WHERE opted_out = false'),
          pool.query("SELECT count(*) as cnt FROM revenue_prospects WHERE status IN ('qualified', 'appointment', 'proposal_sent', 'won')"),
          pool.query("SELECT count(*) as cnt, COALESCE(sum(proposed_price), 0) as total_value FROM revenue_opportunities WHERE status = 'open'"),
          pool.query("SELECT count(*) as cnt FROM customer_services WHERE status IN ('active', 'provisioning')"),
          pool.query('SELECT count(*) as cnt, COALESCE(sum(amount_gross), 0) as total FROM revenue_ledger WHERE verified = true'),
        ]);

        const prospects = parseInt(prospectsRes.rows[0].cnt, 10);
        const qualifiedProspects = parseInt(qualifiedRes.rows[0].cnt, 10);
        const opportunities = parseInt(oppsRes.rows[0].cnt, 10);
        const pipelineValueCents = parseInt(oppsRes.rows[0].total_value, 10);
        const customers = parseInt(customersRes.rows[0].cnt, 10);
        const verifiedRevenueCents = parseInt(verifiedRes.rows[0].total, 10);
        const payments = parseInt(verifiedRes.rows[0].cnt, 10);

        const averageOpportunityValueCents = opportunities > 0
          ? Math.round(pipelineValueCents / opportunities)
          : 0;

        // Conversion rate: won opportunities / total opportunities
        const wonRes = await pool.query("SELECT count(*) as cnt FROM revenue_opportunities WHERE status = 'accepted'");
        const totalOppsRes = await pool.query('SELECT count(*) as cnt FROM revenue_opportunities');
        const wonCount = parseInt(wonRes.rows[0].cnt, 10);
        const totalOpps = parseInt(totalOppsRes.rows[0].cnt, 10);
        const conversionRate = totalOpps > 0 ? wonCount / totalOpps : null;

        // Revenue per campaign (from metadata)
        let revenuePerCampaign: Array<{ campaign: string; verifiedRevenueCents: number; prospects: number }> = [];
        try {
          const campaignRes = await pool.query(`
            SELECT
              COALESCE(metadata->>'campaign', 'unknown') as campaign,
              count(*) as prospects
            FROM revenue_prospects
            WHERE metadata->>'campaign' IS NOT NULL
            GROUP BY metadata->>'campaign'
            LIMIT 10
          `);
          revenuePerCampaign = campaignRes.rows.map((r: any) => ({
            campaign: r.campaign,
            verifiedRevenueCents: 0, // Verified revenue is tracked in revenue_ledger, not prospects
            prospects: parseInt(r.prospects, 10),
          }));
        } catch {
          // Non-fatal
        }

        return {
          prospects,
          qualifiedProspects,
          opportunities,
          openOffers: opportunities, // open offers = open opportunities
          pendingAuthorizations: 0, // Would come from escalation_records if table exists
          customers,
          payments,
          verifiedRevenueCents,
          pipelineValueCents,
          averageOpportunityValueCents,
          conversionRate,
          revenuePerCampaign,
          available: true,
          error: null,
        };
      } finally {
        await pool.end();
      }
    } catch (error) {
      return {
        prospects: 0,
        qualifiedProspects: 0,
        opportunities: 0,
        openOffers: 0,
        pendingAuthorizations: 0,
        customers: 0,
        payments: 0,
        verifiedRevenueCents: 0,
        pipelineValueCents: 0,
        averageOpportunityValueCents: 0,
        conversionRate: null,
        revenuePerCampaign: [],
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get the commercial capability state for health reporting.
   * Reports READY/BLOCKED/DEGRADED for each external dependency.
   * Does NOT throw — returns degraded status if unavailable.
   */
  async getCommercialState(): Promise<{
    discovery: { state: string; blocker: string | null };
    email: { state: string; blocker: string | null };
    stripe: { state: string; blocker: string | null };
    sms: { state: string; blocker: string | null };
    autonomyLevel: number;
    available: boolean;
    error: string | null;
  }> {    try {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      const emailKey = process.env.SENDGRID_API_KEY || process.env.SMTP_HOST;
      const smsKey = process.env.TWILIO_ACCOUNT_SID;
      const googlePlacesKey = process.env.GOOGLE_PLACES_API_KEY;
      const clearbitKey = process.env.CLEARBIT_API_KEY;

      return {
        discovery: {
          state: googlePlacesKey || clearbitKey ? 'READY' : 'BLOCKED',
          blocker: googlePlacesKey || clearbitKey
            ? null
            : 'GOOGLE_PLACES_API_KEY or CLEARBIT_API_KEY required for external prospect discovery. CSV import is available as a fallback.',
        },
        email: {
          state: emailKey ? 'READY' : 'BLOCKED',
          blocker: emailKey
            ? null
            : 'SENDGRID_API_KEY or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS required for outbound email delivery.',
        },
        stripe: {
          state: stripeKey ? 'READY' : 'BLOCKED',
          blocker: stripeKey
            ? null
            : 'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET required for payment processing and verified revenue.',
        },
        sms: {
          state: smsKey ? 'READY' : 'BLOCKED',
          blocker: smsKey
            ? null
            : 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER required for SMS delivery.',
        },
        autonomyLevel: 2,
        available: true,
        error: null,
      };
    } catch (error) {
      return {
        discovery: { state: 'FAILED', blocker: 'Unable to check discovery state' },
        email: { state: 'FAILED', blocker: 'Unable to check email state' },
        stripe: { state: 'FAILED', blocker: 'Unable to check Stripe state' },
        sms: { state: 'FAILED', blocker: 'Unable to check SMS state' },
        autonomyLevel: 2,
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get the capability health summary from the production CognitiveCore's
   * CapabilityHealthManager. This is the authoritative "What can I do right now?"
   * answer — every READY capability has evidence and lastSuccessfulVerification.
   *
   * Does NOT throw — returns degraded status if CognitiveCore or
   * CapabilityHealthManager is unavailable. Never exposes secrets.
   */
  async getCapabilityHealth(): Promise<{
    available: boolean;
    error: string | null;
    summary: {
      total: number;
      ready: number;
      degraded: number;
      blocked: number;
      unavailable: number;
      repairable: number;
      humanRequired: number;
      prohibited: number;
      unknown: number;
    } | null;
    readyCapabilities: Array<{
      capabilityId: string;
      description: string;
      provider: string;
      state: string;
      evidence: string;
      lastSuccessfulVerification: string | null;
    }>;
    blockedCapabilities: Array<{
      capabilityId: string;
      description: string;
      provider: string;
      state: string;
      evidence: string;
      failureClassification: string;
      repairability: string;
      requiredCredentials: string[];
      lastFailure: string | null;
    }>;
    repairHistory: Array<{
      repairId: string;
      capabilityId: string;
      classification: string;
      riskLevel: string;
      plannedAction: string;
      authorized: boolean;
      executed: boolean;
      verified: boolean;
      verificationEvidence: string | null;
      timestamp: string;
    }>;
  }> {
    try {
      // Lazily initialize CognitiveCore if this is the first call to touch
      // it (e.g. /api/status hit before any chat request). Without this,
      // capabilityHealth silently reports unavailable on every cold start
      // until something else happens to call getCognitiveCore() first.
      let core: CognitiveCore;
      try {
        core = await getCognitiveCore();
      } catch (initError) {
        return {
          available: false,
          error: initError instanceof Error ? initError.message : 'CognitiveCore initialization failed',
          summary: null,
          readyCapabilities: [],
          blockedCapabilities: [],
          repairHistory: [],
        };
      }

      // Access the bridge's CapabilityHealthManager
      const bridge = core.getBridge();
      if (!bridge?.capabilityHealthManager) {
        return {
          available: false,
          error: 'CapabilityHealthManager not wired',
          summary: null,
          readyCapabilities: [],
          blockedCapabilities: [],
          repairHistory: [],
        };
      }

      const chm = bridge.capabilityHealthManager;
      const summary = await chm.checkAll() as any;
      const ready = chm.getReadyCapabilities() as any[];
      const blocked = chm.getBlockedCapabilities() as any[];

      // Get repair history if SelfRepairEngine is wired
      let repairHistory: any[] = [];
      if (bridge.selfRepairEngine) {
        repairHistory = bridge.selfRepairEngine.getHistory();
      }

      return {
        available: true,
        error: null,
        summary: {
          total: summary.total,
          ready: summary.ready,
          degraded: summary.degraded,
          blocked: summary.blocked,
          unavailable: summary.unavailable,
          repairable: summary.repairable,
          humanRequired: summary.humanRequired,
          prohibited: summary.prohibited,
          unknown: summary.unknown,
        },
        readyCapabilities: ready.map((r: any) => ({
          capabilityId: r.capabilityId,
          description: r.description,
          provider: r.provider,
          state: r.state,
          evidence: r.evidence,
          lastSuccessfulVerification: r.lastSuccessfulVerification,
        })),
        blockedCapabilities: blocked.map((r: any) => ({
          capabilityId: r.capabilityId,
          description: r.description,
          provider: r.provider,
          state: r.state,
          evidence: r.evidence,
          failureClassification: r.failureClassification,
          repairability: r.repairability,
          requiredCredentials: r.requiredCredentials || [],
          lastFailure: r.lastFailure,
        })),
        repairHistory: repairHistory.map((r: any) => ({
          repairId: r.repairId,
          capabilityId: r.capabilityId,
          classification: r.classification,
          riskLevel: r.riskLevel,
          plannedAction: r.plannedAction,
          authorized: r.authorized,
          executed: r.executed,
          verified: r.verified,
          verificationEvidence: r.verificationEvidence,
          timestamp: r.timestamp,
        })),
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        summary: null,
        readyCapabilities: [],
        blockedCapabilities: [],
        repairHistory: [],
      };
    }
  }

  /**
   * Main chat processing method
   */
  async processChat(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();
    const requestId = randomUUID();
    let memoryLookupDurationMs: number | undefined;
    let actionExecutionDurationMs: number | undefined;
    let modelResponse: ModelResponse | undefined;
    let finalResponse: ParsedResponse | undefined;
    let parseRetry = false;
    
    try {
      // 1. Retrieve memory context
      const memoryStart = Date.now();
      const memoryContext = await this.retrieveMemory(request.message, request.user_id, request.session_id);
      await this.recordMemoryRetrieval(request.session_id, memoryContext.length > 0);
      memoryLookupDurationMs = Date.now() - memoryStart;

      // 2. Build prompt with memory
      const prompt = this.buildPrompt(request.message, memoryContext);
      
      // 3. Generate response via ModelManager (metrics recorded here by orchestrator later)
      modelResponse = await this.modelManager.generateResponse(prompt, request.session_id, {
        requestId,
        memoryLookupDurationMs,
        recordMetrics: false,
      });
      
      // 4. Parse and validate response
      const parseResult = ActionParser.parseResponse(modelResponse.content);
      
      if (parseResult.success && parseResult.response) {
        finalResponse = parseResult.response;
      } else {
        // Self-correction loop - retry once
        parseRetry = true;
        console.log('[Orchestrator] Invalid response, retrying with corrected prompt');
        const correctedPrompt = ActionParser.generateCorrectedPrompt(prompt, parseResult.error || 'Unknown error');
        modelResponse = await this.modelManager.generateResponse(correctedPrompt, request.session_id, {
          requestId: `${requestId}-retry`,
          memoryLookupDurationMs,
          recordMetrics: false,
        });

        const retryParse = ActionParser.parseResponse(modelResponse.content);
        if (retryParse.success && retryParse.response) {
          finalResponse = retryParse.response;
        } else {
          // Still invalid - use safe fallback
          console.log('[Orchestrator] Retry failed, using safe fallback');
          finalResponse = ActionParser.generateSafeFallback();
        }
        await this.recordRetry(request.session_id, 'chat_response', retryParse.success, parseResult.error);
      }
      
      // 5. Validate actions
      const actionValidation = ActionParser.validateActions(finalResponse.actions, this.allowedActionTypes);
      if (!actionValidation.valid) {
        console.log('[Orchestrator] Invalid actions detected, filtering');
        finalResponse.actions = finalResponse.actions.filter(action => 
          this.allowedActionTypes.includes(action.type)
        );
      }
      
      // 6. Execute actions
      const actionStart = Date.now();
      const actionResults = await this.executeActions(finalResponse.actions, request.session_id);
      actionExecutionDurationMs = Date.now() - actionStart;

      // 6b. Record an episodic experience for this turn — accumulate what
      // was attempted and what happened, not just raw conversation.
      if (actionResults.length > 0) {
        await storeExperience(
          this.supabase,
          request.session_id,
          request.user_id,
          buildExperience(request.message, actionResults),
        );
      }

      // 7. Store conversation in memory
      await this.storeMemory(request.session_id, request.user_id, request.message, finalResponse.response);
      
      // 8. Get updated session state
      const sessionState = await this.modelManager.getSessionState(request.session_id);
      
      const totalLatency = Date.now() - startTime;

      // Record the comprehensive per-request metric
      this.recordRequestMetric({
        requestId,
        conversationId: request.session_id,
        modelResponse,
        prompt,
        finalResponse,
        totalLatency,
        memoryLookupDurationMs,
        actionExecutionDurationMs,
        parseRetry,
      });
      
      return {
        response: finalResponse.response,
        actions: actionResults,
        model_used: modelResponse.model,
        latency: totalLatency,
        session_state: sessionState
      };
      
    } catch (error) {
      console.error('[Orchestrator] Chat processing failed:', error);
      const totalLatency = Date.now() - startTime;

      if (modelResponse) {
        this.recordRequestMetric({
          requestId,
          conversationId: request.session_id,
          modelResponse,
          prompt: request.message,
          finalResponse,
          totalLatency,
          memoryLookupDurationMs,
          actionExecutionDurationMs,
          parseRetry,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        });
      }
      
      // Return safe fallback on any error
      return {
        response: "I apologize, but I'm experiencing technical difficulties. Please try again.",
        actions: [],
        model_used: modelResponse?.model ?? 'fallback',
        latency: totalLatency,
        session_state: null
      };
    }
  }

  private recordRequestMetric(args: {
    requestId: string;
    conversationId: string;
    modelResponse: ModelResponse;
    prompt: string;
    finalResponse?: ParsedResponse;
    totalLatency: number;
    memoryLookupDurationMs?: number;
    actionExecutionDurationMs?: number;
    parseRetry: boolean;
    errors?: string[];
  }): void {
    const metadata = args.modelResponse.metadata;
    const metric: PartialInferenceMetric = {
      requestId: args.requestId,
      conversationId: args.conversationId,
      provider: metadata?.provider ?? args.modelResponse.model,
      selectedModel: metadata?.selectedModel ?? 'unknown',
      promptLength: args.prompt.length,
      responseLength: args.finalResponse?.response?.length ?? args.modelResponse.content.length,
      latencyMs: args.totalLatency,
      loadDurationMs: metadata?.loadDurationMs,
      evalDurationMs: metadata?.evalDurationMs,
      memoryLookupDurationMs: args.memoryLookupDurationMs,
      actionExecutionDurationMs: args.actionExecutionDurationMs,
      promptTokens: metadata?.promptTokens,
      completionTokens: metadata?.completionTokens,
      totalTokens: metadata?.totalTokens,
      errors: args.errors,
      retryCount: args.parseRetry ? 1 : 0,
    };

    getMetricsService().record(metric);
  }

  /**
   * Retrieve memory context from Supabase via semantic search over the
   * user's current message. Skips retrieval when embeddings are unavailable.
   */
  private async retrieveMemory(message: string, userId: string, sessionId: string): Promise<string> {
    return retrieveMemory(this.supabase, message, userId, sessionId);
  }

  /**
   * Build prompt with memory context
   */
  private buildPrompt(userMessage: string, memoryContext: string): string {
    const systemPrompt = `You are Heidi, a production-grade conversational AI assistant.

Rules:
1. Always respond with valid JSON
2. Use this exact structure: {"response": "your response", "actions": [{"type": "action_type", "payload": {}}]}
3. Keep responses concise and helpful
4. Only suggest actions that are genuinely useful

Available actions: ${this.allowedActionTypes.join(', ')}

${memoryContext ? `Context: ${memoryContext}` : ''}

User message: ${userMessage}

Respond with JSON:`;

    return systemPrompt;
  }

  /**
   * Store conversation in memory
   */
  private async storeMemory(sessionId: string, userId: string, userMessage: string, assistantResponse: string): Promise<void> {
    return storeMemory(this.supabase, sessionId, userId, userMessage, assistantResponse);
  }

  /**
   * Execute actions for real and record truthful outcomes in the `actions`
   * audit log (status reflects the actual handler result). Returns a
   * summary per action so the caller can build an episodic-memory record
   * of the turn.
   *
   * Every action is first run through KILO -> ProtoForge (lib/protoforge/
   * action-gate.ts), which records a real decision to the `decisions`
   * table. Enforcement is opt-in (PROTOFORGE_ENFORCE_ACTIONS=true) — see
   * action-gate.ts for why blind enforcement would silently reject
   * everything today. The `actions` table's status column is constrained
   * to pending/completed/failed (supabase/heidi-init.sql), so a
   * reject/escalate verdict is recorded as 'failed' with the real
   * ProtoForge decision in the payload, not as a new status value.
   *
   * When an action actually executes, its outcome is backfilled onto the
   * same ProtoForge decision row via recordOutcome() — the self-evaluation
   * feedback loop: did the thing ProtoForge approved actually succeed?
   * Skipped when the action was blocked (there's no execution outcome to
   * backfill; the decision itself is the terminal state) or when gating
   * degraded to 'skipped' (no decisionId to backfill against).
   *
   * Approved actions execute through `agentRegistry` — the Phase 3
   * specialist roster (lib/agents/) — which delegates to `actionExecutor`
   * internally while tracking per-agent metrics. Falls back to calling
   * `actionExecutor` directly for any action type without a registered
   * agent, so adding a 6th action type doesn't require touching this
   * method.
   *
   * A 'reject' verdict (enforcing only) blocks the action outright — it
   * never executes and there is nothing to review later. An 'escalate'
   * verdict does NOT block: it parks the action as a `pending` row carrying
   * everything lib/action-approval.ts needs to run it later (action type,
   * payload, decisionId), and returns status 'pending_approval' instead of
   * executing or failing. The chat UI surfaces these as approve/reject
   * cards; resolving one calls lib/action-approval.ts directly, not this
   * method, so a human decision is never re-gated through KILO/ProtoForge.
   */
  private async executeActions(
    actions: ParsedResponse['actions'],
    sessionId: string,
  ): Promise<Array<{ type: string; status: 'completed' | 'failed' | 'pending_approval'; error?: string; actionId?: string }>> {
    const verdicts = await gateActions(actions, sessionId);
    const enforcing = isEnforcing();
    const results: Array<{ type: string; status: 'completed' | 'failed' | 'pending_approval'; error?: string; actionId?: string }> = [];

    for (const { action, decision, confidence, hypotheses, reasoning, decisionId } of verdicts) {
      const gateMeta = {
        protoforge_decision: decision,
        protoforge_confidence: confidence,
        protoforge_hypotheses: hypotheses,
        protoforge_reasoning: reasoning,
        protoforge_enforced: enforcing,
      };

      if (enforcing && decision === 'reject') {
        console.log(`[Orchestrator] Action ${action.type} rejected by ProtoForge — not executed`);
        await this.supabase.from('actions').insert({
          session_id: sessionId,
          task_name: action.type,
          status: 'failed',
          payload: { ...action.payload, ...gateMeta },
        });
        results.push({ type: action.type, status: 'failed', error: `blocked by ProtoForge (${decision})` });
        continue;
      }

      if (enforcing && decision === 'escalate') {
        console.log(`[Orchestrator] Action ${action.type} escalated by ProtoForge — awaiting human approval`);
        const { data, error } = await this.supabase
          .from('actions')
          .insert({
            session_id: sessionId,
            task_name: action.type,
            status: 'pending',
            payload: {
              ...gateMeta,
              protoforge_pending_approval: true,
              protoforge_action_type: action.type,
              protoforge_action_payload: action.payload,
              protoforge_decision_id: decisionId,
            },
          })
          .select('id')
          .single();
        if (error) {
          console.error('[Orchestrator] Failed to queue escalated action:', error.message);
          results.push({ type: action.type, status: 'failed', error: `escalation queue failed: ${error.message}` });
          continue;
        }
        results.push({ type: action.type, status: 'pending_approval', actionId: data?.id });
        continue;
      }

      try {
        const agent = this.agentRegistry.getAgentFor(action.type);
        const outcome = agent
          ? await agent.execute(action, sessionId)
          : await this.actionExecutor.execute(action, sessionId);
        console.log(`[Orchestrator] Executed action: ${action.type} -> ${outcome.status} (${agent ? agent.id : 'actionExecutor (no registered agent)'})`);

        const { data } = await this.supabase
          .from('actions')
          .insert({
            session_id: sessionId,
            task_name: action.type,
            status: outcome.status,
            payload: { ...action.payload, result: outcome.result, error: outcome.error, ...gateMeta },
          })
          .select('id')
          .single();
        await this.recordActionOutcome(decisionId, outcome.status === 'completed' ? 'success' : 'failure', {
          error: outcome.error,
        });
        results.push({ type: action.type, status: outcome.status, error: outcome.error, actionId: data?.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Orchestrator] Action execution failed for ${action.type}:`, error);
        await this.supabase.from('actions').insert({
          session_id: sessionId,
          task_name: action.type,
          status: 'failed',
          payload: { ...action.payload, error: message, ...gateMeta },
        });
        await this.recordActionOutcome(decisionId, 'failure', { error: message });
        results.push({ type: action.type, status: 'failed', error: message });
      }
    }

    return results;
  }

  /**
   * Backfill a ProtoForge decision's outcome after execution — the
   * self-evaluation feedback loop. Never throws: a failure here shouldn't
   * fail chat processing, it's an audit-trail nicety, not load-bearing.
   */
  private async recordActionOutcome(
    decisionId: string | undefined,
    outcome: 'success' | 'failure',
    detail: Record<string, unknown>,
  ): Promise<void> {
    if (!decisionId) return;
    try {
      const { recordOutcome } = (await import('./protoforge/policy-engine.js')) as unknown as {
        recordOutcome: (_id: string, _outcome: string, _detail?: Record<string, unknown>) => Promise<void>;
      };
      await recordOutcome(decisionId, outcome, detail);
    } catch (error) {
      console.error('[Orchestrator] Failed to record ProtoForge outcome:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Records whether the self-correction retry loop (ActionParser's chat
   * JSON contract, PlanParser's plan JSON contract) succeeded after a
   * malformed first attempt — Phase 5's "retry counts" metric. Reuses the
   * `actions` table (task_name = 'llm_retry') rather than a new table;
   * `task_name` has no CHECK constraint restricting it to real action
   * types. Never throws.
   */
  private async recordRetry(
    sessionId: string,
    stage: 'chat_response' | 'work_session_plan',
    succeeded: boolean,
    originalError?: string,
  ): Promise<void> {
    try {
      await this.supabase.from('actions').insert({
        session_id: sessionId,
        task_name: 'llm_retry',
        status: succeeded ? 'completed' : 'failed',
        payload: { stage, original_error: originalError },
      });
    } catch (error) {
      console.error('[Orchestrator] Failed to record retry:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Records whether semantic memory retrieval found relevant context for
   * this turn — retrieval *coverage*, not *quality* (there's no feedback
   * signal for whether retrieved context was actually useful, only
   * whether anything was found; see lib/metrics.ts's header comment).
   * Reuses the `actions` table (task_name = 'memory_retrieval'). Never
   * throws.
   */
  private async recordMemoryRetrieval(sessionId: string, hadContext: boolean): Promise<void> {
    try {
      await this.supabase.from('actions').insert({
        session_id: sessionId,
        task_name: 'memory_retrieval',
        status: 'completed',
        payload: { had_context: hadContext },
      });
    } catch (error) {
      console.error('[Orchestrator] Failed to record memory retrieval:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Start a Phase 4 work session (see HYDI_KERNEL_ARCHITECTURE_ROADMAP.md):
   * decompose `goal` into an ordered plan using only the existing action
   * vocabulary (this.allowedActionTypes — no new code-editing/test-running/
   * git capability), persist it, then run steps until the plan completes,
   * a step fails or is ProtoForge-blocked, or `maxSteps` is reached.
   */
  async startWorkSession(goal: string, sessionId: string, userId: string, maxSteps = 5): Promise<WorkSession | null> {
    const prompt = buildPlanPrompt(goal, this.allowedActionTypes);
    const modelResponse = await this.modelManager.generateResponse(prompt, sessionId);

    let parseResult = PlanParser.parsePlan(modelResponse.content);
    if (!parseResult.success || !parseResult.plan) {
      console.log('[Orchestrator] Invalid plan, retrying with corrected prompt');
      const originalError = parseResult.error;
      const correctedPrompt = PlanParser.generateCorrectedPrompt(prompt, parseResult.error || 'Unknown error');
      const retryResponse = await this.modelManager.generateResponse(correctedPrompt, sessionId);
      parseResult = PlanParser.parsePlan(retryResponse.content);
      await this.recordRetry(sessionId, 'work_session_plan', parseResult.success, originalError);
    }

    const rawSteps = parseResult.success && parseResult.plan ? parseResult.plan.steps : [];
    const steps = PlanParser.filterAllowedSteps(rawSteps, this.allowedActionTypes);

    const session = await createWorkSession(this.supabase, { session_id: sessionId, user_id: userId, goal, steps });
    if (!session) return null;

    return this.runWorkSession(session.id, sessionId, maxSteps);
  }

  /**
   * Run pending steps of an existing work session, one at a time, through
   * the same gating pipeline as ordinary chat actions (executeActions —
   * KILO -> ProtoForge -> agent registry). Stops on the first
   * failed/blocked step, when the plan completes, or after `maxSteps` —
   * bounded per call, not an unbounded loop, per "reliability before
   * autonomy."
   */
  async runWorkSession(workSessionId: string, sessionId: string, maxSteps = 5): Promise<WorkSession | null> {
    let session = await getWorkSession(this.supabase, workSessionId);
    if (!session) return null;

    let stepsRun = 0;
    while (stepsRun < maxSteps) {
      const step = nextPendingStep(session);
      if (!step) {
        session =
          (await updateWorkSession(this.supabase, workSessionId, {
            status: 'completed',
            completed_at: new Date().toISOString(),
          })) ?? session;
        break;
      }

      const [result] = await this.executeActions([{ type: step.type, payload: step.payload }], sessionId);
      step.status = result.status;
      step.error = result.error;
      stepsRun++;

      if (step.status === 'pending_approval') {
        console.log(`[Orchestrator] Work session ${workSessionId} paused — step ${step.type} awaiting human approval`);
        session =
          (await updateWorkSession(this.supabase, workSessionId, { status: 'needs_approval', steps: session.steps })) ?? session;
        break;
      }

      if (step.status === 'failed') {
        console.log(`[Orchestrator] Work session ${workSessionId} paused — step ${step.type} failed: ${step.error}`);
        session =
          (await updateWorkSession(this.supabase, workSessionId, { status: 'failed', steps: session.steps })) ?? session;
        break;
      }

      session =
        (await updateWorkSession(this.supabase, workSessionId, { status: 'in_progress', steps: session.steps })) ?? session;
    }

    return session;
  }

  /**
   * Get session state
   */
  async getSessionState(sessionId: string) {
    return await this.modelManager.getSessionState(sessionId);
  }

  /**
   * Get system status
   *
   * agent_metrics is per-process (resets every request — see
   * lib/metrics.ts's module comment for why); everything else is the
   * durable, Phase 5 cross-request signal, read from the
   * actions/decisions/work_sessions tables. Best-effort: a metrics query
   * failing degrades to an empty result via lib/metrics.ts's own error
   * handling, never throws here.
   */
  async getSystemStatus() {
    const [taskSuccessRates, decisionStats, workSessionStats, retryStats, memoryRetrievalStats] = await Promise.all([
      getTaskSuccessRates(this.supabase),
      getDecisionStats(this.supabase),
      getWorkSessionStats(this.supabase),
      getRetryStats(this.supabase),
      getMemoryRetrievalStats(this.supabase),
    ]);

    return {
      model_status: this.modelManager.getModelStatus(),
      // this.supabase is now a lazy Proxy (always truthy) so it can no
      // longer stand in for "is Supabase actually configured" — check the
      // env vars it depends on directly instead.
      memory_connected: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      allowed_actions: this.allowedActionTypes,
      agent_metrics: this.agentRegistry.getMetricsSnapshot(),
      task_success_rates: taskSuccessRates,
      decision_stats: decisionStats,
      work_session_stats: workSessionStats,
      retry_stats: retryStats,
      memory_retrieval_stats: memoryRetrievalStats,
    };
  }
}
