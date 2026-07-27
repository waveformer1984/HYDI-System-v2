'use strict';

const POLICIES = {
  conservative: {
    learningRate: 0.05,
    confidenceAdjustmentFactor: 0.3,
    evidenceThreshold: 10,
    minConfidence: 0.1,
    maxConfidence: 0.9,
    recommendationThreshold: 0.7,
  },
  balanced: {
    learningRate: 0.1,
    confidenceAdjustmentFactor: 0.5,
    evidenceThreshold: 5,
    minConfidence: 0.05,
    maxConfidence: 0.95,
    recommendationThreshold: 0.6,
  },
  aggressive: {
    learningRate: 0.2,
    confidenceAdjustmentFactor: 0.8,
    evidenceThreshold: 3,
    minConfidence: 0,
    maxConfidence: 1,
    recommendationThreshold: 0.5,
  },
  experimental: {
    learningRate: 0.3,
    confidenceAdjustmentFactor: 1.0,
    evidenceThreshold: 1,
    minConfidence: 0,
    maxConfidence: 1,
    recommendationThreshold: 0.4,
  },
};

function get(name) {
  return POLICIES[name] || POLICIES.balanced;
}

function list() {
  return Object.keys(POLICIES);
}

function isValid(name) {
  return name in POLICIES;
}

module.exports = { get, list, isValid, POLICIES };
