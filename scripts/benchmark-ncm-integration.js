#!/usr/bin/env node
'use strict';

/**
 * Compare NCM sidecar (mock or live) vs Ollama on eligible tasks.
 * Safe to run without GPU — records BLOCKED rows when services are down.
 */

const os = require('os');
const { performance } = require('perf_hooks');
const { selectEngine, completeWithRouter, describeRouter } = require('../lib/inference/intelligence-router');
const { probeNcmHealth, ncmServiceUrl } = require('../lib/inference/ncm-client');

const PROMPTS = [
  { task: 'planning', prompt: 'Outline three steps to verify Heidi mobile pairing on Frank.' },
  { task: 'summarization', prompt: 'Summarize: HYDI uses a six-layer pipeline with fail-closed ProtoForge.' },
];

const ollamaUrl = (
  process.env.LOCAL_MODEL_URL ||
  process.env.OLLAMA_URL ||
  'http://127.0.0.1:11434'
).replace(/\/$/, '');

async function probeOllama() {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(t);
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function ollamaGenerate(prompt) {
  const model = process.env.LOCAL_MODEL_NAME || process.env.OLLAMA_MODEL || 'llama3.2';
  const start = performance.now();
  try {
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
    const data = await res.json().catch(() => ({}));
    const ms = performance.now() - start;
    if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
    return { ok: true, ms, text: String(data.response || ''), model };
  } catch (e) {
    return { ok: false, ms: performance.now() - start, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  const report = {
    schema_version: 1,
    collected_at: new Date().toISOString(),
    host: { platform: os.platform(), arch: os.arch(), cpus: os.cpus().length },
    router: describeRouter(process.env),
    ncm_url: ncmServiceUrl(process.env),
    ollama_url: ollamaUrl,
    probes: {},
    cases: [],
    promotion_gates: {
      ncm_faster_than_ollama: null,
      fallback_verified: null,
      note: 'Set promotion_gates manually after review; auto gate requires both backends healthy',
    },
  };

  report.probes.ncm = await probeNcmHealth(process.env);
  report.probes.ollama = await probeOllama();

  for (const { task, prompt } of PROMPTS) {
    const selection = selectEngine({ task, env: process.env });
    const caseRow = { task, selection, ncm: null, ollama: null, routed: null };

    if (report.probes.ncm.ok) {
      const env = { ...process.env, HYDI_NCM_ENABLED: '1', HYDI_INTELLIGENCE_ROUTER: '1' };
      const routed = await completeWithRouter(
        { prompt, task },
        async () => {
          const o = await ollamaGenerate(prompt);
          return {
            content: o.text || '',
            success: o.ok,
            model: o.model,
            latency: o.ms,
            error: o.error,
          };
        },
        env,
      );
      caseRow.routed = {
        engine: routed.engine,
        success: routed.success,
        latency_ms: routed.latency,
        fallback: Boolean(routed.router?.fallback_to_llm),
      };
    } else {
      caseRow.routed = { status: 'BLOCKED', reason: 'ncm_unavailable' };
    }

    if (report.probes.ollama.ok) {
      caseRow.ollama = await ollamaGenerate(prompt);
    } else {
      caseRow.ollama = { status: 'BLOCKED' };
    }

    report.cases.push(caseRow);
  }

  console.log(JSON.stringify(report, null, 2));
  const anyBlocked = !report.probes.ncm.ok || !report.probes.ollama.ok;
  process.exit(anyBlocked ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});