'use strict';

const { buildOperationsEvidenceSnapshot } = require('../../lib/heidi/operations-evidence-snapshot');

describe('operations evidence snapshot', () => {
  test('missions unavailable when memory not supplied', async () => {
    const snap = await buildOperationsEvidenceSnapshot({
      fetchImpl: async () => ({ ok: false, status: 0 }),
      env: { HYDI_ALLOW_PAID_LLM: 'false', ANTHROPIC_API_KEY: 'sk-should-not-appear' },
    });
    expect(snap.evidence.missions.evidence_state).toBe('missing');
    expect(snap.evidence.missions.error).toMatch(/not supplied/i);
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toMatch(/sk-should-not-appear/);
  });

  test('live rollup separate from stale file evidence', async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes('/api/tags')) {
        return { ok: true, json: async () => ({ models: [{ name: 'tinyllama' }] }) };
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
      listMissions: () => [{ id: 'm1', status: 'awaiting_approval', title: 't' }],
    };

    const snap = await buildOperationsEvidenceSnapshot({
      fetchImpl,
      memory,
      memoryRuntime: { store: { probeWrite: () => {} } },
      env: { HYDI_ALLOW_PAID_LLM: 'false', OLLAMA_URL: 'http://127.0.0.1:11434', HEIDI_WEB_URL: 'http://127.0.0.1:3000' },
    });

    expect(snap.execution_paths_unchanged).toBe(true);
    expect(snap.inference_registry_note).toMatch(/not completed/i);
    expect(snap.evidence.daemon_status_file.source).toContain('.heidi-daemon-status.json');
    expect(snap.capability_measurements.labels).toBeTruthy();
    expect(snap.capability_measurements.live_execution_verified.value).toBeNull();
    expect(snap.inference_audit.paid_gate.registry_metadata_alone).toBeTruthy();
    expect(snap.inference_audit.dispatch_proposal.execution_changed).toBe(false);
  });

  test('frank collector schema mismatch reported as failed evidence', async () => {
    const snap = await buildOperationsEvidenceSnapshot({
      frankProductionTruth: { schema_version: 99, collected_at: '2020-01-01T00:00:00Z' },
      fetchImpl: async () => ({ ok: false, status: 0 }),
    });
    expect(snap.evidence.frank_production_truth.evidence_state).toBe('failed');
    expect(snap.evidence.frank_production_truth.error).toMatch(/schema_version/);
  });
});