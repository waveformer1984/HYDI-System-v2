/**
 * Physical safety interlocks.
 *
 * Software watches. Hardware stops.
 *
 * Unattended overnight production means thermal runaway, filament fire and
 * mechanical crash are live possibilities while HYDI is crashed, wedged, or
 * confidently wrong. An interlock implemented inside the same process that
 * might be the thing that failed is not an interlock — it is a comment.
 *
 * This module therefore does exactly two jobs:
 *
 *   1. Refuse to let a physical capability run above R1 unless an interlock
 *      that holds INDEPENDENTLY of this software is declared and confirmed
 *      armed within a freshness window.
 *   2. Make the confirmation itself expire, so a stale "armed" reading from
 *      six hours ago cannot authorize tonight's run.
 *
 * It deliberately does NOT implement stopping. Stopping belongs to the
 * thermal fuse, the firmware thermal runaway check, and the relay on the
 * power feed. HYDI's job is to refuse to start when those are absent.
 */

import type { InterlockRequirement, ObservationSpec } from './types';

export interface InterlockReading {
  interlockId: string;
  armed: boolean;
  /** When the reading was taken. */
  at: string;
  /** How the reading was obtained, for the audit record. */
  evidence: string;
}

export interface InterlockProbe {
  (requirement: InterlockRequirement, spec: ObservationSpec): Promise<InterlockReading>;
}

export interface InterlockStatus {
  /** True only when every independent interlock is armed and fresh. */
  safeToActuate: boolean;
  armed: string[];
  unarmed: string[];
  stale: string[];
  missing: string[];
  /** Interlocks declared as software_only, which never count toward safety. */
  insufficient: string[];
  reason: string;
}

export interface SafetyInterlockOptions {
  /**
   * How old an "armed" reading may be and still authorize actuation.
   * Default 60s: long enough to be practical, short enough that a reading
   * cannot survive the conditions changing.
   */
  freshnessMs?: number;
}

export class SafetyInterlockController {
  private readonly probes = new Map<string, InterlockProbe>();
  private readonly readings = new Map<string, InterlockReading>();
  private readonly freshnessMs: number;

  constructor(options: SafetyInterlockOptions = {}) {
    this.freshnessMs = options.freshnessMs ?? 60_000;
  }

  /** Register how to read a specific interlock. */
  registerProbe(interlockId: string, probe: InterlockProbe): void {
    this.probes.set(interlockId, probe);
  }

  /**
   * Read every declared interlock. Returns readings; does not decide.
   */
  async poll(requirements: InterlockRequirement[]): Promise<InterlockReading[]> {
    const readings: InterlockReading[] = [];
    for (const requirement of requirements) {
      const probe = this.probes.get(requirement.id);
      if (!probe) continue;
      try {
        const reading = await probe(requirement, requirement.verification);
        this.readings.set(requirement.id, reading);
        readings.push(reading);
      } catch (err) {
        // A probe that fails reads as NOT armed. Never as armed.
        const reading: InterlockReading = {
          interlockId: requirement.id,
          armed: false,
          at: new Date().toISOString(),
          evidence: `probe failed: ${err instanceof Error ? err.message : String(err)}`,
        };
        this.readings.set(requirement.id, reading);
        readings.push(reading);
      }
    }
    return readings;
  }

