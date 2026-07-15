/**
 * Ursula Inference Router
 *
 * Unified LLM client for Ursula. Routes requests through the same
 * three-tier stack as the project-ops executor:
 *
 *   1. Ollama  (Vulkan/Xe, :11434)   — primary, local GPU
 *   2. OpenVINO (INT8/Xe, :11435)    — 3x faster when warm, local
 *   3. Claude API (cloud)            — fallback, needs ANTHROPIC_API_KEY
 *
 * Usage:
 *   import { infer } from '@/lib/inference-router';
 *   const result = await infer('Classify this intent: ...');
 *   console.log(result.response, result.provider);
 */

export type InferenceProvider = 'ollama' | 'openvino' | 'claude' | 'none';

export interface InferenceResult {
  success: boolean;
  response: string;
  provider: InferenceProvider;
  model: string;
  duration_ms: number;
  error?: string;
}

const OLLAMA_URL    = process.env.OLLAMA_BASE_URL    ?? 'http://localhost:11434';
const OPENVINO_URL  = process.env.OPENVINO_SERVER_URL ?? 'http://127.0.0.1:11435';
const OLLAMA_MODEL  = process.env.OLLAMA_MODEL        ?? 'qwen2.5-coder:1.5b';
const TIMEOUT_MS    = 60_000;

// ── Provider implementations ─────────────────────────────────────────────────

async function tryOllama(prompt: string, system?: string): Promise<InferenceResult | null> {
  try {
    const start = Date.now();
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: system ? `${system}\n\n${prompt}` : prompt,
        stream: false,
        options: { temperature: 0.7, num_predict: 512 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json() as { response?: string; eval_count?: number };
    return {
      success: true,
      response: data.response ?? '',
      provider: 'ollama',
      model: OLLAMA_MODEL,
      duration_ms: Date.now() - start,
    };
  } catch {
    return null;
  }
}

async function tryOpenVINO(prompt: string, system?: string): Promise<InferenceResult | null> {
  try {
    // Check server is up
    const health = await fetch(`${OPENVINO_URL}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!health.ok) return null;

    const start = Date.now();
    const fullPrompt = system ? `${system}\n\n${prompt}` : prompt;
    const res = await fetch(`${OPENVINO_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: fullPrompt, max_tokens: 512 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json() as { success?: boolean; response?: string; model?: string; device?: string };
    if (!data.success) return null;
    return {
      success: true,
      response: data.response ?? '',
      provider: 'openvino',
      model: `${data.model ?? 'openvino'} (${data.device ?? 'GPU'})`,
      duration_ms: Date.now() - start,
    };
  } catch {
    return null;
  }
}

async function tryClaude(
  prompt: string,
  system?: string,
  model = 'claude-3-5-haiku-20241022'
): Promise<InferenceResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your-anthropic-key' || apiKey.startsWith('your_')) return null;

  try {
    const start = Date.now();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json() as { content?: Array<{ type: string; text: string }> };
    const text = (data.content ?? []).find(b => b.type === 'text')?.text ?? '';
    return {
      success: true,
      response: text,
      provider: 'claude',
      model,
      duration_ms: Date.now() - start,
    };
  } catch {
    return null;
  }
}

// ── Main router ───────────────────────────────────────────────────────────────

/**
 * Route a prompt through Ollama → OpenVINO → Claude.
 * Returns the first successful result.
 */
export async function infer(
  prompt: string,
  options?: {
    system?: string;
    /** Force a specific provider (skips routing) */
    provider?: InferenceProvider;
    /** Use Claude Opus for high-stakes reasoning (healing, governance) */
    highStakes?: boolean;
  }
): Promise<InferenceResult> {
  const { system, provider, highStakes } = options ?? {};
  const claudeModel = highStakes
    ? 'claude-opus-4-7'
    : 'claude-3-5-haiku-20241022';

  // Forced provider
  if (provider === 'claude') {
    const r = await tryClaude(prompt, system, claudeModel);
    return r ?? failed('Claude not configured');
  }
  if (provider === 'ollama') {
    const r = await tryOllama(prompt, system);
    return r ?? failed('Ollama unavailable');
  }
  if (provider === 'openvino') {
    const r = await tryOpenVINO(prompt, system);
    return r ?? failed('OpenVINO server unavailable');
  }

  // Auto-route: try each in order
  const ollama = await tryOllama(prompt, system);
  if (ollama) return ollama;

  const ov = await tryOpenVINO(prompt, system);
  if (ov) return ov;

  const claude = await tryClaude(prompt, system, claudeModel);
  if (claude) return claude;

  return failed('All inference providers unavailable');
}

/**
 * Convenience: generate + parse JSON response.
 * Appends "Respond ONLY with valid JSON." to the system prompt.
 */
export async function inferJSON<T>(
  prompt: string,
  options?: Parameters<typeof infer>[1]
): Promise<{ data: T | null; raw: InferenceResult }> {
  const systemWithJSON = [
    options?.system,
    'Respond ONLY with valid JSON. No markdown fences, no explanation.',
  ].filter(Boolean).join('\n\n');

  const result = await infer(prompt, { ...options, system: systemWithJSON });

  if (!result.success) return { data: null, raw: result };

  try {
    const match = result.response.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    const data = match ? JSON.parse(match[0]) as T : null;
    return { data, raw: result };
  } catch {
    return { data: null, raw: result };
  }
}

function failed(error: string): InferenceResult {
  return { success: false, response: '', provider: 'none', model: 'none', duration_ms: 0, error };
}
