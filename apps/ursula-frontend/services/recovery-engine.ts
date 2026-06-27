/**
 * GUIDED RECOVERY ENGINE
 * 
 * Turns failure modes into helpful guidance
 */

import { SystemResponse, ResponseStatus } from './response-types.js';
import { analyzeInputSignals } from './input-validator.js';

export interface RecoveryOptions {
  type: 'clarification' | 'guidance' | 'collaboration';
  suggestions: string[];
  examples?: string[];
  bestGuess?: {
    intent: string;
    confidence: number;
    preview: string;
  };
}

export function createRecoveryResponse(
  status: ResponseStatus,
  input: string,
  signals?: any
): SystemResponse & { recovery: RecoveryOptions } {

  switch (status) {
    case "invalid_input":
      return {
        status: "invalid_input",
        text: "I couldn't extract meaningful intent from that input.",
        confidence: 0.1,
        recovery: {
          type: 'guidance',
          suggestions: [
            "Include a goal (e.g. 'increase revenue')",
            "Include an action (e.g. 'analyze', 'build', 'fix')",
            "Be more specific about what you want"
          ],
          examples: [
            "Show me revenue trends for Q1",
            "Build a dashboard for user analytics",
            "Fix the slow API response time"
          ]
        }
      };

    case "ambiguous":
      const detectedIntents = signals?.detectedIntents || {};
      const intentTypes = Object.entries(detectedIntents)
        .filter(([_, count]) => (count as number) > 0)
        .map(([type]) => type);

      return {
        status: "ambiguous",
        text: `I detected multiple intents: ${intentTypes.join(', ')}. Which should I focus on?`,
        confidence: 0.5,
        recovery: {
          type: 'clarification',
          suggestions: intentTypes.map(intent => {
            switch (intent) {
              case 'financial':
                return "Financial analysis (revenue, costs, budgets)";
              case 'technical':
                return "Technical solution (build, deploy, code)";
              case 'operational':
                return "Operational task (status, monitor, process)";
              case 'conversational':
                return "General conversation";
              default:
                return intent;
            }
          }),
          bestGuess: {
            intent: intentTypes[0] || 'conversation',
            confidence: 0.6,
            preview: `If you meant ${intentTypes[0]}, here's what I'd do...`
          }
        }
      };

    case "uncertain":
      return {
        status: "uncertain",
        text: "I'm not confident about this interpretation, but here's my best guess:",
        confidence: 0.4,
        recovery: {
          type: 'collaboration',
          suggestions: [
            "Confirm this is what you meant",
            "Provide more details",
            "Try rephrasing differently"
          ],
          bestGuess: {
            intent: signals?.primaryIntent || 'conversation',
            confidence: 0.4,
            preview: "I think you want general conversation, but I'm not sure."
          }
        }
      };

    default:
      return {
        status: "success",
        text: "Request processed successfully",
        confidence: 0.8,
        recovery: {
          type: 'collaboration',
          suggestions: ["Continue", "Refine", "Start new task"]
        }
      };
  }
}

export function logAmbiguityPattern(input: string, detectedIntents: string[], userChoice?: string) {
  // In production, this would go to a database
  const pattern = {
    timestamp: new Date().toISOString(),
    input: input.substring(0, 100),
    detectedIntents,
    userChoice,
    resolutionTime: Date.now()
  };

  console.log('[AMBIGUITY_LOG]', JSON.stringify(pattern));
  return pattern;
}
