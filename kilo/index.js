// KILO — Hypothesis Generator Entry Point
//
// Architectural constraint (V2 Single Truth Architecture):
//   KILO sits at layer [4] of the CASCADE → KILO → ProtoForge pipeline.
//   It generates hypotheses ONLY. It has NO execution authority.
//   Execution attempts must throw immediately so the constraint is
//   machine-enforced, not just documented.
//
// Pipeline output shape:
//   { hypotheses, suggested_fixes, confidence, gate_result }

'use strict';

const { RepairManifestValidator, createRepairManifestValidator } = require('./modules/repair-manifest-validator');
const { KiloTruthFilterGate, createTruthFilterGate } = require('./modules/truth-filter-gate');

// Fields that indicate a payload is a repair manifest (vs. a raw event).
const MANIFEST_FIELDS = [
  'issue_type',
  'affected_module',
  'root_cause_hypothesis',
  'verification_steps',
  'recommended_fix_steps',
  'risk_level',
  'rollback_option',
  'confidence'
];

/**
 * Determine whether a payload looks like a repair manifest.
 * Requires at least half of the manifest-specific fields to be present.
 */
function looksLikeManifest(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const hits = MANIFEST_FIELDS.filter(f => f in payload).length;
  return hits >= Math.ceil(MANIFEST_FIELDS.length / 2);
}

/**
 * KiloEngine — wraps RepairManifestValidator and KiloTruthFilterGate into a
 * single, coherent interface for the KILO layer.
 *
 * @param {object} [options]
 * @param {object} [options.cascadeStateSnapshot={}]  Initial CASCADE state passed
 *                                                     to the truth-filter gate.
 */
class KiloEngine {
  constructor(options = {}) {
    this._validator = createRepairManifestValidator();
    this._gate = createTruthFilterGate(options.cascadeStateSnapshot || {});
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Generate hypotheses for the given payload.
   *
   * If the payload looks like a repair manifest it is validated first; invalid
   * manifests are rejected before gate evaluation.
   *
   * Returns:
   *   {
   *     hypotheses:     string[]  — human-readable hypothesis strings
   *     suggested_fixes: object[] — { step, description } objects
   *     confidence:     number    — 0–1 confidence score from the gate
   *     gate_result:    object    — raw result from KiloTruthFilterGate
   *   }
   *
   * @param {object} payload  The event/manifest to hypothesise about.
   * @returns {{ hypotheses: string[], suggested_fixes: object[], confidence: number, gate_result: object }}
   */
  generateHypotheses(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new TypeError('KiloEngine.generateHypotheses: payload must be a non-null object');
    }

    // --- Manifest validation (only when payload looks like a manifest) ---
    if (looksLikeManifest(payload)) {
      const validation = this._validator.validateManifest(payload);
      if (!validation.valid) {
        return {
          hypotheses: [],
          suggested_fixes: [],
          confidence: 0,
          gate_result: {
            verified: false,
            reason: `Manifest validation failed: ${validation.reason}`,
            validation_errors: validation.errors
          }
        };
      }
    }

    // --- Truth-gate evaluation ---
    // The gate expects { fingerprint, classification } on the payload.
    // If those fields are absent we treat gate verification as skipped and
    // assign a baseline confidence of 0.
    let gate_result;
    let confidence;

    if (payload.fingerprint && payload.classification) {
      gate_result = this._gate.verifyCascadeEvent(payload);
      confidence = gate_result.confidence;
    } else {
      gate_result = {
        verified: false,
        reason: 'No fingerprint/classification present — gate check skipped',
        confidence: 0
      };
      confidence = 0;
    }

    // --- Hypothesis generation ---
    const hypotheses = this._buildHypotheses(payload, gate_result);
    const suggested_fixes = this._buildSuggestedFixes(payload, gate_result);

    return {
      hypotheses,
      suggested_fixes,
      confidence,
      gate_result
    };
  }

  /**
   * Validate a repair manifest.
   * Delegates to RepairManifestValidator.validateManifest().
   *
   * @param {object} manifest
   * @returns {{ valid: boolean, errors: string[], reason: string }}
   */
  validateManifest(manifest) {
    return this._validator.validateManifest(manifest);
  }

