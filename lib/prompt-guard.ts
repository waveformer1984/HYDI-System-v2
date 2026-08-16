/**
 * Prompt-injection guard for LLM calls.
 *
 * Detects common attempts to override system instructions or escape the
 * intended message boundary. When detected, the model must not receive the
 * raw user text. Instead, the caller returns a safe, deterministic response.
 */

const INJECTION_PHRASES = [
  'ignore previous instructions',
  'ignore all instructions',
  'ignore the above',
  'disregard previous',
  'disregard the above',
  'disregard all instructions',
  'ignore your instructions',
  'forget your instructions',
  'you are now',
  'you will now',
  'pretend you are',
  'pretend to be',
  'act as a',
  'acting as a',
  'jailbreak',
  'do anything',
  'do anything now',
  'DAN mode',
  'developer mode',
  'system prompt',
  'new instructions',
  'replace your',
  'this is a test of',
  'roleplay as',
  'simulate being',
];

const STRUCTURAL_MARKERS = [
  '[system]',
  '[/system]',
  '<<SYS>>',
  '<</SYS>>',
  '--- system ---',
  '--- instructions ---',
];

const MAX_CHARS = 16000;

export interface PromptGuardResult {
  safe: boolean;
  reason?: string;
}

export function checkPrompt(prompt: string): PromptGuardResult {
  if (!prompt || typeof prompt !== 'string') {
    return { safe: true };
  }

  const normalized = prompt.toLowerCase().replace(/\s+/g, ' ').trim();

  if (prompt.length > MAX_CHARS) {
    return { safe: false, reason: 'Prompt exceeds maximum length' };
  }

  for (const phrase of INJECTION_PHRASES) {
    if (normalized.includes(phrase)) {
      return { safe: false, reason: `Prompt contains disallowed instruction: "${phrase}"` };
    }
  }

  for (const marker of STRUCTURAL_MARKERS) {
    if (normalized.includes(marker.toLowerCase())) {
      return { safe: false, reason: `Prompt contains disallowed structural marker: "${marker}"` };
    }
  }

  // Reject obvious attempts to close a context block and start a new system one.
  if (normalized.includes('[/photo forge context]') && normalized.includes('[system]')) {
    return { safe: false, reason: 'Prompt attempts to re-open a system block after workspace context' };
  }

  return { safe: true };
}

export function createSafeResponse(): string {
  return JSON.stringify({
    response: 'I cannot process this request because it contains instructions that may alter my behavior. Please rephrase your question.',
    actions: [],
  });
}

export function sanitizePrompt(prompt: string): string {
  // If the prompt is disallowed, callers should reject it entirely. This
  // escape helper exists for paths that need to neutralize a single payload
  // rather than block it. It does not make an unsafe prompt safe by itself.
  return prompt
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/<</g, '((')
    .replace(/>>/g, '))')
    .replace(/---/g, '—');
}
