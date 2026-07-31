const ReflectionEngine = require('../../../src/hydi-v3/ReflectionEngine');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('ReflectionEngine', () => {
  let engine;
  let storagePath;

  beforeEach(async () => {
    storagePath = path.join(os.tmpdir(), `hydi-test-reflections-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    engine = new ReflectionEngine({ storagePath });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.destroy();
    await fs.rm(storagePath, { recursive: true, force: true }).catch(() => {});
  });

  test('reflects on completed mission', async () => {
    const mission = {
      id: 'm1',
      tasks: [
        { id: 't1', status: 'completed', type: 'outreach', result: { strategy: 'email' } },
        { id: 't2', status: 'failed', type: 'outreach', error: 'timeout' },
      ],
      revenue: 50,
      replanCount: 0,
    };
    const reflection = await engine.reflectOnMission(mission);
    expect(reflection).toBeTruthy();
    expect(reflection.missionId).toBe('m1');
    expect(reflection.rootCauses.length).toBeGreaterThan(0);
  });

  test('updates strategy rankings', async () => {
    const mission = {
      id: 'm1',
      tasks: [
        { id: 't1', status: 'completed', type: 'revenue', result: { strategy: 'outreach' } },
      ],
      revenue: 10,
    };
    await engine.reflectOnMission(mission);
    const best = engine.getBestStrategy('revenue');
    expect(best).not.toBeNull();
    expect(best.strategy).toBe('outreach');
  });
});
