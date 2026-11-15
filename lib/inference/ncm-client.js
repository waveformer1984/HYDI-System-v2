'use strict';

const DEFAULT_URL = 'http://127.0.0.1:8791';

function ncmServiceUrl(env = process.env) {
  return String(env.HYDI_NCM_SERVICE_URL || DEFAULT_URL).replace(/\/$/, '');
}

function ncmEnabled(env = process.env) {
  return env.HYDI_NCM_ENABLED === '1' || env.HYDI_NCM_ENABLED === 'true';
}

/**
 * Health probe for the isolated NCM inference service (no secrets).
 * @returns {Promise<{ ok: boolean, status?: number, mode?: string, error?: string }>}
 */
async function probeNcmHealth(env = process.env, timeoutMs = 3000) {
  const url = `${ncmServiceUrl(env)}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    const body = await res.json();
    return { ok: true, status: res.status, mode: body.mode, checkpoint: body.checkpoint || null };
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : 'probe failed';
    return { ok: false, error: msg };
  }
}

/**
 * @param {{ prompt: string, task?: string, max_tokens?: number }} input
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{ ok: boolean, text?: string, engine: 'ncm', latencyMs: number, error?: string, metadata?: object }>}
 */
async function generateViaNcm(input, env = process.env) {
  const start = Date.now();
  const url = `${ncmServiceUrl(env)}/v1/generate`;
  const timeoutMs = Number(env.HYDI_NCM_TIMEOUT_MS || 120_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: String(input.prompt || ''),
        task: input.task || 'planning',
        max_tokens: input.max_tokens || 512,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        engine: 'ncm',
        latencyMs,
        error: data.error || `HTTP ${res.status}`,
        metadata: data.metadata || null,
      };
    }
    return {
      ok: true,
      engine: 'ncm',
      latencyMs,
      text: String(data.text || ''),
      metadata: data.metadata || null,
    };
  } catch (e) {
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    const msg = e instanceof Error ? e.message : 'generate failed';
    return { ok: false, engine: 'ncm', latencyMs, error: msg };
  }
}

module.exports = {
  DEFAULT_NCM_URL: DEFAULT_URL,
  ncmServiceUrl,
  ncmEnabled,
  probeNcmHealth,
  generateViaNcm,
};