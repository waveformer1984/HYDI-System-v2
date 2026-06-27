/**
 * LIAISON GATEWAY FOUNDATION
 * 
 * Mobile routing between Heidi and Ursula
 */

import { classifyIntent } from './intent-classifier.js';
import { SystemResponse, ResponseStatus } from './response-types.js';

export interface MobileRequest {
  input: string;
  userId?: string;
  sessionId?: string;
  mode?: 'mobile' | 'full' | 'command';
}

export interface MobileResponse {
  text: string;
  actions: string[];
  data?: any;
  confidence: number;
  timestamp: Date;
  status?: ResponseStatus;
  meta?: any;
}

export async function handleMobileRequest(request: MobileRequest): Promise<MobileResponse> {
  const classification = classifyIntent(request.input);

  // Handle failure modes at the gateway level
  if (classification.status === "invalid_input") {
    return {
      text: classification.text,
      actions: ["Try again", "Get help"],
      confidence: classification.confidence,
      timestamp: new Date(),
      status: classification.status,
      meta: classification.meta
    };
  }

  if (classification.status === "ambiguous") {
    return {
      text: classification.text,
      actions: ["Clarify intent", "Choose financial", "Choose conversational"],
      confidence: classification.confidence,
      timestamp: new Date(),
      status: classification.status,
      meta: classification.meta
    };
  }

  if (classification.status === "uncertain") {
    return {
      text: classification.text,
      actions: ["Provide more details", "Continue anyway", "Start over"],
      confidence: classification.confidence,
      timestamp: new Date(),
      status: classification.status,
      meta: classification.meta
    };
  }

  // For successful classification, route appropriately
  // Note: We need to extract the intent from the success response
  // This is a temporary bridge - in production, classifyIntent would return Intent directly
  const detectedIntents = classification.meta?.detectedIntents || [];
  const primaryIntent = detectedIntents[0] || "conversation";

  if (primaryIntent === "financial" || primaryIntent === "technical" || primaryIntent === "operational") {
    return await routeToUrsula(request, classification);
  }

  // Default to Heidi for conversational
  return await routeToHeidi(request, classification);
}

async function routeToHeidi(request: MobileRequest, classification: SystemResponse): Promise<MobileResponse> {
  // TODO: Integrate with actual Heidi service
  return {
    text: `Heidi response to: ${request.input}`,
    actions: ["Continue conversation", "Switch to Ursula"],
    confidence: classification.confidence,
    timestamp: new Date(),
    status: classification.status,
    meta: classification.meta
  };
}

async function routeToUrsula(request: MobileRequest, classification: SystemResponse): Promise<MobileResponse> {
  // TODO: Integrate with actual Ursula service
  return {
    text: `Ursula is processing: ${request.input}`,
    actions: ["View details", "Monitor progress"],
    data: { taskId: `task_${Date.now()}` },
    confidence: classification.confidence,
    timestamp: new Date(),
    status: classification.status,
    meta: classification.meta
  };
}
