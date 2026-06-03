/**
 * RESPONSE STATE MACHINE
 * 
 * Real system responses with failure modes
 */

export type ResponseStatus = 
  | "success"
  | "uncertain" 
  | "invalid_input"
  | "ambiguous"
  | "error";

export interface SystemResponse {
  status: ResponseStatus;
  text: string;
  confidence: number;
  actions?: string[];
  meta?: {
    reasons?: string[];
    inputQualityScore?: number;
    detectedIntents?: string[];
  };
}
