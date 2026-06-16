// Shim: re-exports generateFingerprint from the top-level cascade-core module
// truth-filter-gate.js requires this via relative path '../modules/cascade-core'

const CascadeCore = require('../../modules/cascade-core');

// cascade-core exports the CascadeCore class; generateFingerprint is an instance
// method. Expose a standalone function that creates a temporary instance to compute
// the fingerprint, matching the destructuring in truth-filter-gate.js.
function generateFingerprint(event) {
  const instance = new CascadeCore();
  return instance.generateFingerprint(event);
}

module.exports = { generateFingerprint };
