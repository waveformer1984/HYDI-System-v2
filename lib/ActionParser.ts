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
   * Extract the first balanced JSON object from a possibly noisy string.
   * Helps when models wrap JSON in markdown fences or add prose.
   */
  private static extractJSON(content: string): string | null {
    const cleaned = content
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    let firstBrace = cleaned.indexOf('{');
    if (firstBrace === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (char === '\\') {
          escape = true;
          continue;
        }
        if (char === '"') inString = false;
      } else {
        if (char === '"') {
          inString = true;
        } else if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
          if (depth === 0) {
            return cleaned.slice(firstBrace, i + 1);
          }
        }
      }
    }
    return null;
  }

  /**
   * Parse and validate LLM output. Tolerates JSON embedded in markdown/prose.
   */
  static parseResponse(content: string): { success: boolean; response?: ParsedResponse; error?: string } {
    try {
      let raw = content.trim();
      let parsed: any;

      try {
        parsed = JSON.parse(raw);
      } catch {
        const extracted = ActionParser.extractJSON(raw);
        if (!extracted) throw new Error('No JSON object found');
        parsed = JSON.parse(extracted);
      }
      
      // Validate structure
      if (!parsed.hasOwnProperty('response')) {
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