  /**
   * Filter an array of hypotheses through the truth gate, optionally updating
   * the gate's CASCADE state snapshot first.
   *
   * @param {object[]} hypotheses  Array of hypothesis objects (each with fingerprint + classification).
   * @param {object}   [groundTruth={}]  New CASCADE state snapshot to install before filtering.
   * @returns {{ accepted: object[], rejected: object[] }}
   */
  filterThroughTruthGate(hypotheses, groundTruth = {}) {
    if (!Array.isArray(hypotheses)) {
      throw new TypeError('KiloEngine.filterThroughTruthGate: hypotheses must be an array');
    }

    if (groundTruth && typeof groundTruth === 'object' && Object.keys(groundTruth).length > 0) {
      this._gate.updateCascadeStateSnapshot(groundTruth);
    }

    const accepted = [];
    const rejected = [];

    for (const hyp of hypotheses) {
      const result = this._gate.verifyCascadeEvent(hyp);
      if (result.verified) {
        accepted.push({ ...hyp, gate_result: result });
      } else {
        rejected.push({ ...hyp, gate_result: result });
      }
    }

    return { accepted, rejected };
  }

  // -------------------------------------------------------------------------
  // Execution guard — enforces "KILO never executes" at runtime
  // -------------------------------------------------------------------------

  /**
   * Attempting to call execute() throws unconditionally.
   * This makes the no-execution constraint machine-enforced.
   */
  execute() {
    throw new Error(
      'KiloEngine.execute() is forbidden. ' +
      'KILO is a hypothesis generator only (pipeline layer [4]). ' +
      'Pass hypotheses to ProtoForge (layer [5]) for policy evaluation and execution.'
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Build a list of hypothesis strings from the payload and gate result.
   * @private
   */
  _buildHypotheses(payload, gate_result) {
    const hypotheses = [];

    if (gate_result && gate_result.verified === false) {
      hypotheses.push(
        `Gate verification failed (${gate_result.reason}): no actionable repair hypotheses generated.`
      );
      return hypotheses;
    }

    // Derive hypotheses from manifest fields when available
    if (payload.root_cause_hypothesis) {
      hypotheses.push(`Root cause: ${payload.root_cause_hypothesis}`);
    }

    if (payload.issue_type) {
      hypotheses.push(`Issue type ${payload.issue_type} detected in module: ${payload.affected_module || 'unknown'}`);
    }

    if (payload.classification) {
      hypotheses.push(`CASCADE classification "${payload.classification}" suggests remediation is warranted`);
    }

    if (payload.risk_level) {
      hypotheses.push(`Risk level is "${payload.risk_level}" — rollback ${payload.rollback_option ? 'is' : 'is not'} available`);
    }

    if (hypotheses.length === 0) {
      hypotheses.push('Payload processed; insufficient detail for specific hypothesis generation');
    }

    return hypotheses;
  }

  /**
   * Build suggested-fix objects from the payload and gate result.
   * @private
   */
  _buildSuggestedFixes(payload, gate_result) {
    if (!gate_result || gate_result.verified === false) {
      return [];
    }

    const fixes = [];

    if (Array.isArray(payload.verification_steps)) {
      payload.verification_steps.forEach((step, i) => {
        fixes.push({ step: `verify-${i + 1}`, description: step });
      });
    }

    if (Array.isArray(payload.recommended_fix_steps)) {
      payload.recommended_fix_steps.forEach((step, i) => {
        fixes.push({ step: `fix-${i + 1}`, description: step });
      });
    }

    return fixes;
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a KiloEngine instance.
 *
 * @param {object} [options]
 * @param {object} [options.cascadeStateSnapshot={}]
 * @returns {KiloEngine}
 */
function createKiloEngine(options = {}) {
  return new KiloEngine(options);
}

// ---------------------------------------------------------------------------
// CJS exports — matches style of the sub-modules
// ---------------------------------------------------------------------------

module.exports = { KiloEngine, createKiloEngine };
