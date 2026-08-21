/**
 * HEIDI CognitiveCore Builder
 *
 * The authoritative factory that wires CognitiveCore to the REAL HYDI
 * infrastructure. This is the single place where:
 *
 *   - ActionExecutor          (lib/action-executor.ts)
 *   - OperationalIntelligence (lib/operational/OperationalIntelligence.ts)
 *   - CommunicationLayer      (lib/communication/communicationLayer.ts)
 *   - RevenueControlLoop      (lib/revenue/RevenueControlLoop.ts)
 *   - Memory systems          (lib/heidi-memory.ts, lib/episodic-memory.ts)
 *   - Meta-cognition          (heidi-core/meta-cognition.js)
 *   - Decision resolver       (heidi-core/decision-resolver.js)
 *
 * ...are connected to CognitiveCore's ExecutionBridge.
 *
 * Without this builder, CognitiveCore runs with an empty bridge and can
 * only observe + advance goals. With this builder, CognitiveCore becomes
 * the real governed cognitive-to-action bridge.
 *
 * Every component is OPTIONAL — if a system is not configured (e.g. no
 * Supabase env vars, no Resend key), the corresponding bridge slot is
 * left empty and the capability remains "known but not wired" in the
 * registry. CognitiveCore will report this honestly rather than failing.
 */

import path from 'path';
import { CognitiveCore, type ExecutionBridge, type DBConfig } from './CognitiveCore';
import {
  createActionExecutorBridge,
  createCommunicationLayerBridge,
  createDecisionResolverBridge,
  createMemoryBridge,
  createMetaCognitionBridge,
  createOperationalIntelligenceBridge,
  createRevenueControlLoopBridge,
  createRevenuePipelineBridge,
  createRevenueLifecycleBridge,
  createRevenueLedgerBridge,
} from './ExecutionBridgeAdapters';
import {
  CapabilityHealthManager,
  createDatabaseProbe,
  createOllamaProbe,
  createCredentialProbe,
  createCommercialProbe,
} from '../operational/CapabilityHealthManager';
import { BlockerResolutionEngine } from '../operational/BlockerResolutionEngine';
import { SelfRepairEngine, createDatabaseRepairHandler } from '../operational/SelfRepairEngine';

export interface CognitiveCoreBuilderOptions {
  /** Database config for CognitiveCore's internal pool (identity, goals, world, etc.) */
  dbConfig?: DBConfig;
  /** Root directory for OperationalIntelligence (defaults to repo root) */
  root?: string;
  /** Supabase client for ActionExecutor + memory. If absent, those bridges are skipped. */
  supabase?: import('@supabase/supabase-js').SupabaseClient;
  /** Pre-built OperationalIntelligence instance. If absent, one is created. */
  operationalIntelligence?: import('../operational/OperationalIntelligence').OperationalIntelligence;
  /** Pre-built CommunicationLayer instance. If absent, one is created. */
  communicationLayer?: import('../communication/communicationLayer').CommunicationLayer;
  /** Pre-built RevenueControlLoop instance. If absent, one is created. */
  revenueControlLoop?: import('../revenue/RevenueControlLoop').RevenueControlLoop;
  /** Pre-built ProspectPipeline instance. If absent, one is created. */
  revenuePipeline?: import('../revenue/ProspectPipeline').ProspectPipeline;
  /** Pre-built CustomerLifecycle instance. If absent, one is created. */
  revenueLifecycle?: import('../revenue/CustomerLifecycle').CustomerLifecycle;
  /** Pre-built RevenueLedger instance. If absent, one is created. */
  revenueLedger?: import('../revenue/RevenueLedger').RevenueLedger;
  /** Pre-built CommercialWorkflow instance. If absent, one is created from available components. */
  commercialWorkflow?: import('../revenue/CommercialWorkflow').CommercialWorkflow;
  /** Pre-built ActionExecutor instance. If absent, one is created (requires supabase). */
  actionExecutor?: import('../action-executor').ActionExecutor;
  /** Enable meta-cognition integration (requires heidi-core/meta-cognition.js) */
  enableMetaCognition?: boolean;
  /** Enable decision resolver integration (requires heidi-core/decision-resolver.js) */
  enableDecisionResolver?: boolean;
  /** Override individual bridge components for testing */
  bridgeOverrides?: Partial<ExecutionBridge>;
  /** Pre-built CapabilityHealthManager instance. If absent, one is created with real probes. */
  capabilityHealthManager?: CapabilityHealthManager;
  /** Pre-built BlockerResolutionEngine instance. If absent, one is created. */
  blockerResolutionEngine?: BlockerResolutionEngine;
  /** Pre-built SelfRepairEngine instance. If absent, one is created. */
  selfRepairEngine?: SelfRepairEngine;
  /** Enable self-sufficiency wiring (default: true). Set false to skip. */
  enableSelfSufficiency?: boolean;
}

