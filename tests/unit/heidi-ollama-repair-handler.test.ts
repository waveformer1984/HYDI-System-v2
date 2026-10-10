/**
 * createOllamaRepairHandler — LIVE path (Tier 2).
 *
 * These tests exercise the handler's real attempt-and-verify path, which
 * includes a real `ollama serve` process spawn. That cannot run in Tier 1:
 * tests/tier1-hermetic-guard.js sets HYDI_DISABLE_LIVE_ACTIONS=1 and the
 * handler refuses before touching exec or the network (asserted in
 * heidi-recovery-verification.test.ts).
 *
 * In Tier 2 the env flag is unset and the handler runs for real. fetch is
 * still mocked — not for hermeticity but for DETERMINISM: it forces the
 * "service down" and "service up" branches regardless of whether Ollama
 * happens to be installed or running on the machine.
 *
 * Note: test 2 really executes `start /B ollama serve` (Windows) /
 * `nohup ollama serve` (Unix) on the host — that IS the repair action this
 * handler exists to perform. The 15s verification poll is mocked-failed, so
 * the test takes ~15s by design.
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { createOllamaRepairHandler } from '../../lib/operational/SelfRepairEngine';

describe('createOllamaRepairHandler — live path (Tier 2)', () => {
  test('idempotent — returns success if already healthy', async () => {
    const originalFetch = global.fetch;
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    try {
      const handler = createOllamaRepairHandler({ url: 'http://localhost:11434' });
      const result = await handler('system.local_model', 'Start Ollama');

      expect(result.success).toBe(true);
      expect(result.evidence).toContain('already healthy');
    } finally {
      (global as any).fetch = originalFetch;
    }
  });

  test('reports failure when service does not come up (real spawn + 15s poll)', async () => {
    const originalFetch = global.fetch;
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('connection refused'));

    try {
      const handler = createOllamaRepairHandler({ url: 'http://localhost:99999' });
      // Real `ollama serve` spawn happens here; the 15s verification loop
      // is mocked-failed so the handler reports failure honestly.
      const result = await handler('system.local_model', 'Start Ollama');

      expect(result.success).toBe(false);
      expect(result.evidence).toContain('not responding');
    } finally {
      (global as any).fetch = originalFetch;
    }
  }, 30000);
});
