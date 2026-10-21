'use strict';

/**
 * Heidi's answer to phone "REQUEST @Heidi: …" posts on Forge Board #ops.
 *
 * The request text is data. It is matched against fixed patterns and never
 * reaches a shell: read-only requests run one allow-listed probe with fixed
 * argv, everything else becomes an execution-fabric approval (fabric:control)
 * that nothing runs until a human approves it, and anything unrecognised gets
 * one clarifying question. Only senders in HEIDI_OPS_REQUEST_SENDERS (default
 * Jordan and hydi-daemon) are served; anyone else gets a one-line refusal.
 * Each request is handled at most once; handled ids and the assessment
 * crew's last run survive restarts in .runtime/heidi-ops-responder.json.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const CHANNEL = 'ops';
const SENDER = 'Heidi';
const REQUEST_RE = /^\s*REQUEST\s+@Heidi\s*:\s*([\s\S]+)$/i;
const SERVICE_NAME = 'heidi-ops-responder';
const MAX_REPLY = 3800;
const REPLY_LIMIT = 4;
const REPLY_WINDOW_MS = 60 * 1000;
const FIRST_BOOT_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const MAX_TRACKED = 1000;
const WAITING = 'waiting for Jordan';
const DEFAULT_REQUEST_SENDERS = 'Jordan,hydi-daemon';
const REFUSAL = 'requests must come from Jordan';
const ASSESSMENT_COOLDOWN_MS = 60 * 60 * 1000;
const SECRET_ALERT = "Heidi can't file approvals: HYDI_SERVICE_SECRET not set on Frank.";

// Anything that changes state, spends, or talks to people is never a read,
// even when a read word also appears ("restart then check health").
const APPROVAL_RE = /\b(restart|reboot|redeploy|deploy|release|scale|spend|pay|payout|refund|charge|buy|purchase|invoice|email|e-mail|message|text|sms|notify|contact|customer|customers|outreach|send|post|publish|delete|remove|drop|wipe|install|uninstall|upgrade|update|change|edit|modify|fix|patch|merge|push|commit|revert|rollback|roll back|migrate|migration|rotate|kill|stop|start|enable|disable|grow|campaign|allocation|sweep|evolution|round|launch|execute|approve)\b/i;

const READS = [
  { kind: 'assessment', re: /\b(assessment|assess|crew)\b/i },
  { kind: 'revenue', re: /\b(revenue|mrr|income|sales|earnings)\b/i },
  { kind: 'git', re: /\bgit\b|\b(commits?|branch|repo status)\b/i },
  { kind: 'disk', re: /\b(disk|storage|free space|drive space|space left)\b/i },
  { kind: 'health', re: /\b(health|healthy|probe|probes|alive|ping)\b/i },
  { kind: 'fleet', re: /\b(fleet|pm2|process(es)?|services?|status)\b/i },
];

const CLARIFY = 'Which one do you want: fleet/PM2 status, health probes, disk space, git status, the assessment crew, or the live revenue summary? Anything else needs an approval — say what should change.';

function parseRequest(message, sender = SENDER) {
  if (!message || typeof message !== 'object' || !message.id) return null;
  if (message.channel && message.channel !== CHANNEL) return null;
  if (message.sender === sender) return null;
  if (message.reply_to) return null;
  const match = REQUEST_RE.exec(String(message.body || ''));
  if (!match) return null;
  const text = match[1].trim().replace(/\s+/g, ' ').slice(0, 500);
  return text ? { id: message.id, text, sender: message.sender, ts: message.ts } : null;
}

function allowedSenders(raw) {
  const list = String(raw == null || raw === '' ? DEFAULT_REQUEST_SENDERS : raw)
    .split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
  return new Set(list);
}

function triage(text) {
  const t = String(text || '');
  if (APPROVAL_RE.test(t)) return { kind: 'approval' };
  if (/\b(delegate|delegation|assign|hand off)\b/i.test(t)) {
    const domains = [];
    if (/\b(revenue|billing|income|sales|earnings)\b/i.test(t)) domains.push('revenue');
    if (/\b(infrastructure|infra|fleet|pm2|systems?|reliability)\b/i.test(t)) domains.push('infrastructure');
    if (domains.length) return { kind: 'delegation', domains };
  }
  for (const read of READS) if (read.re.test(t)) return { kind: 'read', tool: read.kind };
  return { kind: 'unclear' };
}

function clip(text, max = MAX_REPLY) {
  const s = String(text == null ? '' : text);
  return s.length > max ? `${s.slice(0, max - 15)}\n…(truncated)` : s;
}

function execText(execImpl, file, args, opts) {
  return new Promise((resolve) => {
    execImpl(file, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...opts }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || ''), error: error ? (error.message || 'failed') : null });
    });
  });
}

function pm2Command(platform) {
  return platform === 'win32' ? { file: 'cmd.exe', args: ['/c', 'pm2', 'jlist'] } : { file: 'pm2', args: ['jlist'] };
}

function formatUptime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function buildReadTools(deps) {
  const root = deps.repoRoot;
  const execImpl = deps.execFile;
  const now = deps.now;
  return {
    async fleet() {
      const cmd = pm2Command(deps.platform);
      const out = await execText(execImpl, cmd.file, cmd.args, { cwd: root, timeout: 20_000 });
      let list;
      try { list = JSON.parse(out.stdout.slice(out.stdout.indexOf('['))); } catch { list = null; }
      if (!Array.isArray(list)) return `PM2: unreadable (${out.error || 'pm2 jlist returned no JSON'}).`;
      const lines = list.map((p) => {
        const env = p.pm2_env || {};
        const up = env.status === 'online' && env.pm_uptime ? formatUptime(now() - env.pm_uptime) : '-';
        return `  ${p.name}: ${env.status || 'unknown'} (restarts ${env.restart_time ?? '?'}, up ${up})`;
      });
      const online = list.filter((p) => (p.pm2_env || {}).status === 'online').length;
      return [`PM2: ${online}/${list.length} online`, ...lines].join('\n');
    },
    async health() {
      const result = await deps.runHealthCheck({});
      const probes = result && Array.isArray(result.probes) ? result.probes : [];
      const lines = probes.map((p) => `  ${p.name}: ${p.ok ? 'up' : 'down'}, ${p.hint || '?'}${Number.isFinite(p.ms) ? ` (${p.ms}ms)` : ''}`);
      return [`Health: ${result && result.ok ? 'all probes ok' : 'not all probes ok'}`, ...lines].join('\n');
    },
    async disk() {
      const stat = await deps.statfs(root);
      const gb = (n) => (n / 1024 ** 3).toFixed(1);
      const total = stat.blocks * stat.bsize;
      const free = stat.bavail * stat.bsize;
      return `Disk (${root}): ${gb(free)} GB free of ${gb(total)} GB (${total ? Math.round((free / total) * 100) : 0}% free).`;
    },
    async git() {
      const status = await execText(execImpl, 'git', ['status', '--short', '--branch'], { cwd: root, timeout: 10_000 });
      const log = await execText(execImpl, 'git', ['log', '--oneline', '-5'], { cwd: root, timeout: 10_000 });
      const statusLines = status.stdout.trim().split('\n').filter(Boolean);
      const shown = statusLines.slice(0, 15);
      if (statusLines.length > shown.length) shown.push(`  …${statusLines.length - shown.length} more`);
      return [
        'git status:',
        status.ok ? shown.join('\n') : `  unreadable (${status.error})`,
        'git log -5:',
        log.ok ? log.stdout.trim() : `  unreadable (${log.error})`,
      ].join('\n');
    },
    async assessment() {
      const script = path.join(root, 'scripts', 'heidi-assessment-crew.js');
      const out = await execText(execImpl, deps.nodePath, [script, '--channel=ops'], { cwd: root, timeout: 240_000 });
      const lines = `${out.stdout}\n${out.stderr}`.split('\n');
      const rootLine = lines.find((l) => l.startsWith('thread root:'));
      const counts = lines.filter((l) => /: \d+ findings, \d+ recs$/.test(l));
      if (!out.ok) return `Assessment crew failed: ${clip(out.error, 300)}`;
      return [
        `Assessment crew ran.${rootLine ? ` Report thread ${rootLine.replace('thread root:', '').trim()} on #ops.` : ''}`,
        ...counts.map((l) => `  ${l}`),
      ].join('\n');
    },
    async revenue() {
      const { liveRevenueSummary, formatLiveSummary } = require('../billing/live-summary');
      const store = deps.billingStore();
      return formatLiveSummary(await liveRevenueSummary(store, { now: () => new Date(now()) }));
    },
    async delegate(domains) {
      const { runBoardDelegation } = require('./board-delegation');
      const result = await runBoardDelegation({
        domains,
        board: deps.board,
        repoRoot: root,
        platform: deps.platform,
        now: () => new Date(now()),
      });
      if (!result.ok) throw new Error(result.error || 'delegation failed');
      return `Delegated ${result.domains.join(' + ')} evidence and proposal review. Board thread ${result.thread_id}. No approval or execution occurred; waiting for Jordan to request any action.`;
    },
  };
}

function signServiceToken(secret, ts, requestId) {
  const sig = crypto.createHmac('sha256', secret).update(`${ts}:${requestId}:${SERVICE_NAME}`).digest('hex');
  return `${ts}.${requestId}.${SERVICE_NAME}.${sig}`;
}

function buildFabricClient(deps) {
  const base = String(deps.apiBase).replace(/\/+$/, '');
  const headers = () => {
    const secret = deps.serviceSecret();
    if (!secret) return null;
    return {
      'Content-Type': 'application/json',
      'x-hydi-service-token': signServiceToken(secret, String(deps.now()), crypto.randomUUID()),
    };
  };
  return {
    async file(request) {
      const h = headers();
      if (!h) return { ok: false, error: 'HYDI_SERVICE_SECRET is not set on this host' };
      try {
        const res = await deps.fetch(`${base}/api/mobile-ops/fabric`, {
          method: 'POST',
          headers: { ...h, 'x-idempotency-key': `board:${request.id}`.slice(0, 128) },
          body: JSON.stringify({
            capability: 'board.request',
            args: { board_message_id: request.id, request: request.text },
            confirm: false,
            objective: request.text,
          }),
        });
        const body = await res.json().catch(() => null);
        const task = body && body.task;
        if (task && task.id && task.state === 'AWAITING_APPROVAL') return { ok: true, task };
        return { ok: false, error: (body && (body.error || body.message)) || `fabric returned ${res.status}` };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'fabric unreachable' };
      }
    },
    async get(taskId) {
      const h = headers();
      if (!h) return { ok: false, status: 0, error: 'HYDI_SERVICE_SECRET is not set on this host' };
      try {
        const res = await deps.fetch(`${base}/api/mobile-ops/fabric?task_id=${encodeURIComponent(taskId)}`, { method: 'GET', headers: h });
        const body = await res.json().catch(() => null);
        if (res.status === 404) return { ok: false, status: 404, error: 'not_found' };
        if (!res.ok || !body || !body.task) return { ok: false, status: res.status, error: (body && body.error) || `fabric returned ${res.status}` };
        return { ok: true, task: body.task, detail: body.detail || {} };
      } catch (error) {
        return { ok: false, status: 0, error: error instanceof Error ? error.message : 'fabric unreachable' };
      }
    },
  };
}

/**
 * Turn a fabric task into the thread outcome, or null while it is still
 * pending. "Approved" is only ever posted together with the recorded result.
 */
