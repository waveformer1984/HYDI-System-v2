'use strict';

/**
 * AppRealizationMission tests — the 'realize app' mission type: durable
 * goal per app, linear stage machine (audit → spec → test → wire →
 * deploy → revenue → proof), durable Human Actions at genuine
 * boundaries, verifier-gated resume. Isolated tmp app dirs + fakes.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ha-ar-')), 'human-actions.json');
process.env.HYDI_HUMAN_ACTIONS_FILE = tmpFile;

const { HumanActionService } = require('../../lib/human-actions/service');
const { advance, brief, loadApp } = require('../../lib/realization/app-realization');

let goalSeq = 0;
function fakeGoals() {
  const store = new Map();
  return {
    store,
    async createGoal(input) {
      const g = { goalId: `g_${++goalSeq}`, status: 'pending', evidence: [], ...input, context: input.context || {} };
      store.set(g.goalId, g);
      return g;
    },
    async getGoal(id) { return store.get(id) || null; },
    async updateGoal(id, patch) {
      const g = store.get(id);
      if (g && patch.context) g.context = patch.context;
      if (g && patch.status) g.status = patch.status;
      return g;
    },
    async listGoals(f = {}) { return [...store.values()].filter((g) => !f.status || g.status === f.status); },
  };
}

/** A fake app module in a tmp dir — manifest + src + tests. */
function fakeAppDir(state = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-realize-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  const manifest = {
    name: 'TestApp', version: '0.1.0',
    capabilities: ['builder'],
    eventsProduced: ['project.created'],
    providers: ['protoiy-engine'],
    realization: {
      servicePort: 3999, healthPath: '/health',
      startCommand: 'node src/index.js', testCommand: 'npm test',
      engineHealthUrl: 'http://engine.test/health',
      engineProbe: { method: 'POST', url: 'http://engine.test/proto_iy/project', body: { name: 'PROBE' }, expectJsonField: 'project_id' },
      offerId: 'testapp_project',
    },
    ...state.manifest,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

/** Fakes controlling every stage's external reality. */
function makeWorld(dir, { tests = 0, engine = 500, health = 503, offer = null } = {}) {
  const world = {
    testsCode: tests, engineCode: engine, deployCode: health, offer,
    async fetch(url, opts = {}) {
      const u = String(url);
      if (u.includes('engine.test')) {
        if (u.endsWith('/health')) return { status: world.engineCode === 200 ? 200 : world.engineCode, json: async () => ({ status: 'ok' }) };
        if (world.engineCode === 200) return { status: 200, json: async () => ({ project_id: 42 }) };
        return { status: world.engineCode, json: async () => ({ error: 'engine broken' }) };
      }
      // deploy health probe
      return { status: world.deployCode, json: async () => ({ status: 'ok' }) };
    },
    async runCommand() { return { code: world.testsCode, output: world.testsCode === 0 ? 'tests 28\npass 28\nfail 0' : 'fail 3' }; },
    catalog: { get: () => world.offer },
  };
  return world;
}

function depsFor(dir, world) {
  const goals = fakeGoals();
  const verifierDeps = { fetch: (u, o) => world.fetch(u, o), runCommand: world.runCommand, catalog: world.catalog };
  const service = new HumanActionService({ verifierDeps });
  return { goals, service, verifierDeps, appDir: () => dir, actor: 'test' };
}

const APP = 'testapp';

describe('app realization', () => {
  test('unrealizable when no manifest exists — honest dead end', async () => {
    const deps = depsFor('/nonexistent-dir-xyz', makeWorld(''));
    const report = await advance({ ...deps, appId: 'ghost-app' });
    expect(report.stage).toBe('unrealizable');
    expect((await deps.goals.listGoals()).length).toBe(0); // no fabricated goal
  });

  test('audit+spec+test pass, broken engine parks at wire with exact action', async () => {
    const dir = fakeAppDir();
    const world = makeWorld(dir, { tests: 0, engine: 500 });
    const deps = depsFor(dir, world);
    const report = await advance({ ...deps, appId: APP });

    expect(report.stage).toBe('WAITING_ON_HUMAN');
    // audit, spec (contract generated), test all ran before the park
    const stages = report.steps.map((s) => s.stage);
    expect(stages).toEqual(['audit', 'spec', 'test', 'wire']);
    expect(fs.existsSync(path.join(dir, 'capability-contract.json'))).toBe(true);

    const goal = await deps.goals.getGoal(report.goalId);
    expect(goal.status).toBe('escalated');
    const actions = deps.service.list({ includeTerminal: true });
    const engine = actions.find((a) => a.blockerKey === `app:${APP}:engine`);
    expect(engine).toBeTruthy();
    expect(engine.verifier.name).toBe('http-endpoint');
    expect(engine.instructions.join(' ')).toMatch(/engine/i);

    // parked — a second pass does not duplicate the action
    const again = await advance({ ...deps, appId: APP });
    expect(again.stage).toBe('WAITING_ON_HUMAN');
    expect(deps.service.list({ includeTerminal: true }).filter((a) => a.blockerKey === `app:${APP}:engine`).length).toBe(1);
  });

  test('failing test suite parks at test, not wire — never skips stages', async () => {
    const dir = fakeAppDir();
    const world = makeWorld(dir, { tests: 1, engine: 200, health: 200, offer: { offerId: 'x', priceCents: 100 } });
    const deps = depsFor(dir, world);
    const report = await advance({ ...deps, appId: APP });
    expect(report.stage).toBe('WAITING_ON_HUMAN');
    const a = deps.service.list({ includeTerminal: true }).find((x) => x.blockerKey === `app:${APP}:tests`);
    expect(a).toBeTruthy();
    // engine never probed — wire never reached
  });

  test('full realization: wire → deploy → revenue → APP_REALIZED as boundaries clear', async () => {
    const dir = fakeAppDir();
    const world = makeWorld(dir, { tests: 0, engine: 500, health: 503, offer: null });
    const deps = depsFor(dir, world);

    // Parked at engine.
    let r = await advance({ ...deps, appId: APP });
    expect(r.stage).toBe('WAITING_ON_HUMAN');
    expect(r.waiting.prerequisites[0].blockerKey).toBe(`app:${APP}:engine`);

    // Human fixes the engine (external repo) → advance re-verifies, resumes.
    world.engineCode = 200;
    r = await advance({ ...deps, appId: APP });
    expect(r.stage).toBe('WAITING_ON_HUMAN');
    expect(r.waiting.prerequisites.find((p) => p.blockerKey === `app:${APP}:engine`).status).toBe('RESOLVED');
    expect(r.waiting.prerequisites.some((p) => p.blockerKey === `app:${APP}:deploy`)).toBe(true);

    // Human deploys the service → advance resumes to the offer boundary,
    // surfaced as the commercial-review action (decision-ready proposal).
    world.deployCode = 200;
    r = await advance({ ...deps, appId: APP });
    expect(r.stage).toBe('WAITING_ON_HUMAN');
    expect(r.waiting.prerequisites.some((p) => p.blockerKey === `app:${APP}:commercial`)).toBe(true);

    // Human approves the offer → mission completes with durable proof.
    world.offer = { offerId: 'testapp_project', priceCents: 4900, currency: 'usd' };
    r = await advance({ ...deps, appId: APP });
    expect(r.stage).toBe('APP_REALIZED');
    expect(r.proof.type).toBe('APP_REALIZED');
    expect(r.proof.appId).toBe(APP);
    expect(r.proof.deployedPort).toBe(3999);

    const goal = await deps.goals.getGoal(r.goalId);
    expect(goal.status).toBe('completed');
    expect(goal.context.appRealization.proof.type).toBe('APP_REALIZED');

    // Terminal — further advances return proof, never re-run stages.
    const again = await advance({ ...deps, appId: APP });
    expect(again.stage).toBe('APP_REALIZED');
  });

  test('already-deployed app skips the deploy boundary', async () => {
    const dir = fakeAppDir();
    const world = makeWorld(dir, { tests: 0, engine: 200, health: 200, offer: { offerId: 'x', priceCents: 100 } });
    const deps = depsFor(dir, world);
    const r = await advance({ ...deps, appId: APP });
    expect(r.stage).toBe('APP_REALIZED');
    // no boundary actions linked to this goal — everything verified autonomously
    const linked = deps.service.list({ includeTerminal: true }).filter((a) => a.sourceGoalId === r.goalId);
    expect(linked.length).toBe(0);
  });

  test('engine-hosted app: no local suite defers to wire, deploy = engine up', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-hosted-'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      name: 'HostedApp', version: '0.1.0',
      realization: {
        hosted: 'ursula-engine',
        engineHealthUrl: 'http://engine.test/health',
        engineProbe: { method: 'POST', url: 'http://engine.test/svc/thing', body: {}, expectJsonField: 'project_id' },
        offerId: 'hosted_thing',
      },
    }));
    const world = makeWorld(dir, { tests: 0, engine: 200, health: 503, offer: null });
    const deps = depsFor(dir, world);

    // Wire + hosted deploy pass; parks only at the offer boundary.
    const r = await advance({ ...deps, appId: 'hosted-app' });
    expect(r.stage).toBe('WAITING_ON_HUMAN');
    const stages = r.steps.map((s) => s.stage);
    expect(stages).toEqual(['audit', 'spec', 'test', 'wire', 'deploy', 'revenue']);
    const open = r.waiting.prerequisites.filter((p) => p.status !== 'RESOLVED');
    expect(open.map((p) => p.blockerKey)).toEqual(['app:hosted-app:commercial']);

    // Offer approved → APP_REALIZED with hostedBy recorded in the proof.
    world.offer = { offerId: 'hosted_thing', priceCents: 900, currency: 'usd' };
    const r2 = await advance({ ...deps, appId: 'hosted-app' });
    expect(r2.stage).toBe('APP_REALIZED');
    expect(r2.proof.hostedBy).toBe('ursula-engine');
  });

  test('brief() renders durable state without advancing', async () => {
    const dir = fakeAppDir();
    const world = makeWorld(dir, { tests: 0, engine: 500 });
    const deps = depsFor(dir, world);
    await advance({ ...deps, appId: APP });
    const { text, report } = await brief({ ...deps, appId: APP });
    expect(text).toMatch(/APP REALIZATION/);
    expect(text).toMatch(/TestApp/);
    expect(report.stage).toBe('wire');
  });
});
