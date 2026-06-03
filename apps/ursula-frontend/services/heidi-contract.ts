/**
 * HEIDI INTEGRATION CONTRACT
 * 
 * Defines what Heidi can and cannot override
 */

import { SystemResponse } from './response-types.js';

export interface HeidiExpression {
  tone: 'professional' | 'friendly' | 'casual' | 'empathetic';
  style: 'direct' | 'explanatory' | 'conversational';
  personality: string;
}

export interface HeidiContract {
  // What Heidi controls
  expression: HeidiExpression;
  phrasing: (content: string, expression: HeidiExpression) => string;

  // What Heidi CANNOT change
  immutableTruth: {
    status: SystemResponse['status'];
    confidence: number;
    detectedIntents: string[];
    recoveryOptions?: any;
  };
}

export function createHeidiContract(
  systemResponse: SystemResponse
): HeidiContract {

  // Lock the truth - Heidi cannot change these
  const immutableTruth = {
    status: systemResponse.status,
    confidence: systemResponse.confidence,
    detectedIntents: systemResponse.meta?.detectedIntents || [],
    recoveryOptions: (systemResponse as any).recovery
  };

  // Heidi can only control expression
  const expression: HeidiExpression = {
    tone: determineTone(systemResponse),
    style: determineStyle(systemResponse),
    personality: "helpful, honest, and clear"
  };

  return {
    expression,
    phrasing: (content: string, expr: HeidiExpression) => {
      return applyHeidiPhrasing(content, expr, immutableTruth);
    },
    immutableTruth
  };
}

function determineTone(response: SystemResponse): HeidiExpression['tone'] {
  switch (response.status) {
    case 'invalid_input':
      return 'empathetic';
    case 'ambiguous':
      return 'friendly';
    case 'uncertain':
      return 'casual';
    case 'error':
      return 'empathetic';
    default:
      return response.confidence > 0.8 ? 'professional' : 'friendly';
  }
}

function determineStyle(response: SystemResponse): HeidiExpression['style'] {
  if (response.status !== 'success') {
    return 'explanatory';
  }

  return response.confidence > 0.7 ? 'direct' : 'conversational';
}

function applyHeidiPhrasing(
  content: string,
  expression: HeidiExpression,
  truth: HeidiContract['immutableTruth']
): string {

  // Heidi can rephrase but cannot change the meaning
  let phrased = content;

  // Apply tone
  switch (expression.tone) {
    case 'empathetic':
      phrased = `I understand this might be frustrating. ${phrased}`;
      break;
    case 'friendly':
      phrased = `Here's what I can help with: ${phrased}`;
      break;
    case 'casual':
      phrased = `So, ${phrased.toLowerCase()}`;
      break;
    case 'professional':
      // Keep as-is
      break;
  }

  // Apply style
  switch (expression.style) {
    case 'explanatory':
      if (truth.status === 'ambiguous') {
        phrased += ` I detected multiple possibilities: ${truth.detectedIntents.join(', ')}.`;
      }
      break;
    case 'conversational':
      phrased = phrased.replace(/\./g, '. Let me know if that helps!');
      break;
    case 'direct':
      // Keep concise
      break;
  }

  // CRITICAL: Never change the core truth
  if (truth.status === 'invalid_input') {
    // Heidi can be empathetic but must still indicate the input is invalid
    return phrased;
  }

  if (truth.status === 'ambiguous') {
    // Heidi can be helpful but must still indicate clarification is needed
    return phrased;
  }

  return phrased;
}

export function validateHeidiContract(
  originalResponse: SystemResponse,
  heidiOutput: string,
  contract: HeidiContract
): { valid: boolean; violations: string[] } {

  const violations: string[] = [];

  // Check if Heidi contradicted the truth
  if (contract.immutableTruth.status === 'invalid_input') {
    if (heidiOutput.includes('I can') || heidiOutput.includes('I will')) {
      violations.push('Heidi suggested capability after invalid_input');
    }
  }

  if (contract.immutableTruth.status === 'ambiguous') {
    if (!heidiOutput.includes('clarif') && !heidiOutput.includes('which')) {
      violations.push('Heidi did not indicate clarification needed for ambiguous input');
    }
  }

  return {
    valid: violations.length === 0,
    violations
  };
}
