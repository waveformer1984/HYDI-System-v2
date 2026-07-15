/**
 * ACTIONABLE RESPONSE ENGINE
 * 
 * All LLM outputs MUST conform to:
 * {
 *   "response": "string",
 *   "actions": [
 *     {
 *       "type": "string",
 *       "payload": {}
 *     }
 *   ]
 * }
 * 
 * Enforcement rules:
 * If output is NOT valid JSON → reject
 * Retry ONCE with corrected prompt
 * If still invalid → fallback model immediately
 * 
 * No exceptions.
 */

export interface ParsedAction {
  type: string;
  payload: Record<string, any>;
}

export interface ParsedResponse {
  response: string;
  actions: ParsedAction[];
}

export class ActionParser {
  /**
   * Parse and validate LLM output
   */
  static parseResponse(content: string): { success: boolean; response?: ParsedResponse; error?: string } {
    try {
      const parsed = JSON.parse(content);
      
      // Validate structure
      if (!Object.prototype.hasOwnProperty.call(parsed, 'response')) {
        return {
          success: false,
          error: 'Missing "response" field in output'
        };
      }
      
      if (!Array.isArray(parsed.actions)) {
        return {
          success: false,
          error: '"actions" field must be an array'
        };
      }
      
      // Validate each action
      for (const action of parsed.actions) {
        if (!action.type || typeof action.type !== 'string') {
          return {
            success: false,
            error: 'Each action must have a "type" string field'
          };
        }
        
        if (!action.payload || typeof action.payload !== 'object') {
          return {
            success: false,
            error: 'Each action must have a "payload" object'
          };
        }
      }
      
      return {
        success: true,
        response: {
          response: parsed.response,
          actions: parsed.actions
        }
      };
      
    } catch (error) {
      return {
        success: false,
        error: `Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
  
  /**
   * Generate corrected prompt for retry
   */
  static generateCorrectedPrompt(originalPrompt: string, error: string): string {
    return `${originalPrompt}

IMPORTANT: Your response must be valid JSON with this exact structure:
{
  "response": "your text response here",
  "actions": [
    {
      "type": "action_type",
      "payload": {"key": "value"}
    }
  ]
}

Previous error: ${error}

Please ensure your output is valid JSON and follows this structure exactly.`;
  }
  
  /**
   * Generate safe fallback response
   */
  static generateSafeFallback(): ParsedResponse {
    return {
      response: "I apologize, but I'm having trouble processing your request right now. Please try again.",
      actions: []
    };
  }
  
  /**
   * Validate action types against allowed actions
   */
  static validateActions(actions: ParsedAction[], allowedTypes: string[]): { valid: boolean; invalidActions: string[] } {
    const invalidActions: string[] = [];
    
    for (const action of actions) {
      if (!allowedTypes.includes(action.type)) {
        invalidActions.push(action.type);
      }
    }
    
    return {
      valid: invalidActions.length === 0,
      invalidActions
    };
  }
  
  /**
   * Extract action summary for logging
   */
  static extractActionSummary(actions: ParsedAction[]): string {
    if (actions.length === 0) {
      return 'No actions';
    }
    
    return actions.map(action => `${action.type}`).join(', ');
  }
}
