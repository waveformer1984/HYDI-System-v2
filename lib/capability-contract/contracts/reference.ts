/**
 * Two reference contracts, written out in full.
 *
 * The thesis of this package is that once a capability describes itself
 * completely, the planner never needs to know what it *is*. These two exist
 * to demonstrate that concretely: `repo.run_tests` and `protoforge.print_job`
 * are the same kind of object to every consumer of the registry, differing
 * only in the values of their fields.
 *
 * One takes 90 seconds, costs nothing, is fully reversible and verifies by
 * reading an exit code. The other takes six hours, consumes 84 grams of
 * material, cannot be undone, can start a fire, and verifies by looking at it
 * with a camera. The planner tells them apart by reading numbers, not by
 * having a special case for 3D printers.
 *
 * They are also the template. A capability whose contract cannot be filled in
 * this concretely is not ready to run above R1.
 */

import type { CapabilityContract, SimulationOutcome } from '../types';
import { FDM_PRINT_INTERLOCKS } from '../SafetyInterlock';

// ---------------------------------------------------------------------------
// Software: run the test suite
// ---------------------------------------------------------------------------

export const RUN_TESTS_CONTRACT: CapabilityContract = {
  identity: {
    id: 'repo.run_tests',
    version: '1.0.0',
    owner: 'owner@hydi',
    provider: 'toolchain',
    description: 'Run the jest unit suite for a workspace path',
  },

  signature: {
    params: [
      {
        name: 'testPath',
        type: 'string',
        required: false,
        description: 'Path or pattern to run. Defaults to the whole unit suite.',
        pattern: '^tests/[A-Za-z0-9_./*-]+$',
        resourceRef: 'file_path',
      },
    ],
    returns: '{ passed: number, failed: number, exitCode: number }',
  },

  preconditions: [
    {
      id: 'deps_installed',
      description: 'node_modules is present',
      test: (state) => state.extra.depsInstalled !== false,
      satisfiedBy: 'repo.install_deps',
    },
  ],

  effects: [
    {
      verb: 'read',
      resourceKind: 'file_path',
      resourcePatterns: ['tests/**', 'lib/**', 'src/**'],
      worstCaseScope: 'none',
      crossesTrustBoundary: false,
    },
    {
      // Tests write coverage output and temp fixtures. Declaring it is what
      // keeps the blast radius honest.
      verb: 'create',
      resourceKind: 'file_path',
      resourcePatterns: ['coverage/**', '.jest-cache/**'],
      worstCaseScope: 'single_resource',
      crossesTrustBoundary: false,
    },
  ],

  reversibility: {
    kind: 'self_healing',
    windowMs: Number.POSITIVE_INFINITY,
    caveat: 'Coverage output is regenerated on every run; nothing else is touched.',
  },

  cost: {
    estimatedMs: 90_000,
    timeoutMs: 600_000,
    estimatedCostCents: 0,
    materials: {},
    wearFraction: 0,
  },

  verification: {
    description: 'The suite completed and reported zero failures.',
    observation: {
      source: 'filesystem',
      target: 'coverage/jest-summary.json',
      extractFields: ['numFailedTests', 'numTotalTests', 'success'],
      settleMs: 0,
    },
    conditions: [
      { field: 'success', operator: 'eq', expected: true },
      { field: 'numFailedTests', operator: 'eq', expected: 0 },
      // Guards the failure mode where a config change silently runs no tests
      // and reports a clean pass.
      { field: 'numTotalTests', operator: 'gt', expected: 0 },
    ],
    onFailure: 'replan',
    maxRetries: 0,
    requiresHumanConfirmation: false,
  },

  observability: {
    eventType: 'capability.repo.run_tests',
    redactParams: [],
    metrics: ['tests.duration_ms', 'tests.failed'],
  },

  simulation: {
    supported: true,
    dryRun: async (args): Promise<SimulationOutcome> => ({
      wouldSucceed: true,
      predictedEffects: [
        `would run jest against ${String(args.testPath ?? 'tests/unit')}`,
        'would write coverage/',
      ],
      predictedCost: {
        estimatedMs: 90_000,
        timeoutMs: 600_000,
        estimatedCostCents: 0,
        materials: {},
        wearFraction: 0,
      },
      warnings: [],
      resolvedTargets: [String(args.testPath ?? 'tests/unit')],
    }),
  },

  interlocks: [],
  maxTier: 'R2',
  dependencies: [],
  metadata: { command: 'npx jest' },
};

// ---------------------------------------------------------------------------
// Physical: run a print job
// ---------------------------------------------------------------------------

