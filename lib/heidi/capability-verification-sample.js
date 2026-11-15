'use strict';

/**
 * Sample verification harness for one high-risk capability — mocked executor only.
 */

const SAMPLE_CAPABILITY = 'tool.update_database';

/**
 * @param {{ capabilityId?: string, executor: Function, input?: object }} opts
 */
async function verifyCapabilityWithMockExecutor(opts) {
  const capabilityId = opts.capabilityId || SAMPLE_CAPABILITY;
  const executor = opts.executor;
  if (typeof executor !== 'function') {
    throw new Error('executor required');
  }
  const started = Date.now();
  const result = await executor({ capabilityId, input: opts.input || {} });
  return {
    capabilityId,
    live_execution: false,
    verification_status: 'mocked',
    duration_ms: Date.now() - started,
    result,
    evidence: [{ type: 'mock_invocation', at: new Date().toISOString() }],
  };
}

module.exports = { SAMPLE_CAPABILITY, verifyCapabilityWithMockExecutor };