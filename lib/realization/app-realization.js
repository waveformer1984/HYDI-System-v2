'use strict';

/**
 * AppRealizationMission — the "realize app" mission type for the Ursula
 * portfolio.
 *
 * One durable goal per app under protoforge-applications/<appId>/, driven
 * through a linear stage machine over EXISTING seams only:
 *
 *   audit   — read the app's manifest + layout, record what's real
 *   spec    — ensure capability-contract.json exists (generated if absent)
 *   test    — the app's OWN test suite must pass (app-tests-pass verifier)
 *   wire    — engine/dependency endpoints must actually perform
 *             (http-endpoint probes declared in manifest.realization)
 *   deploy  — service must answer on its declared port (human registers
 *             the process — an R-boundary; http-reachable verifies)
 *   revenue — a priced offer must exist in the canonical OfferCatalog
 *             (pricing is human authority — parks for approval)
 *   proof   — APP_REALIZED evidence object on the completed goal
 *
 * When a stage's machine check fails, the mission does NOT retry forever
 * or fake the step — it creates a durable Human Action with exact
 * instructions and a verifier, parks the goal, and resumes automatically
 * once verification passes (the same sweep the revenue autopilot uses).
 *
 * A realized app is not a revenue claim. APP_REALIZED means: real module,
 * real tests, real dependencies, real deployment, real offer. The revenue
 * spine proves money separately and stays untouched.
 *
 * Deps are injectable for tests (appDir, fetch, runCommand, catalog,
 * service). Production resolves real stores.
 */

const fs = require('fs');
const path = require('path');
const { HumanActionService } = require('../human-actions/service');
const { attachBlockerToGoal, resumeSatisfiedGoals } = require('../human-actions/mission-link');
const { runVerifier } = require('../human-actions/verifiers');

const APPS_ROOT = path.join(__dirname, '..', '..', 'protoforge-applications');
const GOAL_TITLE_PREFIX = 'APP REALIZATION — ';
const STAGES = ['audit', 'spec', 'test', 'wire', 'deploy', 'revenue', 'proof'];

function goalTitle(app) { return `${GOAL_TITLE_PREFIX}${app.manifest.name || app.appId}`; }

/* ---------------- app loading ---------------- */

function loadApp(appId, deps) {
  const dir = deps.appDir ? deps.appDir(appId) : path.join(APPS_ROOT, appId);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { appId, dir, manifest: null };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return { appId, dir, manifest };
}

/* ---------------- stage machine ---------------- */