export const PRINT_JOB_CONTRACT: CapabilityContract = {
  identity: {
    id: 'protoforge.print_job',
    version: '1.0.0',
    owner: 'owner@hydi',
    provider: 'protoforge',
    description: 'Send a sliced job to a printer and run it to completion',
  },

  signature: {
    params: [
      {
        name: 'printerId',
        type: 'string',
        required: true,
        description: 'Target printer',
        enum: ['k1-01', 'k1-02'],
        resourceRef: 'physical_machine',
      },
      {
        name: 'jobPath',
        type: 'string',
        required: true,
        description: 'Sliced .3mf or .gcode to run',
        pattern: '^jobs/[A-Za-z0-9_.-]+\\.(3mf|gcode)$',
        resourceRef: 'file_path',
      },
      {
        name: 'estimatedGrams',
        type: 'number',
        required: true,
        description: 'Material the slicer predicts this job consumes',
      },
    ],
    returns: '{ jobId: string, startedAt: string }',
  },

  preconditions: [
    {
      id: 'printer_idle',
      description: 'The target printer is idle',
      test: (state, args) =>
        state.degradedComponents.indexOf(String(args.printerId)) === -1 &&
        state.extra[`printer.${String(args.printerId)}.state`] === 'idle',
    },
    {
      id: 'material_available',
      description: 'Enough filament is loaded for the predicted consumption',
      test: (state, args) => {
        const loaded = Number(state.extra[`printer.${String(args.printerId)}.grams`] ?? 0);
        return loaded >= Number(args.estimatedGrams ?? 0) * 1.1;
      },
      satisfiedBy: 'protoforge.load_material',
    },
  ],

  effects: [
    {
      verb: 'actuate',
      resourceKind: 'physical_machine',
      resourcePatterns: ['k1-01', 'k1-02'],
      worstCaseScope: 'irreversible_physical',
      crossesTrustBoundary: false,
    },
  ],

  reversibility: {
    kind: 'none',
    windowMs: 0,
    caveat:
      'A job can be cancelled, which stops further extrusion. It does not un-melt ' +
      'filament, un-wear the nozzle, or return the six hours.',
  },

  cost: {
    estimatedMs: 6 * 3_600_000,
    timeoutMs: 8 * 3_600_000,
    estimatedCostCents: 240,
    materials: { grams: 84 },
    wearFraction: 0.02,
  },

  verification: {
    description:
      'The job reported complete AND the part is present on the bed AND no ' +
      'spaghetti-failure signature was detected.',
    observation: {
      source: 'camera',
      target: 'printer/{printerId}/bed',
      extractFields: ['jobState', 'partDetected', 'anomalyScore', 'bedClear'],
      // Let the bed cool and the gantry park before looking.
      settleMs: 120_000,
    },
    conditions: [
      { field: 'jobState', operator: 'eq', expected: 'complete' },
      { field: 'partDetected', operator: 'eq', expected: true },
      { field: 'anomalyScore', operator: 'lt', expected: 0.2 },
    ],
    onFailure: 'escalate',
    maxRetries: 0,
    requiresHumanConfirmation: false,
  },

  observability: {
    eventType: 'capability.protoforge.print_job',
    redactParams: [],
    metrics: ['print.duration_ms', 'print.grams', 'print.failures'],
  },

  simulation: {
    supported: true,
    dryRun: async (args, state): Promise<SimulationOutcome> => {
      const grams = Number(args.estimatedGrams ?? 0);
      const loaded = Number(state.extra[`printer.${String(args.printerId)}.grams`] ?? 0);
      const warnings: string[] = [];

      if (loaded < grams * 1.1) {
        warnings.push(
          `material margin too thin: ${loaded}g loaded for a ${grams}g job (need ${(grams * 1.1).toFixed(0)}g)`,
        );
      }
      if (!state.humanPresent) {
        warnings.push('unattended run — interlocks must be armed and fresh');
      }

      return {
        wouldSucceed: warnings.length === 0,
        predictedEffects: [
          `would run ${String(args.jobPath)} on ${String(args.printerId)}`,
          `would consume ~${grams}g`,
          'would occupy the printer for ~6h',
        ],
        predictedCost: {
          estimatedMs: 6 * 3_600_000,
          timeoutMs: 8 * 3_600_000,
          estimatedCostCents: Math.round(grams * 2.85),
          materials: { grams },
          wearFraction: 0.02,
        },
        warnings,
        resolvedTargets: [String(args.printerId), String(args.jobPath)],
      };
    },
  },

  interlocks: FDM_PRINT_INTERLOCKS,
  maxTier: 'R4',
  dependencies: ['protoforge.slice_model'],
  metadata: { process: 'FDM' },
};

export const REFERENCE_CONTRACTS: CapabilityContract[] = [
  RUN_TESTS_CONTRACT,
  PRINT_JOB_CONTRACT,
];
