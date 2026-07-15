const MissionPlanner = require('../../../src/hydi-v3/MissionPlanner');

describe('MissionPlanner', () => {
  let planner;

  beforeEach(async () => {
    planner = new MissionPlanner({ storagePath: '/tmp/hydi-test-missions' });
    await planner.initialize();
  });

  afterEach(() => {
    planner.destroy();
  });

  test('creates mission and adds task', () => {
    const missionId = planner.createMission('test', 'test objective');
    expect(missionId).toBeTruthy();
    const taskId = planner.addTask(missionId, { type: 'automation', description: 'do work' });
    expect(planner.getMission(missionId).tasks.length).toBe(1);
    expect(planner.getMission(missionId).tasks[0].id).toBe(taskId);
  });

  test('respects task dependencies', () => {
    const missionId = planner.createMission('test', 'deps');
    const a = planner.addTask(missionId, { type: 'automation', description: 'A' });
    const b = planner.addTask(missionId, { type: 'automation', description: 'B', dependencies: [a] });
    planner.planMission(missionId);
    const tasks = planner.getNextTasks(5);
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe(a);

    planner.startTask(a, missionId);
    planner.completeTask(a, missionId, { success: true });
    const next = planner.getNextTasks(5);
    expect(next.length).toBe(1);
    expect(next[0].id).toBe(b);
  });

  test('replanMission resets failed tasks', () => {
    const missionId = planner.createMission('test', 'replan');
    const task = planner.addTask(missionId, { type: 'automation', description: 'fail' });
    planner.planMission(missionId);
    planner.startTask(task, missionId);
    planner.failTask(task, missionId, 'timeout');
    planner.startTask(task, missionId);
    planner.completeTask(task, missionId, { success: true });
    const mission = planner.getMission(missionId);
    expect(mission.status).toBe('completed');
  });

  test('cancels and archives mission', () => {
    const missionId = planner.createMission('test', 'archive');
    planner.cancelMission(missionId);
    expect(planner.getMission(missionId).status).toBe('cancelled');
    planner.archiveMission(missionId);
    expect(planner.getMission(missionId).status).toBe('archived');
  });
});
