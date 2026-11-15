'use strict';

/**
 * Provider-independent OpenAI adapter (server-side only).
 * Live calls require HYDI_ALLOW_PAID_LLM=true AND OPENAI_API_KEY via paid-llm-gate.
 * Default mode is mock — no network, no spend.
 */

const { paidApiKey, isPaidLlmAllowed } = require('../cost/paid-llm-gate');

const DEFAULT_MODEL = 'gpt-4o-mini';

function resolveMode(env = process.env) {
  const explicit = String(env.HYDI_OPENAI_ADAPTER_MODE || '').trim().toLowerCase();
  if (explicit === 'live') return 'live';
  if (explicit === 'mock') return 'mock';
  if (paidApiKey('OPENAI_API_KEY', env)) return 'live';
  return 'mock';
}

function capability(env = process.env) {
  return {
    mode: resolveMode(env),
    paid_switch: isPaidLlmAllowed(env),
    key_configured: Boolean(env.OPENAI_API_KEY && String(env.OPENAI_API_KEY).trim()),
    live_allowed: Boolean(paidApiKey('OPENAI_API_KEY', env)),
    responses_api: resolveMode(env) === 'live',
    streaming_supported: true,
    structured_output_supported: true,
  };
}

function mockResponse(input) {
  const text = typeof input === 'string' ? input : JSON.stringify(input).slice(0, 200);
  return {
    ok: true,
    mode: 'mock',
    classification: 'VERIFIED_SIMULATED',
    model: DEFAULT_MODEL,
    output_text: `[mock-openai] received ${text.length} chars; no API call made`,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    id: `mock-${Date.now()}`,
  };
}

async function createResponse({ input, model = DEFAULT_MODEL, tools = null, stream = false }, env = process.env) {
  const mode = resolveMode(env);
  if (mode === 'mock') {
    if (stream) {
      return { ok: true, mode: 'mock', stream: false, classification: 'VERIFIED_SIMULATED', chunks: [mockResponse(input)] };
    }
    return mockResponse(input);
  }

  const key = paidApiKey('OPENAI_API_KEY', env);
  if (!key) {
    return {
      ok: false,
      mode: 'blocked',
      classification: 'REQUIRES_OPERATOR_APPROVAL',
      error: 'paid_llm_disabled',
      message: 'Set HYDI_ALLOW_PAID_LLM=true and OPENAI_API_KEY for live OpenAI calls',
    };
  }

  const body = {
    model,
    input: typeof input === 'string' ? input : JSON.stringify(input),
  };
  if (tools && Array.isArray(tools)) body.tools = tools;

  const controller = new AbortController();
  const timeoutMs = Number(env.HYDI_OPENAI_TIMEOUT_MS || 30_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        ok: false,
        mode: 'live',
        classification: 'VERIFIED LIVE',
        error: `http_${res.status}`,
        message: 'OpenAI Responses API error',
      };
    }
    const data = await res.json();
    return {
      ok: true,
      mode: 'live',
      classification: 'VERIFIED LIVE',
      model,
      raw: data,
      output_text: data.output_text || data.output?.[0]?.content?.[0]?.text || '',
      usage: data.usage || null,
      id: data.id,
    };
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : 'openai_fetch_failed';
    return { ok: false, mode: 'live', classification: 'VERIFIED LIVE', error: message };
  }
}

module.exports = {
  DEFAULT_MODEL,
  capability,
  resolveMode,
  mockResponse,
  createResponse,
};