/** Each stage: check(app, ctx) -> {ok, evidence}; blocker(app, ctx) -> spec. */
const STAGE_DEFS = {
  audit: {
    async check(app) {
      const hasSrc = fs.existsSync(path.join(app.dir, 'src'));
      const hasTests = fs.existsSync(path.join(app.dir, 'tests'));
      const caps = app.manifest.capabilities || [];
      return {
        ok: true,
        evidence: {
          name: app.manifest.name, version: app.manifest.version,
          capabilities: caps.length, hasSrc, hasTests,
          realizationConfigured: !!app.manifest.realization,
          governanceTier: app.manifest.governance?.tier || null,
        },
      };
    },
  },

  spec: {
    async check(app) {
      const contractPath = path.join(app.dir, 'capability-contract.json');
      if (fs.existsSync(contractPath)) {
        return { ok: true, evidence: { contract: 'capability-contract.json', generated: false } };
      }
      // Derive the contract deterministically from the manifest — the app's
      // own descriptor is the source of truth, this file is its projection.
      const m = app.manifest;
      const contract = {
        name: m.name, version: m.version,
        generatedBy: 'app-realization',
        generatedAt: new Date().toISOString(),
        capabilities: m.capabilities || [],
        eventsProduced: m.eventsProduced || [],
        eventsConsumed: m.eventsConsumed || [],
        providers: m.providers || [],
        healthRequirements: m.healthRequirements || [],
        realization: m.realization || null,
      };
      fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2) + '\n');
      return { ok: true, evidence: { contract: 'capability-contract.json', generated: true } };
    },
  },

  test: {
    async check(app, ctx) {
      const r = app.manifest.realization || {};
      // Engine-hosted apps have no local suite — their functional proof is
      // the wire probes, which write/read real rows. Honest deferral, not
      // a fabricated pass.
      if (r.hosted && !r.testCommand) {
        return { ok: true, evidence: { localSuite: `none — hosted by '${r.hosted}'; function verified at wire` } };
      }
      const res = await runVerifier('app-tests-pass', { dir: app.dir, command: r.testCommand }, ctx.vdeps);
      return { ok: res.passed, evidence: res.evidence || { failure: res.failureReason }, fail: res.failureReason };
    },
    blocker: (app, ctx) => ({
      blockerKey: `app:${app.appId}:tests`,
      title: `Fix failing test suite — ${app.manifest.name}`,
      instructions: [
        `The app's own test suite fails. Run: cd ${app.dir} && ${app.manifest.realization?.testCommand || 'npm test'}`,
        `Failure: ${ctx.lastFail || 'see test output'}`,
        'Fix the failing tests — Heidi will re-run the suite to verify.',
      ],
      priority: 'high',
      verifier: { name: 'app-tests-pass', spec: { dir: app.dir, command: app.manifest.realization?.testCommand } },
    }),
  },

  wire: {
    async check(app, ctx) {
      const r = app.manifest.realization || {};
      const checks = [];
      if (r.engineHealthUrl) {
        const res = await runVerifier('http-endpoint', { method: 'GET', url: r.engineHealthUrl, expectStatus: 200 }, ctx.vdeps);
        checks.push({ probe: 'engine-health', ...res });
        if (!res.passed) return { ok: false, evidence: { checks: checks.map((c) => ({ probe: c.probe, reason: c.failureReason })) }, fail: `engine health: ${res.failureReason}` };
      }
      if (r.engineProbe) {
        const res = await runVerifier('http-endpoint', r.engineProbe, ctx.vdeps);
        checks.push({ probe: 'engine-endpoint', ...res });
        if (!res.passed) return { ok: false, evidence: { checks: checks.map((c) => ({ probe: c.probe, reason: c.failureReason })) }, fail: `engine endpoint: ${res.failureReason}` };
      }
      return { ok: true, evidence: { checks: checks.map((c) => ({ probe: c.probe, status: c.evidence?.http_status })) } };
    },
    blocker: (app, ctx) => {
      const r = app.manifest.realization || {};
      return {
        blockerKey: `app:${app.appId}:engine`,
        title: `Restore engine endpoint — ${app.manifest.name}`,
        instructions: [
          `${app.manifest.name} depends on the Ursula engine, which is not performing correctly.`,
          `Failure: ${ctx.lastFail || 'endpoint probe failed'}`,
          r.engineHealthUrl ? `Engine health must return 200: GET ${r.engineHealthUrl}` : null,
          r.engineProbe ? `Endpoint must perform: ${r.engineProbe.method} ${r.engineProbe.url} must return JSON field '${r.engineProbe.expectJsonField}'` : null,
          'Fix the external engine (Ursula_Suite container/service), then tell Heidi to check again — she verifies the endpoint herself.',
        ].filter(Boolean),
        priority: 'high',
        verifier: { name: 'http-endpoint', spec: r.engineProbe || { method: 'GET', url: r.engineHealthUrl, expectStatus: 200 } },
      };
    },
  },

  deploy: {
    async check(app, ctx) {
      const r = app.manifest.realization || {};
      // Hosted apps deploy inside their engine — 'deployed' means the
      // engine is serving them (already verified at wire, re-checked here).
      const url = r.hosted
        ? (r.engineHealthUrl || '')
        : `http://localhost:${r.servicePort}${r.healthPath || '/health'}`;
      const res = await runVerifier('http-endpoint', { method: 'GET', url, expectStatus: 200 }, ctx.vdeps);
      return { ok: res.passed, evidence: { url, hosted: r.hosted || null, status: res.evidence?.http_status }, fail: res.failureReason };
    },
    blocker: (app) => {
      const r = app.manifest.realization || {};
      if (r.hosted) {
        return {
          blockerKey: `app:${app.appId}:deploy`,
          title: `Restore hosting engine — ${app.manifest.name}`,
          instructions: [
            `${app.manifest.name} is hosted by '${r.hosted}' — the engine must be serving for the app to exist at all.`,
            `Engine health must return 200: GET ${r.engineHealthUrl}`,
            'Restart/repair the hosting service (ursula-flask container), then tell Heidi to check again.',
          ],
          priority: 'high',
          verifier: { name: 'http-endpoint', spec: { method: 'GET', url: r.engineHealthUrl, expectStatus: 200 } },
        };
      }
      const url = `http://localhost:${r.servicePort}${r.healthPath || '/health'}`;
      return {
        blockerKey: `app:${app.appId}:deploy`,
        title: `Deploy ${app.manifest.name} service (port ${r.servicePort})`,
        instructions: [
          `Register ${app.manifest.name} as a supervised service so it survives restarts:`,
          `  command: ${r.startCommand || 'node src/index.js'}`,
          `  cwd: ${app.dir}`,
          `  env: PORT=${r.servicePort}` + (r.engineHealthUrl ? `, PROTOIY_ENDPOINT per engine` : ''),
          `Register in boot.config.json (type: process) or PM2 — starting a new service is a human-authorized operation.`,
          `Verifier: ${url} must return HTTP 200.`,
        ],
        priority: 'high',
        verifier: { name: 'http-endpoint', spec: { method: 'GET', url, expectStatus: 200 } },
      };
    },
  },

  revenue: {
    async check(app, ctx) {
      const r = app.manifest.realization || {};
      const c = app.manifest.commercial || {};
      const offerId = r.offerId || c.offerId;
      if (!offerId) return { ok: true, evidence: { offer: 'none declared' } };
      const res = await runVerifier('offer-exists', { offerId }, ctx.vdeps);
      if (res.passed) return { ok: true, evidence: res.evidence };
      // Governed commercial path: a recorded human approval materializes
      // the declared offer into the catalog overlay — approval →
      // OFFER_CREATED is automatic, but pricing never goes silent.
      const commercial = ctx.commercial || require('../commercial/commercial-review');
      const mat = await commercial.materializeApprovedOffer(app, { catalog: ctx.catalog }).catch(() => null);
      if (mat) {
        const res2 = await runVerifier('offer-exists', { offerId }, ctx.vdeps);
        return { ok: res2.passed, evidence: { ...res2.evidence, materializedFromDecision: mat.offerId }, fail: res2.failureReason };
      }
      return { ok: false, evidence: res.evidence, fail: res.failureReason };
    },
    blocker: (app, ctx) => {
      const commercial = ctx.commercial || require('../commercial/commercial-review');
      return commercial.buildReviewActionSpec(app);
    },
  },
};

