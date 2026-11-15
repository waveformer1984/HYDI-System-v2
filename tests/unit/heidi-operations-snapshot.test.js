'use strict';

const { buildOperationsEvidenceSnapshot } = require('../../lib/heidi/operations-evidence-snapshot');

describe('operations evidence snapshot', () => {
  test('builds snapshot from mocked fetch and memory', async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes('/api/tags')) {
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'tinyllama' }] }),
        };
      }
      if (String(url).includes('/api/ping')) {
        return { ok: true, json: async () => ({ status: 'alive' }) };
      }
      if (String(url).includes('/api/health')) {
        return { ok: true, json: async () => ({ status: 'healthy' }) };
      }
      throw new Error('unreachable');
    };

    const memory = {
      listMissions: () => [
        { id: 'm1', status: 'awaiting_approval', title: 'restart x' },
        { id: 'm2', status: 'queued', title: 'info' },
      ],
    };

    const snap = await buildOperationsEvidenceSnapshot({
      fetchImpl,
      memory,
      memoryRuntime: { store: { probeWrite: () => {} } },
      env: { HYDI_ALLOW_PAID_LLM: 'false', OLLAMA_URL: 'http://127.0.0.1:11434', HEIDI_WEB_URL: 'http://127.0.0.1:3000' },
    });

    expect(snap.ok).toBe(true);
    expect(snap.system_status).toBeTruthy();
    expect(snap.inference.routes.length).toBeGreaterThan(5);
    expect(snap.missions.awaiting_approval).toHaveLength(1);
    expect(snap.capability_contracts.contracts_lifted).toBe(77);
    expect(snap.evidence_note).toMatch(/probes/i);
  });
});