/**
 * DYNAMIC CONFIDENCE CALCULATOR
 * 
 * Instead of hardcoded self-esteem
 */

import { InputSignals } from './input-validator.js';

export function computeConfidence(input: string, signals: InputSignals): number {
  let score = 0.5; // Base confidence

  // Keyword hits increase confidence (but capped)
  score += Math.min(signals.keywordHits * 0.1, 0.3);

  // Ambiguity decreases confidence
  score -= signals.ambiguity * 0.2;

  // Uncertainty decreases confidence significantly
  score -= signals.uncertainty * 0.4;

  // Noise decreases confidence
  score -= signals.noise * 0.2;

  // Length bonus (but only up to a point)
  if (signals.length >= 10 && signals.length <= 200) {
    score += 0.1;
  } else if (signals.length > 200) {
    score -= 0.1; // Too long might be garbage
  }

  // Quality score has major impact
  score += (signals.qualityScore - 0.5) * 0.4;

  return Math.max(0, Math.min(score, 1));
}