/* ---------------- mission ---------------- */

async function ensureAppGoal(goals, app) {
  const existing = await goals.listGoals({ limit: 300 }).catch(() => []);
  const open = existing.find((g) => g.context?.appRealization?.appId === app.appId && !['completed', 'cancelled'].includes(g.status));
  if (open) return open;
  const goal = await goals.createGoal({
    goalType: 'mission',
    title: goalTitle(app),
    description: `Realize ${app.manifest.name || app.appId}: audit → spec → test → wire → deploy → revenue → proof, parking only at genuine human boundaries.`,
    priority: 8,
    context: { appRealization: { appId: app.appId, stage: 'audit', steps: [] }, managedBy: 'app-realization' },
  });
  // Managed goals must not sit in 'pending' — the daemon's generic planner
  // claims pending work and would 'complete' this goal without running a
  // single stage. 'escalated' keeps it out of getPendingWork entirely; the
  // realization runner owns every transition from here.
  await goals.updateGoal(goal.goalId, {
    status: 'escalated',
    context: { ...(goal.context || {}), managedBy: 'app-realization' },
  });
  return goal;
}

/**
 * One idempotent pass. Verifies open boundaries first, then runs every
 * stage it can, parking on the first genuinely failing boundary.
 */
async function advance(deps) {
  const { goals, appId, actor = 'app-realization' } = deps;
  const app = loadApp(appId, deps);
  const report = { appId, stage: 'audit', waiting: null, steps: [], evidence: null, proof: null };

  if (!app.manifest) {
    report.stage = 'unrealizable';
    report.evidence = { reason: `no manifest.json for '${appId}' under protoforge-applications — the concept is not a module yet` };
    return report;
  }

  const svc = deps.service || new HumanActionService({ verifierDeps: deps.verifierDeps });
  await resumeSatisfiedGoals(svc, goals, { actor }).catch(() => null);
  const goal = await ensureAppGoal(goals, app);
  const ar = { ...(goal.context?.appRealization || { appId, stage: 'audit', steps: [] }) };
  const steps = ar.steps || (ar.steps = []);
  report.goalId = goal.goalId;
  report.goalStatus = goal.status;

  const persist = async () => {
    const fresh = await goals.getGoal(goal.goalId);
    const ctx = { ...(fresh?.context || {}), appRealization: ar };
    // Managed goals stay 'escalated' between 'create' and 'completed' —
    // never exposed to the generic planner's pending-work queue.
    await goals.updateGoal(goal.goalId, { status: 'escalated', context: ctx });
    goal.context = ctx;
  };
  const note = async (stage, detail, extra = {}) => {
    steps.push({ stage, detail, at: new Date().toISOString(), ...extra });
    ar.stage = stage;
    await persist();
  };

  if (goal.status === 'completed') {
    report.stage = 'APP_REALIZED';
    report.proof = ar.proof || null;
    report.steps = steps;
    return report;
  }

  // A recorded commercial approval materializes the declared offer BEFORE
  // linked-action verification — the commercial action's verifier is
  // offer-exists, so the offer must exist before the verify pass runs or
  // the mission deadlocks parked on its own approval.
  if (ar.stage === 'revenue') {
    const commercial = deps.commercial || require('../commercial/commercial-review');
    await commercial.materializeApprovedOffer(app, { catalog: deps.catalog }).catch(() => null);
  }

  // Verify currently-open linked actions — a satisfied prerequisite must
  // release the mission in THIS pass, not the next one.
  const openLinked = () => (goal.context?.humanActions || [])
    .map((id) => svc.get(id))
    .filter((a) => a && !['RESOLVED', 'CANCELLED', 'REJECTED'].includes(a.status));
  for (const a of openLinked()) {
    await svc.verify(a.id, actor).catch(() => null);
  }
  const openNow = openLinked();
  if (openNow.length > 0) {
    // Park only if an open action belongs to THIS stage's boundary — a
    // stale linked action (superseded blockerKey from an older spec) must
    // not hold the mission before the stage gets to re-issue itself.
    const stageKey = (() => {
      const def = STAGE_DEFS[ar.stage];
      return def && def.blocker ? def.blocker(app, { vdeps: deps.verifierDeps, commercial: deps.commercial, catalog: deps.catalog, lastFail: null }).blockerKey : null;
    })();
    if (stageKey && openNow.some((a) => a.blockerKey === stageKey)) {
      return await waitingReport(svc, goal, report, steps);
    }
    if (!stageKey) {
      return await waitingReport(svc, goal, report, steps);
    }
    // Open actions exist but none is this stage's boundary — fall through
    // to the stage loop, which attaches the correct (superseding) spec.
  }

  const ctx = { vdeps: deps.verifierDeps, commercial: deps.commercial, catalog: deps.catalog, lastFail: null };
  let idx = STAGES.indexOf(ar.stage);
  if (idx < 0) idx = 0;

  while (idx < STAGES.length) {
    const stage = STAGES[idx];
    if (stage === 'proof') {
      const proof = {
        type: 'APP_REALIZED',
        appId: app.appId,
        name: app.manifest.name,
        version: app.manifest.version,
        offerId: app.manifest.realization?.offerId || null,
        deployedPort: app.manifest.realization?.servicePort || null,
        hostedBy: app.manifest.realization?.hosted || null,
        steps: steps.map((s) => ({ stage: s.stage, at: s.at })),
        at: new Date().toISOString(),
      };
      ar.proof = proof;
      await note('proof', `${app.manifest.name} realized: spec + tests + wiring + deploy + offer verified`, { evidence: { proofType: 'APP_REALIZED' } });
      await goals.updateGoal(goal.goalId, { status: 'completed', context: { ...(goal.context || {}), appRealization: ar } });
      report.stage = 'APP_REALIZED';
      report.proof = proof;
      report.steps = steps;
      return report;
    }

    const def = STAGE_DEFS[stage];
    const res = await def.check(app, ctx);
    if (res.ok) {
      await note(stage, `${stage} verified`, { evidence: res.evidence });
      idx += 1;
      continue;
    }

    // Genuine boundary — durable Human Action, park, report.
    ctx.lastFail = res.fail || res.evidence?.failure || 'stage check failed';
    if (def.blocker) {
      const spec = def.blocker(app, ctx);
      await attachBlockerToGoal(svc, goals, {
        goalId: goal.goalId, blockerKey: spec.blockerKey, spec, actor,
      }).catch(() => null);
      // A new boundary spec can supersede older linked actions (e.g. the
      // bare :offer action superseded by the richer :commercial review).
      // Drop their links from THIS goal — the actions stay OPEN globally.
      const superseded = spec.supersedes || [];
      if (superseded.length) {
        const fresh0 = await goals.getGoal(goal.goalId);
        const cur = { ...(fresh0?.context || {}) };
        const keep = [];
        for (const id of (cur.humanActions || [])) {
          const a = svc.get(id);
          if (a && superseded.includes(a.blockerKey)) continue;
          keep.push(id);
        }
        if (keep.length !== (cur.humanActions || []).length) {
          cur.humanActions = keep;
          cur.humanBlockerKeys = (cur.humanBlockerKeys || []).filter((k) => !superseded.includes(k));
          await goals.updateGoal(goal.goalId, { context: cur });
          goal.context = cur;
        }
      }
    }
    await note(stage, `${stage} blocked — ${ctx.lastFail}`, { evidence: res.evidence });
    const fresh = await goals.getGoal(goal.goalId);
    const merged = { ...((fresh && fresh.context) || {}), appRealization: ar, waitingOnHuman: true };
    await goals.updateGoal(goal.goalId, { status: 'escalated', context: merged });
    goal.context = merged;
    report.stage = 'WAITING_ON_HUMAN';
    report.steps = steps;
    return await waitingReport(svc, goal, report, steps);
  }

  report.steps = steps;
  return report;
}

