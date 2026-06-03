/**
 * HEIDI CONFIGURATION
 * Toggle switches for debugging and isolation
 */

// DUMB MODE - Isolate the problem
export const ENABLE_HEIDI_LOOP = true;

// LOGGING LEVELS
export const HEIDI_LOGGING = {
  INTENT_PROPOSALS: true,
  SANDBOX_VALIDATION: true,
  LEARNING_SIGNALS: true,
  CONSTRAINT_UPDATES: true,
  STATUS_UPDATES: true
};

// DEVELOPMENT MODE
export const HEIDI_DEVELOPMENT = true;

// FEATURE FLAGS
export const HEIDI_FEATURES = {
  INTENT_VALIDATION: true,
  RISK_ASSESSMENT: true,
  LEARNING_FILTER: true,
  CONSTRAINT_ENFORCEMENT: true,
  FAILURE_DRIVEN_LEARNING: true
};
