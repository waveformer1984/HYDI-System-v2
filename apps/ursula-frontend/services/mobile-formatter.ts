/**
 * MOBILE RESPONSE FORMATTER
 * 
 * Formats responses for mobile interfaces
 */

export interface Response {
  text: string;
  actions?: string[];
  data?: any;
  confidence?: number;
}

export interface MobileFormattedResponse {
  text: string;
  actions: string[];
  data: any;
  confidence: number;
}

export function formatResponse(response: Response, mode: 'mobile' | 'full' | 'command'): MobileFormattedResponse {
  if (mode === "mobile") {
    return {
      text: response.text.slice(0, 200),
      actions: extractActions(response),
      data: response.data || {},
      confidence: response.confidence || 0.8
    };
  }

  if (mode === "command") {
    return {
      text: response.text.split('.')[0], // First sentence only
      actions: extractActions(response).slice(0, 1), // One action max
      data: response.data || {},
      confidence: response.confidence || 0.8
    };
  }

  return {
    text: response.text,
    actions: response.actions || [],
    data: response.data || {},
    confidence: response.confidence || 0.8
  };
}

function extractActions(response: Response): string[] {
  if (response.actions) {
    return response.actions;
  }

  // Extract actions from text
  const actions: string[] = [];
  const lines = response.text.split('\n');
  
  for (const line of lines) {
    if (line.includes('Run') || line.includes('Start') || 
        line.includes('View') || line.includes('Check')) {
      actions.push(line.trim());
    }
  }

  return actions.slice(0, 3); // Max 3 actions
}
