'use strict';
/**
 * Delegate exec-timeout contract for watchdog → hydi-recover subprocesses.
 *
 * Defect fixed (measured live 2026-09-20): the watchdog delegated governed
 * recovery with a hardcoded 120s exec timeout while protoforge-core's
 * postcondition grace is 300s. The delegate spawned the recovery, boot-agent
 * completed the restart, the lease was written and the service went HEALTHY —
 * then the watchdog killed the governing subprocess mid-postcondition at 120s.
 * Runtime recovery: SUCCESS. Delegate process: TIMEOUT/FAILURE.
 *
 * Contract: timeout must exceed the component's maximum legitimate recovery
 * duration (its health graceMs) plus a bounded margin for the boot-control
 * roundtrip and governed report — and must remain bounded (a genuinely hung
 * delegate still dies at the cap). Derived from boot.config.json, not a
 * constant, so the contract cannot silently diverge when graceMs changes.
 */

const DEFAULT_MARGIN_MS = 60000;
const DEFAULT_FLOOR_MS = 120000; // never tighter than the historical timeout
const DEFAULT_CAP_MS = 600000;   // bounded — a hung delegate still terminates

/**
 * @param {{ graceMs?: number, health?: { graceMs?: number } }} endpoint
 * @param {{ marginMs?: number, floorMs?: number, capMs?: number, defaultGraceMs?: number }} [opts]
 * @returns {number} exec timeout in ms
 */
function delegateTimeoutMs(endpoint, opts = {}) {
  const margin = opts.marginMs ?? DEFAULT_MARGIN_MS;
  const floor = opts.floorMs ?? DEFAULT_FLOOR_MS;
  const cap = opts.capMs ?? DEFAULT_CAP_MS;
  const graceMs =
    endpoint?.graceMs ??
    endpoint?.health?.graceMs ??
    opts.defaultGraceMs ??
    0;
  return Math.min(cap, Math.max(floor, graceMs + margin));
}

module.exports = { delegateTimeoutMs, DEFAULT_MARGIN_MS, DEFAULT_FLOOR_MS, DEFAULT_CAP_MS };
