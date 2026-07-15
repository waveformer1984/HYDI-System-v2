const DecisionIntelligence = require('../../../src/hydi-v3/DecisionIntelligence');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('DecisionIntelligence', () => {
  let di;
  let storagePath;

  beforeEach(async () => {
    storagePath = path.join(os.tmpdir(), `hydi-test-decisions-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    di = new DecisionIntelligence({ storagePath });
    await di.initialize();
  });

  afterEach(async () => {
    di.destroy();
    await fs.rm(storagePath, { recursive: true, force: true }).catch(() => {});
  });

  test('validates safe decision', async () => {
    const decision = await di.makeDecision(
      { action: 'send_email', confidence: 0.9, reason: 'outreach' },
      { resources: { cpu: 0.1, memory: 0.2 } }
    );
    expect(decision.valid).toBe(true);
  });

  test('rejects dangerous action', async () => {
    const decision = await di.makeDecision(
      { action: 'delete_production_database', confidence: 0.9, reason: 'cleanup' },
      { resources: { cpu: 0.1, memory: 0.2 } }
    );
    expect(decision.valid).toBe(false);
  });

  test('records and searches history', async () => {
    di.recordDecision(
      { id: 't1', missionId: 'm1' },
      { action: 'send_email', confidence: 0.8 },
      { success: true, revenue: 10 }
    );
    const history = di.searchHistory({ missionId: 'm1' });
    expect(history.length).toBe(1);
    expect(history[0].revenue).toBe(10);
  });

  test('estimates success probability from history', () => {
    for (let i = 0; i < 4; i++) {
      di.appendDecision({ id: `d${i}`, strategy: 'outreach', confidence: 0.8, outcome: { status: i < 3 ? 'success' : 'failure' } });
    }
    const decision = di.createDecisionRecord({ strategy: 'outreach', confidence: 0.8 }, {});
    expect(di.estimateSuccessProbability(decision)).toBe(0.75);
  });
});
