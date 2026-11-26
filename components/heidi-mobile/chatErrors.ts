import type { ApiError } from '../../lib/heidi-mobile/client/api';

/** Plain-text chat error copy for the phone UI (see HEIDI_MOBILE_OPS.md). */
export function messageForChatError(error: ApiError): string {
  const msg = (error.message || '').toLowerCase();
  if (error.kind === 'timeout' || msg.includes('busy') || msg.includes('15s')) {
    return "Heidi is busy — no reply in 15s.";
  }
  if (
    error.kind === 'network'
    || msg.includes('stream ended')
    || msg.includes('unreachable')
    || msg.includes('could not be reached')
  ) {
    return 'Lost connection to Frank.';
  }
  if (
    error.kind === 'unconfigured'
    || /model|ollama|local model|inference/.test(msg)
  ) {
    return "Heidi's model is offline on Frank. Try again in a minute.";
  }
  if (error.message) return error.message;
  return 'Request failed.';
}

/** Increment consecutive BFF failures for Lifeline card (502/503/network). */
export function noteBffFailure(
  prev: number,
  error: { kind: string; status?: number },
): number {
  if (error.status === 502 || error.status === 503 || error.kind === 'network') {
    return prev + 1;
  }
  return 0;
}

export function shouldShowLifelineCard(consecutiveFailures: number): boolean {
  return consecutiveFailures >= 2;
}

export const DEFAULT_LIFELINE_URL = 'https://heidi-pc.tailc50af2.ts.net:8443/lifeline/';