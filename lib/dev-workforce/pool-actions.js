'use strict';

const { callOllamaAdvisor } = require('../governance/action-advisor');

const { safePoolHttpGet } = require('./pool-fetch-guard');
const { guardCloneExecution } = require('./clone-context');

const DEFAULT_MODEL = 'qwen2.5:3b-instruct-q4_K_M';

async function poolHttpFetch(args, ctx = {}) {
  const guard = guardCloneExecution(ctx.cloneExecution || ctx, 'pool.http_fetch');
  if (!guard.ok) return guard;
  const url = String(args?.url || '').trim();
  try {
    return await safePoolHttpGet(url, ctx.poolFetchDeps || {});
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch_failed';
    return { ok: false, error: msg, url };
  }
}

async function poolLlmComplete(args, ctx = {}) {
  const prompt = String(args?.prompt || '').slice(0, 12_000);
  if (!prompt) return { ok: false, error: 'empty_prompt' };
  const model = String(args?.model || process.env.POOL_LLM_MODEL || DEFAULT_MODEL);
  try {
    const text = await callOllamaAdvisor({
      prompt,
      model,
      timeoutMs: Math.min(Number(args.timeoutMs) || 45_000, 120_000),
      fetchImpl: ctx.fetchImpl,
    });
    return { ok: true, model, text: text.slice(0, 16_000) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'llm_failed' };
  }
}

async function poolVerifyEvidence(args, ctx = {}) {
  const criteria = String(args?.criteria || '').slice(0, 4000);
  const evidence = String(args?.evidence || '').slice(0, 12_000);
  const prompt = [
    'You verify evidence only. Reply JSON: {"verdict":"PASS"|"FAIL"|"PARTIAL","summary":"..."}',
    'Criteria:',
    criteria,
    'Evidence:',
    evidence,
  ].join('\n');
  const llm = await poolLlmComplete({ prompt, timeoutMs: args.timeoutMs }, ctx);
  if (!llm.ok) return llm;
  let verdict = 'PARTIAL';
  try {
    const m = llm.text.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      if (['PASS', 'FAIL', 'PARTIAL'].includes(parsed.verdict)) verdict = parsed.verdict;
    }
  } catch {
    /* keep PARTIAL */
  }
  return { ok: true, verdict, raw: llm.text.slice(0, 4000) };
}

async function poolWriteDocument(args) {
  const title = String(args?.title || 'draft').slice(0, 200);
  const body = String(args?.body || '').slice(0, 32_000);
  return { ok: true, title, body, format: 'markdown' };
}

async function poolEmitSpp(args) {
  const text = String(args?.text || '').slice(0, 8000);
  if (!text.trim()) return { ok: false, error: 'empty_spp' };
  return { ok: true, spp: text, ran_code: false };
}

const RUNNERS = Object.freeze({
  'pool.http_fetch': poolHttpFetch,
  'pool.llm_complete': poolLlmComplete,
  'pool.verify_evidence': poolVerifyEvidence,
  'pool.write_document': poolWriteDocument,
  'pool.emit_spp': poolEmitSpp,
});

function runPoolCapability(capabilityId, args, ctx) {
  const guard = guardCloneExecution(ctx.cloneExecution || ctx, capabilityId);
  if (!guard.ok) return Promise.resolve(guard);
  const fn = RUNNERS[capabilityId];
  if (!fn) return Promise.resolve({ ok: false, error: 'unknown_pool_capability' });
  return fn(args, ctx);
}

module.exports = {
  runPoolCapability,
  RUNNERS,
  poolHttpFetch,
  poolLlmComplete,
  poolVerifyEvidence,
  DEFAULT_MODEL,
};