function outcomeText(task, detail = {}, nowMs = Date.now()) {
  if (!task) return null;
  const expiresAt = detail.authorization && detail.authorization.expires_at;
  if (task.state === 'AWAITING_APPROVAL') {
    if (expiresAt && Date.parse(expiresAt) <= nowMs) return `Approval ${task.id} expired without a decision. Nothing was run.`;
    return null;
  }
  if (task.state === 'NEEDS_HUMAN') return `Approval ${task.id} expired without a decision. Nothing was run.`;
  if (task.state === 'CANCELLED') return `Approval ${task.id} was rejected. Nothing was run.`;
  if (task.state === 'FAILED') {
    const err = (detail.errors || []).map((e) => e && (e.message || e.code)).filter(Boolean).pop();
    return `Approval ${task.id} was approved but failed: ${err || 'no error recorded'}.`;
  }
  if (task.state === 'COMPLETED') {
    const outcome = task.outcome || {};
    const run = outcome.result && typeof outcome.result === 'object' ? outcome.result : null;
    const result = run && run.result && typeof run.result === 'object' ? run.result : null;
    if (outcome.ok !== true || !result || !result.note) {
      return `Approval ${task.id} was approved, but no result was recorded, so it is not reported as done.`;
    }
    return `Approval ${task.id} was approved. Result: ${result.note}`;
  }
  return null;
}