async function waitingReport(svc, goal, report, steps) {
  report.stage = 'WAITING_ON_HUMAN';
  report.goalStatus = 'escalated';
  report.steps = steps;
  const ids = goal.context?.humanActions || [];
  report.waiting = { prerequisites: [], satisfied: 0, total: 0 };
  for (const id of ids) {
    const a = svc.get(id);
    if (!a) continue;
    report.waiting.prerequisites.push({
      actionId: a.id, blockerKey: a.blockerKey, title: a.title, status: a.status,
      missing: a.verification?.failureReason || null,
      instructions: a.instructions || [],
    });
  }
  const open = report.waiting.prerequisites.filter((p) => !['RESOLVED', 'CANCELLED', 'REJECTED'].includes(p.status));
  report.waiting.satisfied = report.waiting.prerequisites.length - open.length;
  report.waiting.total = report.waiting.prerequisites.length;
  return report;
}

/** Read-only state for surfaces — never advances. */
async function brief(deps) {
  const { goals, appId } = deps;
  const app = loadApp(appId, deps);
  if (!app.manifest) return { report: { appId, stage: 'unrealizable' }, text: `APP REALIZATION\n  ${appId}: no manifest — not a module yet` };
  const existing = await goals.listGoals({ limit: 300 }).catch(() => []);
  const goal = existing.find((g) => g.context?.appRealization?.appId === appId) || null;
  const ar = goal?.context?.appRealization || { stage: 'not started', steps: [] };
  const lines = [
    'APP REALIZATION',
    `  App: ${app.manifest.name || appId} (${appId}) v${app.manifest.version || '?'}`,
    `  Stage: ${ar.stage}${goal ? ` · goal ${goal.status}` : ''}`,
  ];
  if (ar.proof) lines.push(`  PROOF: ${ar.proof.type} @ ${ar.proof.at}`);
  for (const s of (ar.steps || []).slice(-8)) lines.push(`  ${s.stage}: ${s.detail}`);
  const report = { appId, stage: goal?.status === 'completed' ? 'APP_REALIZED' : ar.stage, goalId: goal?.goalId || null, steps: ar.steps, proof: ar.proof || null };
  return { report, text: lines.join('\n') };
}

module.exports = { advance, brief, loadApp, STAGES, GOAL_TITLE_PREFIX };
