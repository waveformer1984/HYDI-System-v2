'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { proposeMissionsFromFixList } = require('../../lib/observation/fix-list-missions');

describe('fix-list-missions', () => {
  it('proposes a mission for persistent CRIT drift with boot module restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlist-'));
    const missions = [];
    const memory = {
      createMission: jest.fn(async (goal, priority, context) => {
        missions.push({ goal, priority, context });
        return missions.length;
      }),
    };
    const fixList = {
      items: [{
        id: 'abc123',
        kind: 'drift',
        level: 'CRIT',
        passes: 2,
        detail: 'rezonate-app NOT_ONLINE',
        proposedFix: { type: 'pm2_restart', command: 'pm2 restart protoforge-core', risk: 'R1' },
      }],
    };
    const bootPath = path.join(dir, 'boot.config.json');
    fs.writeFileSync(bootPath, JSON.stringify({ modules: [{ id: 'protoforge-core' }] }));
    const out = await proposeMissionsFromFixList(fixList, {
      memory,
      fixlistDir: dir,
      bootConfigPath: bootPath,
    });
    expect(out.proposed).toBe(1);
    expect(memory.createMission).toHaveBeenCalled();
    expect(missions[0].context.action.target).toContain('restart-module.js');
  });

  it('dedupes by fix-list item id', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixlist-'));
    const memory = { createMission: jest.fn(async () => 1) };
    const item = {
      id: 'dup1',
      kind: 'drift',
      level: 'CRIT',
      passes: 3,
      detail: 'x',
      proposedFix: { type: 'human' },
    };
    await proposeMissionsFromFixList({ items: [item] }, { memory, fixlistDir: dir });
    const second = await proposeMissionsFromFixList({ items: [item] }, { memory, fixlistDir: dir });
    expect(second.proposed).toBe(0);
    expect(memory.createMission).toHaveBeenCalledTimes(1);
  });
});