function emptyState() {
  return { version: 1, handled: {} };
}

function loadState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed.handled === 'object') return { state: parsed, existed: true };
  } catch { /* missing or unreadable → first boot */ }
  return { state: emptyState(), existed: false };
}

function saveState(file, state) {
  const ids = Object.keys(state.handled);
  if (ids.length > MAX_TRACKED) {
    ids.sort((a, b) => String(state.handled[a].at).localeCompare(String(state.handled[b].at)));
    for (const id of ids.slice(0, ids.length - MAX_TRACKED)) {
      if (!state.handled[id].task_id || state.handled[id].outcome_posted) delete state.handled[id];
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

function defaultDeps(overrides = {}) {
  const root = overrides.repoRoot || path.resolve(__dirname, '..', '..');
  return {
    repoRoot: root,
    stateFile: path.join(root, '.runtime', 'heidi-ops-responder.json'),
    now: () => Date.now(),
    platform: process.platform,
    nodePath: process.execPath,
    execFile,
    statfs: (p) => fs.promises.statfs(p),
    runHealthCheck: (ctx) => require('../mobile-ops/action-runners').runHealthCheck(ctx),
    billingStore: () => require('../billing/http').getBillingService().store,
    fetch: (...args) => globalThis.fetch(...args),
    apiBase: process.env.HYDI_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`,
    serviceSecret: () => process.env.HYDI_SERVICE_SECRET || '',
    requestSenders: process.env.HEIDI_OPS_REQUEST_SENDERS,
    warn: (text) => console.warn(text),
    board: require('../forge-board/sdk'),
    ...overrides,
  };
}

function createOpsResponder(overrides = {}) {
  const deps = defaultDeps(overrides);
  const sender = deps.sender || SENDER;
  const tools = deps.tools || buildReadTools(deps);
  const fabric = deps.fabric || buildFabricClient(deps);
  const loaded = loadState(deps.stateFile);
  const state = loaded.state;
  let firstPass = !loaded.existed;
  let secretChecked = false;
  const senders = allowedSenders(deps.requestSenders);
  const sent = [];
  let busy = false;

  const iso = (ms) => new Date(ms).toISOString();

  function canReply() {
    const t = deps.now();
    while (sent.length && t - sent[0] > REPLY_WINDOW_MS) sent.shift();
    return sent.length < REPLY_LIMIT;
  }

  async function reply(requestId, body) {
    const result = await deps.board.post(CHANNEL, clip(body), requestId);
    sent.push(deps.now());
    return Boolean(result && result.ok !== false && result.status !== 429);
  }

  function persist() {
    try { saveState(deps.stateFile, state); } catch (error) {
      console.error('[ops-responder] state not saved:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async function answerRead(request, tool) {
    const started = deps.now();
    let output;
    try {
      output = await tools[tool]();
    } catch (error) {
      output = `${tool} could not be read: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
    const finished = deps.now();
    return `${clip(output, MAX_REPLY - 200)}\nRead-only ${tool}. Started ${iso(started)}, finished ${iso(finished)}.`;
  }

  // Presence only: the secret's value is never read into a message.
  async function checkServiceSecret() {
    if (secretChecked) return;
    secretChecked = true;
    if (deps.serviceSecret()) {
      if (state.secret_alert_at) {
        delete state.secret_alert_at;
        persist();
      }
      return;
    }
    deps.warn(`[ops-responder] ${SECRET_ALERT} Approval requests will be refused until it is set.`);
    if (state.secret_alert_at) return;
    const result = await deps.board.post('alerts', SECRET_ALERT);
    if (result && result.ok !== false && result.status !== 429) {
      state.secret_alert_at = iso(deps.now());
      persist();
    }
  }

  async function answerAssessment(request) {
    const last = state.assessment && Date.parse(state.assessment.last_run_at);
    if (Number.isFinite(last) && deps.now() - last < ASSESSMENT_COOLDOWN_MS) {
      return `Assessment ran at ${iso(last)}; next allowed after ${iso(last + ASSESSMENT_COOLDOWN_MS)}. Latest report: thread ${state.assessment.thread_id || 'unknown'}.`;
    }
    state.assessment = { last_run_at: iso(deps.now()), thread_id: null };
    persist();
    const body = await answerRead(request, 'assessment');
    const thread = /Report thread (\S+) on #ops/.exec(body);
    state.assessment.thread_id = thread ? thread[1] : null;
    return body;
  }

  async function handle(request) {
    if (!senders.has(String(request.sender || '').toLowerCase())) {
      if (!(await reply(request.id, REFUSAL))) return false;
      state.handled[request.id] = { at: iso(deps.now()), kind: 'refused', sender: String(request.sender || '').slice(0, 64) };
      return true;
    }
    const decision = triage(request.text);
    if (decision.kind === 'delegation') {
      const started = deps.now();
      let body;
      try {
        body = await tools.delegate(decision.domains);
      } catch (error) {
        body = `Delegation failed: ${error instanceof Error ? error.message : 'Unknown error'}. Nothing was approved or executed.`;
      }
      body += `\nStarted ${iso(started)}, finished ${iso(deps.now())}.`;
      if (!(await reply(request.id, body))) return false;
      state.handled[request.id] = {
        at: iso(deps.now()),
        kind: 'delegation',
        domains: decision.domains,
      };
      return true;
    }
    if (decision.kind === 'read') {
      const body = decision.tool === 'assessment' ? await answerAssessment(request) : await answerRead(request, decision.tool);
      if (!(await reply(request.id, body))) return false;
      state.handled[request.id] = { at: iso(deps.now()), kind: 'read', tool: decision.tool };
      return true;
    }
    if (decision.kind === 'unclear') {
      if (!(await reply(request.id, CLARIFY))) return false;
      state.handled[request.id] = { at: iso(deps.now()), kind: 'unclear' };
      return true;
    }
    const filed = await fabric.file(request);
    const body = filed.ok
      ? `Approval filed: ${filed.task.id} (execution-fabric, needs fabric:control). Not run — ${WAITING}.`
      : `Could not file an approval: ${clip(filed.error, 200)}. Nothing was run.`;
    if (!(await reply(request.id, body))) return false;
    state.handled[request.id] = filed.ok
      ? { at: iso(deps.now()), kind: 'approval', task_id: filed.task.id, outcome_posted: false }
      : { at: iso(deps.now()), kind: 'approval_failed' };
    return true;
  }

  async function checkOutcomes() {
    for (const [requestId, entry] of Object.entries(state.handled)) {
      if (entry.kind !== 'approval' || entry.outcome_posted) continue;
      if (!canReply()) return;
      const got = await fabric.get(entry.task_id);
      let text = null;
      if (got.ok) text = outcomeText(got.task, got.detail, deps.now());
      else if (got.status === 404) text = `Approval ${entry.task_id} is no longer in the fabric queue (heidi-web may have restarted). Nothing was run.`;
      if (!text) continue;
      if (await reply(requestId, text)) {
        entry.outcome_posted = true;
        entry.outcome_at = iso(deps.now());
        persist();
      }
    }
  }

  function alreadyAnswered(all, requestId) {
    return all.some((m) => m && m.sender === sender && (m.reply_to === requestId));
  }

  /** One pass over the #ops messages. Returns the ids replied to this pass. */
  async function tick(all) {
    if (busy) return [];
    busy = true;
    const done = [];
    try {
      await checkServiceSecret();
      const messages = (Array.isArray(all) ? all : []).filter((m) => m && (!m.channel || m.channel === CHANNEL));
      const requests = messages.map((m) => parseRequest(m, sender)).filter(Boolean)
        .sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
      if (firstPass) {
        const cutoff = deps.now() - FIRST_BOOT_LOOKBACK_MS;
        for (const r of requests) {
          const old = r.ts && Date.parse(r.ts) < cutoff;
          if (old || alreadyAnswered(messages, r.id)) state.handled[r.id] = { at: iso(deps.now()), kind: 'baseline' };
        }
        firstPass = false;
        persist();
      }
      for (const request of requests) {
        if (state.handled[request.id]) continue;
        if (!canReply()) break;
        if (await handle(request)) {
          done.push(request.id);
          persist();
        }
      }
      await checkOutcomes();
    } finally {
      busy = false;
    }
    return done;
  }

  return {
    tick,
    handles: (message) => Boolean(parseRequest(message, sender)),
    state: () => state,
  };
}

module.exports = {
  createOpsResponder,
  parseRequest,
  triage,
  outcomeText,
  signServiceToken,
  pm2Command,
  allowedSenders,
  CLARIFY,
  REFUSAL,
  SECRET_ALERT,
  REPLY_LIMIT,
  ASSESSMENT_COOLDOWN_MS,
};