  /**
   * Decide whether actuation is permitted. Fail-closed on every axis:
   * missing probe, stale reading, unarmed interlock, software-only mechanism.
   */
  evaluate(requirements: InterlockRequirement[], now: Date = new Date()): InterlockStatus {
    const armed: string[] = [];
    const unarmed: string[] = [];
    const stale: string[] = [];
    const missing: string[] = [];
    const insufficient: string[] = [];

    const independent = requirements.filter((r) => r.mechanism !== 'software_only');
    for (const requirement of requirements) {
      if (requirement.mechanism === 'software_only') {
        insufficient.push(requirement.id);
        continue;
      }
      const reading = this.readings.get(requirement.id);
      if (!reading) {
        missing.push(requirement.id);
        continue;
      }
      const age = now.getTime() - new Date(reading.at).getTime();
      if (age > this.freshnessMs) {
        stale.push(requirement.id);
        continue;
      }
      if (!reading.armed) {
        unarmed.push(requirement.id);
        continue;
      }
      armed.push(requirement.id);
    }

    if (independent.length === 0) {
      return {
        safeToActuate: false,
        armed,
        unarmed,
        stale,
        missing,
        insufficient,
        reason:
          'No interlock that holds independently of this software is declared. ' +
          'Actuation refused.',
      };
    }

    const safeToActuate =
      armed.length === independent.length &&
      unarmed.length === 0 &&
      stale.length === 0 &&
      missing.length === 0;

    return {
      safeToActuate,
      armed,
      unarmed,
      stale,
      missing,
      insufficient,
      reason: safeToActuate
        ? `All ${armed.length} independent interlock(s) armed and read within ${this.freshnessMs}ms.`
        : describeFailure({ unarmed, stale, missing, insufficient }),
    };
  }

  /**
   * Interlock ids currently armed and fresh — feeds SystemStateSnapshot so
   * the authority function can see them.
   */
  armedIds(now: Date = new Date()): string[] {
    const ids: string[] = [];
    this.readings.forEach((reading, id) => {
      const age = now.getTime() - new Date(reading.at).getTime();
      if (reading.armed && age <= this.freshnessMs) ids.push(id);
    });
    return ids;
  }
}

function describeFailure(parts: {
  unarmed: string[];
  stale: string[];
  missing: string[];
  insufficient: string[];
}): string {
  const bits: string[] = [];
  if (parts.unarmed.length) bits.push(`not armed: ${parts.unarmed.join(', ')}`);
  if (parts.stale.length) bits.push(`reading stale: ${parts.stale.join(', ')}`);
  if (parts.missing.length) bits.push(`never read: ${parts.missing.join(', ')}`);
  if (parts.insufficient.length) {
    bits.push(`software-only, does not count: ${parts.insufficient.join(', ')}`);
  }
  return `Actuation refused — ${bits.join('; ')}.`;
}

// ---------------------------------------------------------------------------
// Standard interlocks for FDM printing
// ---------------------------------------------------------------------------

/**
 * Reference set for an unattended print cell. These are the interlocks a
 * ProtoForge fabrication capability should declare — each one holds without
 * HYDI, and each one is independently observable.
 */
export const FDM_PRINT_INTERLOCKS: InterlockRequirement[] = [
  {
    id: 'thermal_runaway_firmware',
    description:
      'Printer firmware thermal runaway protection is compiled in and enabled. Halts heaters ' +
      'on thermistor decoupling without any host involvement.',
    mechanism: 'firmware',
    verification: {
      source: 'api_response',
      target: '/printer/objects/query?configfile',
      extractFields: ['thermal_runaway_enabled'],
      settleMs: 0,
    },
  },
  {
    id: 'thermal_fuse',
    description:
      'Inline thermal fuse on the heater circuit. Opens the circuit physically above the ' +
      'rated temperature regardless of firmware state.',
    mechanism: 'electromechanical',
    verification: {
      source: 'sensor',
      target: 'heater_circuit_continuity',
      extractFields: ['continuity', 'installed'],
      settleMs: 0,
    },
  },
  {
    id: 'smoke_detector_relay',
    description:
      'Smoke detector wired to a normally-closed relay on the printer mains feed. Cuts power ' +
      'on smoke without software in the path.',
    mechanism: 'electromechanical',
    verification: {
      source: 'sensor',
      target: 'smoke_relay',
      extractFields: ['relay_closed', 'detector_healthy', 'battery_ok'],
      settleMs: 0,
    },
  },
  {
    id: 'emergency_stop',
    description: 'Physical latching emergency stop in the machine power feed, reachable by a human.',
    mechanism: 'electromechanical',
    verification: {
      source: 'sensor',
      target: 'estop',
      extractFields: ['latched', 'circuit_healthy'],
      settleMs: 0,
    },
  },
];
