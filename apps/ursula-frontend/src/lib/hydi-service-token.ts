import { createHmac, randomBytes } from 'node:crypto';

/** HMAC token for heidi-web /api/* (x-hydi-service-token). Server-only — never import from client components. */
export function mintHydiServiceToken(secret: string, service = 'ursula', now = Date.now()): string {
  const ts = String(now);
  const requestId = randomBytes(6).toString('hex');
  const sig = createHmac('sha256', secret).update(`${ts}:${requestId}:${service}`).digest('hex');
  return `${ts}.${requestId}.${service}.${sig}`;
}
