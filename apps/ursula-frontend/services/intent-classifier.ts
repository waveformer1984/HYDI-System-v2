/**
 * INTENT CLASSIFIER WITH HUMILITY
 * 
 * Now with real failure modes and dynamic confidence
 */

import { SystemResponse, ResponseStatus } from './response-types.js';
import { analyzeInputSignals, scoreInputQuality } from './input-validator.js';
import { computeConfidence } from './confidence-calculator.js';
import { createRecoveryResponse } from './recovery-engine.js';

export interface Intent {
  target: "heidi" | "ursula";
  type: "financial" | "technical" | "operational" | "conversation";
  confidence: number;
}

export function classifyIntent(input: string): SystemResponse {
  // Input quality gate
  const qualityScore = scoreInputQuality(input);

  if (qualityScore < 0.3) {
    return createRecoveryResponse("invalid_input", input, { inputQualityScore: qualityScore });
  }

  // Analyze signals
  const signals = analyzeInputSignals(input);

  // Check for ambiguity (multiple intents)
  const significantIntents = Object.entries(signals.detectedIntents)
    .filter(([_, count]) => count > 0);

  if (significantIntents.length > 1) {
    // Check if intents are actually competing (not just weak hits)
    const competingIntents = significantIntents.filter(([_, count]) => count >= 1);

    if (competingIntents.length > 1) {
      return createRecoveryResponse("ambiguous", input, signals);
    }
  }

  // Determine primary intent
  const intent = determinePrimaryIntent(signals.detectedIntents);

  // Compute dynamic confidence
  const confidence = computeConfidence(input, signals);

  // Check for uncertainty
  if (confidence < 0.6) {
    return createRecoveryResponse("uncertain", input, { ...signals, primaryIntent: intent.type });
  }

  return {
    status: "success",
    text: `Classified as ${intent.type} intent`,
    confidence,
    meta: {
      inputQualityScore: qualityScore,
      detectedIntents: [intent.type]
    }
  };
}

function determinePrimaryIntent(detectedIntents: { [key: string]: number }): Intent {
  const intentMapping = {
    financial: { target: "ursula" as const, type: "financial" as const },
    technical: { target: "ursula" as const, type: "technical" as const },
    operational: { target: "ursula" as const, type: "operational" as const },
    conversational: { target: "heidi" as const, type: "conversation" as const }
  };

  // Find intent with most keyword hits
  const primaryIntent = Object.entries(detectedIntents)
    .sort(([, a], [, b]) => b - a)[0];

  const intentType = primaryIntent[0] as keyof typeof intentMapping;
  const baseIntent = intentMapping[intentType] || intentMapping.conversational;

  return {
    ...baseIntent,
    confidence: 0.7 // Default confidence for successful classification
  };
}