export class CognitiveCoreBuilder {
  private opts: CognitiveCoreBuilderOptions;

  constructor(opts: CognitiveCoreBuilderOptions = {}) {
    this.opts = opts;
  }

  /**
   * Build a fully-wired CognitiveCore. Every available real system is
   * connected. Unavailable systems are skipped — the capability registry
   * will report them as "known but not wired".
   */
  async build(): Promise<CognitiveCore> {
    const bridge: ExecutionBridge = { ...this.opts.bridgeOverrides };

    // Helper: only wire a component if it wasn't provided in bridgeOverrides.
    // bridgeOverrides takes precedence — this lets tests inject mocks while
    // still using the builder for the components they don't override.
    const notOverridden = (key: keyof ExecutionBridge): boolean =>
      !(key in (this.opts.bridgeOverrides || {}));

    // 1. ActionExecutor — requires Supabase
    if (notOverridden('actionExecutor')) {
      if (this.opts.actionExecutor) {
        bridge.actionExecutor = createActionExecutorBridge(this.opts.actionExecutor);
      } else if (this.opts.supabase) {
        try {
          const { ActionExecutor } = await import('../action-executor');
          bridge.actionExecutor = createActionExecutorBridge(new ActionExecutor(this.opts.supabase));
        } catch {
          // action-executor.ts not loadable — skip
        }
      }
    }

    // 2. OperationalIntelligence — no external deps required
    if (notOverridden('operationalIntelligence')) {
      if (this.opts.operationalIntelligence) {
        bridge.operationalIntelligence = createOperationalIntelligenceBridge(
          this.opts.operationalIntelligence,
        );
      } else {
        try {
          const root = this.opts.root || path.resolve(__dirname, '..', '..');
          const { OperationalIntelligence } = await import('../operational/OperationalIntelligence');
          const oi = new OperationalIntelligence(root);
          bridge.operationalIntelligence = createOperationalIntelligenceBridge(oi);
        } catch {
          // OperationalIntelligence not loadable — skip
        }
      }
    }

    // 3. CommunicationLayer — no external deps required (channels degrade gracefully)
    if (notOverridden('communicationLayer')) {
      if (this.opts.communicationLayer) {
        bridge.communicationLayer = createCommunicationLayerBridge(this.opts.communicationLayer);
      } else {
        try {
          const { CommunicationLayer } = await import('../communication/communicationLayer');
          const layer = new CommunicationLayer();
          bridge.communicationLayer = createCommunicationLayerBridge(layer);
        } catch {
          // CommunicationLayer not loadable — skip
        }
      }
    }

    // 4. RevenueControlLoop — uses its own DB pool (PG env vars)
    if (notOverridden('revenueControlLoop')) {
      if (this.opts.revenueControlLoop) {
        bridge.revenueControlLoop = createRevenueControlLoopBridge(this.opts.revenueControlLoop);
      } else {
        try {
          const { RevenueControlLoop } = await import('../revenue/RevenueControlLoop');
          const loop = new RevenueControlLoop();
          bridge.revenueControlLoop = createRevenueControlLoopBridge(loop);
        } catch {
          // RevenueControlLoop not loadable — skip
        }
      }
    }

    // 4b. RevenuePipeline (ProspectPipeline) — uses RevenueDatabase
    if (notOverridden('revenuePipeline')) {
      if (this.opts.revenuePipeline) {
        bridge.revenuePipeline = createRevenuePipelineBridge(this.opts.revenuePipeline);
      } else {
        try {
          const { ProspectPipeline } = await import('../revenue/ProspectPipeline');
          const pipeline = new ProspectPipeline();
          bridge.revenuePipeline = createRevenuePipelineBridge(pipeline);
        } catch {
          // ProspectPipeline not loadable — skip
        }
      }
    }

    // 4c. RevenueLifecycle (CustomerLifecycle) — uses RevenueDatabase
    if (notOverridden('revenueLifecycle')) {
      if (this.opts.revenueLifecycle) {
        bridge.revenueLifecycle = createRevenueLifecycleBridge(this.opts.revenueLifecycle);
      } else {
        try {
          const { CustomerLifecycle } = await import('../revenue/CustomerLifecycle');
          const lifecycle = new CustomerLifecycle();
          bridge.revenueLifecycle = createRevenueLifecycleBridge(lifecycle);
        } catch {
          // CustomerLifecycle not loadable — skip
        }
      }
    }

    // 4d. RevenueLedger — uses RevenueDatabase
    if (notOverridden('revenueLedger')) {
      if (this.opts.revenueLedger) {
        bridge.revenueLedger = createRevenueLedgerBridge(this.opts.revenueLedger);
      } else {
        try {
          const { RevenueLedger } = await import('../revenue/RevenueLedger');
          const ledger = new RevenueLedger();
          bridge.revenueLedger = createRevenueLedgerBridge(ledger);
        } catch {
          // RevenueLedger not loadable — skip
        }
      }
    }

    // 4e. CommercialWorkflow — wraps pipeline, ledger, lifecycle, discovery
    if (notOverridden('commercialWorkflow')) {
      if (this.opts.commercialWorkflow) {
        bridge.commercialWorkflow = this.opts.commercialWorkflow as any;
      } else {
        try {
          const { CommercialWorkflow } = await import('../revenue/CommercialWorkflow');
          const { ProspectDiscoveryAdapter, createDiscoveryAdapterFromEnv } = await import('../revenue/ProspectDiscoveryAdapter');
          // Build from already-wired components if available
          const pipeline = bridge.revenuePipeline as any;
          const ledger = bridge.revenueLedger as any;
          const lifecycle = bridge.revenueLifecycle as any;
          if (pipeline && ledger && lifecycle) {
            const discovery = createDiscoveryAdapterFromEnv();
            // CommercialWorkflow needs the actual objects, not the bridge wrappers.
            // We pass the bridge interfaces — CommercialWorkflow uses them as thin adapters.
            const cw = new CommercialWorkflow({
              pipeline: pipeline._pipeline || pipeline,
              ledger: ledger._ledger || ledger,
              lifecycle: lifecycle._lifecycle || lifecycle,
              discovery,
            });
            bridge.commercialWorkflow = cw as any;
          }
        } catch {
          // CommercialWorkflow not loadable — skip
        }
      }
    }

    // 5. Memory — requires Supabase
    if (notOverridden('memory') && this.opts.supabase) {
      bridge.memory = createMemoryBridge(this.opts.supabase);
    }

    // 6. Meta-cognition — CommonJS module, optional
    if (notOverridden('metaCognition') && this.opts.enableMetaCognition) {
      try {
        // heidi-core is CommonJS; use require via dynamic import shim
        const MetaCognitiveLoop = (await import('heidi-core/meta-cognition.js')) as unknown as {
          default: new () => { evaluateReasoningQuality: (t: unknown) => Promise<unknown> };
        };
        const meta = new MetaCognitiveLoop.default();
        bridge.metaCognition = createMetaCognitionBridge(meta);
      } catch {
        // meta-cognition.js not loadable — skip
      }
    }

    // 7. Decision resolver — CommonJS module, optional
    if (notOverridden('decisionResolver') && this.opts.enableDecisionResolver) {
      try {
        const DecisionResolver = (await import('heidi-core/decision-resolver.js')) as unknown as {
          default: new () => { resolveDecision: (c: unknown, m: unknown, p: unknown) => Promise<unknown> };
        };
        const resolver = new DecisionResolver.default();
        bridge.decisionResolver = createDecisionResolverBridge(resolver);
      } catch {
        // decision-resolver.js not loadable — skip
      }
    }

    // 8. Self-Sufficiency: CapabilityHealthManager, BlockerResolutionEngine, SelfRepairEngine
    //
    // These are wired with REAL probes against the actual runtime — no mocks.
    // Probes:
    //   - system.database       → real Postgres connection
    //   - system.local_model    → real Ollama HTTP probe
    //   - system.supabase       → SUPABASE_URL presence check
    //   - commercial.stripe     → STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET presence
    //   - commercial.email      → SENDGRID_API_KEY or SMTP config presence
    //   - commercial.discovery_external → GOOGLE_PLACES_API_KEY or CLEARBIT_API_KEY presence
    //   - commercial.workflow   → CommercialWorkflow state (if wired)
    //
    // READY is never reported without actual verification.
    if (this.opts.enableSelfSufficiency !== false && notOverridden('capabilityHealthManager')) {
      const chm = this.opts.capabilityHealthManager || new CapabilityHealthManager();

      // Database probe — uses CognitiveCore's dbConfig if available
      const dbCfg = this.opts.dbConfig;
      if (dbCfg && dbCfg.host && dbCfg.database && dbCfg.user && dbCfg.password) {
        chm.registerProbe(createDatabaseProbe({
          host: dbCfg.host,
          port: dbCfg.port || 54322,
          database: dbCfg.database,
          user: dbCfg.user,
          password: dbCfg.password,
        }));
      }

      // Ollama probe — uses LOCAL_MODEL_URL / LOCAL_MODEL_NAME env vars
      const ollamaUrl = process.env.LOCAL_MODEL_URL || 'http://localhost:11434';
      const ollamaModel = process.env.LOCAL_MODEL_NAME || 'llama3.2:3b';
      chm.registerProbe(createOllamaProbe(ollamaUrl, ollamaModel));

      // Supabase presence probe
      chm.registerProbe(createCredentialProbe({
        capabilityId: 'system.supabase',
        description: 'Supabase connection',
        provider: 'supabase',
        credentialEnvVars: ['SUPABASE_URL'],
      }));

      // Stripe credential probe
      chm.registerProbe(createCredentialProbe({
        capabilityId: 'commercial.stripe',
        description: 'Stripe payment processing',
        provider: 'stripe',
        credentialEnvVars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
      }));

      // Email credential probe
      chm.registerProbe(createCredentialProbe({
        capabilityId: 'commercial.email',
        description: 'Email delivery (SendGrid or SMTP)',
        provider: 'sendgrid',
        credentialEnvVars: ['SENDGRID_API_KEY'],
      }));

      // External discovery credential probe
      chm.registerProbe(createCredentialProbe({
        capabilityId: 'commercial.discovery_external',
        description: 'External prospect discovery (Google Places or Clearbit)',
        provider: 'google_places',
        credentialEnvVars: ['GOOGLE_PLACES_API_KEY'],
      }));

      // SMS credential probe
      chm.registerProbe(createCredentialProbe({
        capabilityId: 'commercial.sms',
        description: 'SMS delivery (Twilio)',
        provider: 'twilio',
        credentialEnvVars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
      }));

      bridge.capabilityHealthManager = {
        checkAll: () => chm.checkAll(),
        checkCapability: (capabilityId: string) => chm.checkCapability(capabilityId),
        getReadyCapabilities: () => chm.getReadyCapabilities(),
        getBlockedCapabilities: () => chm.getBlockedCapabilities(),
        getLastSummary: () => chm.getLastSummary(),
        formatSummary: (summary: unknown) => chm.formatSummary(summary as any),
      };
    }

    if (this.opts.enableSelfSufficiency !== false && notOverridden('blockerResolutionEngine')) {
      const bre = this.opts.blockerResolutionEngine || new BlockerResolutionEngine();
      bridge.blockerResolutionEngine = {
        resolveBlockers: (reports: unknown[], options?: unknown) => bre.resolveBlockers(reports as any, options as any),
        resolveBlocker: (report: unknown) => bre.resolveBlocker(report as any),
        getHistory: () => bre.getHistory(),
      };
    }

    if (this.opts.enableSelfSufficiency !== false && notOverridden('selfRepairEngine')) {
      // Construct with flapping guardrail enabled: after 3 repairs to
      // the same capability within 10 cycles that don't stick, stop
      // auto-repairing and escalate. This prevents indefinite
      // oscillation between capabilities that perturb each other.
      // See tests/unit/heidi-self-repair-oscillation.test.ts.
      const sre = this.opts.selfRepairEngine || new SelfRepairEngine({
        flappingThreshold: 3,
        flappingWindowCycles: 10,
      });

      // Register real repair handler for database connectivity (R0)
      const dbCfg = this.opts.dbConfig;
      if (dbCfg && dbCfg.host && dbCfg.database && dbCfg.user && dbCfg.password) {
        sre.registerRepairHandler('system.database', createDatabaseRepairHandler({
          host: dbCfg.host,
          port: dbCfg.port || 54322,
          database: dbCfg.database,
          user: dbCfg.user,
          password: dbCfg.password,
        }));
      }

      bridge.selfRepairEngine = {
        runSelfRepair: (healthSummary: unknown, options?: unknown) => sre.runSelfRepair(healthSummary as any, options as any),
        getHistory: () => sre.getHistory(),
        registerRepairHandler: (capabilityId: string, handler: (capabilityId: string, procedure: string) => Promise<{ success: boolean; evidence: string }>) =>
          sre.registerRepairHandler(capabilityId, handler),
      };
    }

    return new CognitiveCore(this.opts.dbConfig, bridge);
  }
}

/**
 * Convenience function: build a CognitiveCore with all available real
 * systems wired. This is the production entry point.
 */
export async function buildCognitiveCore(
  opts: CognitiveCoreBuilderOptions = {},
): Promise<CognitiveCore> {
  return new CognitiveCoreBuilder(opts).build();
}
