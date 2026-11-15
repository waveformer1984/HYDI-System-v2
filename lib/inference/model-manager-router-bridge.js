'use strict';

/**
 * Thin bridge so ModelManager can opt into the intelligence router without
 * eager-loading NCM client code on every chat turn (dynamic import from TS).
 */

/**
 * @param {string} prompt
 * @param {NodeJS.ProcessEnv} env
 * @param {() => Promise<{ content: string, success: boolean, model?: string, latency?: number, error?: string }>} llmFallback
 * @returns {Promise<object|null>} null when router is off
 */
async function maybeCompleteViaIntelligenceRouter(prompt, env, llmFallback) {
  const routerTask = env.HYDI_ROUTER_TASK;
  if (env.HYDI_INTELLIGENCE_ROUTER !== '1' || !routerTask) {
    return null;
  }
  const { completeWithRouter } = await import('./intelligence-router.js');
  return completeWithRouter({ prompt, task: routerTask }, llmFallback, env);
}

module.exports = { maybeCompleteViaIntelligenceRouter };