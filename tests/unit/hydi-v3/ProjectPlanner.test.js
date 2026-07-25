'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const ProjectPlanner = require('../../../src/hydi-v3/ProjectPlanner');
const TaskEngine = require('../../../src/hydi-v3/TaskEngine');

describe('ProjectPlanner', () => {
  let planner;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-project-planner-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    planner = new ProjectPlanner({
      dataPath,
      logger: { log: () => {}, error: () => {} },
    });
  });

  afterEach(async () => {
    if (planner) {
      await planner.destroy().catch(() => {});
    }
    try {
      await fs.rm(dataPath, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
    planner = null;
  });

  test('starts, stops, and destroys cleanly', async () => {
    await planner.start();
    expect(planner._started).toBe(true);
    await planner.start();
    planner.stop();
    expect(planner._started).toBe(false);
    await planner.destroy();
    expect(planner._destroyed).toBe(true);
    expect(planner._persistTimer).toBeNull();
  });

  test('creates a project with the eight-stage engineering workflow', () => {
    const id = planner.createProject({
      name: 'Auth System',
      goals: ['add authentication'],
    });
    const project = planner.getProject(id);
    expect(project.name).toBe('Auth System');
    expect(project.goals.length).toBe(1);
    expect(project.milestones.length).toBe(1);
    expect(project.tasks.length).toBe(8);
    expect(project.tasks.map((t) => t.stage)).toEqual([
      'analyze', 'plan', 'implement', 'test', 'benchmark', 'document', 'commit', 'report',
    ]);
  });

  test('constructs a dependency chain within each goal', () => {
    const id = planner.createProject({
      goals: [{ title: 'payments', priority: 'high' }],
    });
    const tasks = planner.getProject(id).tasks;
    for (let i = 1; i < tasks.length; i += 1) {
      expect(tasks[i].dependencies).toContain(tasks[i - 1].id);
    }
  });

  test('backlog filters by status and project', () => {
    const a = planner.createProject({ name: 'A', goals: ['feature A'] });
    const b = planner.createProject({ name: 'B', goals: ['feature B'] });
    const backlog = planner.getBacklog(null, { status: 'pending' });
    expect(backlog.length).toBe(16);
    expect(planner.getBacklog(a, { status: 'pending' }).length).toBe(8);
    expect(planner.getBacklog(b, { status: 'pending' }).length).toBe(8);
  });

  test('prioritize reorders pending backlog', () => {
    const id = planner.createProject({
      goals: [
        { title: 'critical fix', priority: 'critical' },
        { title: 'low fix', priority: 'low' },
      ],
    });
    const ordered = planner.prioritize(id, 'priority');
    const criticalFirst = ordered.findIndex((t) => t.goal === 'critical fix');
    const lowFirst = ordered.findIndex((t) => t.goal === 'low fix');
    expect(criticalFirst).toBeLessThan(lowFirst);
  });

  test('executes a project through the TaskEngine', async () => {
    await planner.start();
    const id = planner.createProject({
      name: 'Test Project',
      goals: ['one feature'],
    });
    const taskEngine = new TaskEngine({
      dataPath: path.join(dataPath, 'tasks'),
      maxConcurrency: 2,
      maxRetries: 0,
      logger: { log: () => {}, error: () => {} },
    });
    await taskEngine.start();

    const handlers = {
      analyze: async () => 'analyzed',
      plan: async () => 'planned',
      implement: async () => 'implemented',
      test: async () => 'tested',
      benchmark: async () => 'benchmarked',
      document: async () => 'documented',
      commit: async () => 'committed',
      report: async () => 'reported',
    };

    planner.toTaskEngine(id, taskEngine, handlers);
    while (taskEngine.getStatus().completed < 8 && taskEngine.getStatus().failed === 0) {
      // eslint-disable-next-line no-await-in-loop
      await taskEngine.processReadyTasks();
    }

    expect(taskEngine.getStatus().completed).toBe(8);
    expect(taskEngine.getStatus().failed).toBe(0);
    expect(planner.getProject(id).tasks.every((t) => t.status === 'completed')).toBe(true);
    await taskEngine.destroy();
  });

  test('persists and restores projects across instances', async () => {
    await planner.start();
    const id = planner.createProject({ name: 'Persistent', goals: ['goal'] });
    await planner.destroy();

    const restored = new ProjectPlanner({
      dataPath,
      logger: { log: () => {}, error: () => {} },
    });
    await restored.start();
    expect(restored.getProject(id)).toBeTruthy();
    expect(restored.getProject(id).tasks.length).toBe(8);
    await restored.destroy();
  });

  test('adds backlog items after project creation', () => {
    const id = planner.createProject({ name: 'Evolve', goals: ['first'] });
    planner.addBacklogItem(id, { title: 'security audit', priority: 'high' });
    const project = planner.getProject(id);
    expect(project.goals.length).toBe(2);
    expect(project.tasks.length).toBe(16);
    expect(project.tasks.some((t) => t.title.includes('security audit'))).toBe(true);
  });

  test('deletes a project', () => {
    const id = planner.createProject({ name: 'Delete Me', goals: ['x'] });
    expect(planner.deleteProject(id)).toBe(true);
    expect(planner.getProject(id)).toBeUndefined();
    expect(planner.deleteProject(id)).toBe(false);
  });

  test('getStatus summarizes all projects and tasks', () => {
    planner.createProject({ name: 'A', goals: ['one'] });
    planner.createProject({ name: 'B', goals: ['two', 'three'] });
    const status = planner.getStatus();
    expect(status.projects).toBe(2);
    expect(status.milestones).toBe(3);
    expect(status.totalTasks).toBe(24);
    expect(status.pending).toBe(24);
  });

  test('recovers from corrupted persistence', async () => {
    const file = path.join(dataPath, 'project-planner.json');
    await fs.writeFile(file, 'not-json { corrupted');
    const recovered = new ProjectPlanner({ dataPath, logger: { log: () => {}, error: () => {} } });
    await expect(recovered.start()).resolves.toBeUndefined();
    expect(recovered.getStatus().projects).toBe(0);
    const corruptFiles = (await fs.readdir(dataPath)).filter((f) => f.includes('corrupt'));
    expect(corruptFiles.length).toBeGreaterThan(0);
    await recovered.destroy();
  });

  test('initialize, healthCheck, and flush are supported', async () => {
    planner.createProject({ name: 'Health', goals: ['goal'] });
    await planner.initialize();
    expect(planner._started).toBe(true);
    await planner.flush();
    const health = planner.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.checks.dependencyTargetsExist).toBe(true);
    expect(health.checks.noOrphanTasks).toBe(true);
    expect(health.checks.milestoneCoverage).toBe(true);
  });

  test('gracefully handles edge cases', () => {
    expect(() => planner.createProject({})).not.toThrow();
    const emptyProjectId = planner.createProject({ goals: [] });
    expect(planner.getProject(emptyProjectId).tasks.length).toBe(0);
    expect(planner.deleteProject('nonexistent')).toBe(false);
    expect(() => planner.prioritize('nonexistent')).toThrow();
    expect(() => planner.toTaskEngine('nonexistent', {})).toThrow();
    expect(planner.getBacklog(null, { status: 'completed' })).toEqual([]);
    const health = planner.healthCheck();
    expect(health.ok).toBe(true);
  });

  test('benchmark: plans 50 projects in under one second', () => {
    const start = Date.now();
    for (let i = 0; i < 50; i += 1) {
      planner.createProject({ name: `project-${i}`, goals: [`goal-${i}`] });
    }
    const elapsed = Date.now() - start;
    expect(planner.getStatus().projects).toBe(50);
    expect(elapsed).toBeLessThan(1000);
  });
});
