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
  /** Pre-built ActionExecutor instance. If absent, one is created (requires supabase). */
  actionExecutor?: import('../action-executor').ActionExecutor;
  /** Enable meta-cognition integration (requires heidi-core/meta-cognition.js) */
  enableMetaCognition?: boolean;
  /** Enable decision resolver integration (requires heidi-core/decision-resolver.js) */
  enableDecisionResolver?: boolean;
  /** Override individual bridge components for testing */
  bridgeOverrides?: Partial<ExecutionBridge>;
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
