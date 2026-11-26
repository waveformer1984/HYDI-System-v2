'use strict';

/**
 * Heidi Lifeline — tailnet-only ops surface when heidi-web (:3000) is down.
 * Binds loopback; reach the phone via `tailscale serve` (never funnel).
 * CommonJS, zero npm deps, Windows + PM2.
 */

const http = require('http');
const { execFile } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const VERSION = '1.0.0';
const ALLOWED_APPS = Object.freeze(['heidi-web-standalone', 'heidi-core', 'ursula-local']);
const PROBE_PORTS = Object.freeze([3000, 3459, 3100, 11434]);
const DEFAULT_LOGINS = 'waveformer1984@gmail.com';
const RESTART_APP_COOLDOWN_MS = 2 * 60 * 1000;
const RESTART_HOURLY_MAX = 6;
const RESTART_HOURLY_MS = 60 * 60 * 1000;
const PM2_JLIST_TIMEOUT_MS = 20_000;
const TCP_PROBE_TIMEOUT_MS = 2000;

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function parseAllowedLogins(raw) {
  const src = typeof raw === 'string' && raw.trim() ? raw : DEFAULT_LOGINS;
  return src.split(',').map((s) => s.trim()).filter(Boolean);
}

function pm2JlistCommand(platform) {
  return platform === 'win32'
    ? { file: 'cmd.exe', args: ['/c', 'pm2', 'jlist'] }
    : { file: 'pm2', args: ['jlist'] };
}

function pm2RestartCommand(platform, appName) {
  if (platform === 'win32') {
    return { file: 'cmd.exe', args: ['/c', 'pm2', 'restart', appName, '--update-env'] };
  }
  return { file: 'pm2', args: ['restart', appName, '--update-env'] };
}

function isAllowedApp(name) {
  return typeof name === 'string' && ALLOWED_APPS.includes(name);
}

function execText(execImpl, file, args, opts) {
  return new Promise((resolve) => {
    execImpl(file, args, opts, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: error ? (error.message || 'failed') : null,
      });
    });
  });
}

async function readPm2List(deps) {
  const cmd = pm2JlistCommand(deps.platform);
  const out = await execText(
    deps.execFile,
    cmd.file,
    cmd.args,
    { cwd: deps.repoRoot, timeout: PM2_JLIST_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );
  if (!out.ok) return { ok: false, apps: [], error: out.error || 'pm2 jlist failed' };
  let list;
  try {
    const start = out.stdout.indexOf('[');
    list = start >= 0 ? JSON.parse(out.stdout.slice(start)) : null;
  } catch {
    list = null;
  }
  if (!Array.isArray(list)) return { ok: false, apps: [], error: 'pm2 jlist returned no JSON array' };
  const now = deps.now();
  const apps = list.map((p) => {
    const env = p.pm2_env || {};
    const mon = p.monit || {};
    const status = env.status || 'unknown';
    let uptime_s = null;
    if (status === 'online' && Number.isFinite(env.pm_uptime)) {
      uptime_s = Math.max(0, Math.floor((now - env.pm_uptime) / 1000));
    }
    const memory_mb = Number.isFinite(mon.memory) ? Math.round(mon.memory / (1024 * 1024)) : null;
    return {
      name: p.name || 'unknown',
      status,
      restarts: env.restart_time ?? null,
      uptime_s,
      memory_mb,
    };
  });
  return { ok: true, apps, error: null };
}

function tcpProbe(port, deps) {
  const host = '127.0.0.1';
  const connect = deps.tcpConnect || net.connect;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (state) => {
      if (settled) return;
      settled = true;
      resolve(state);
    };
    const socket = connect({ port, host });
    const timer = setTimeout(() => {
      socket.destroy();
      finish('down');
    }, TCP_PROBE_TIMEOUT_MS);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      finish('up');
    });
    socket.on('error', () => {
      clearTimeout(timer);
      finish('down');
    });
  });
}

async function probePorts(deps) {
  const ports = {};
  for (const port of PROBE_PORTS) {
    ports[String(port)] = await tcpProbe(port, deps);
  }
  return ports;
}

function defaultState() {
  return { restarts: {}, hourly: [] };
}

function loadState(statePath, readFile = fs.readFileSync) {
  try {
    const raw = readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultState();
    return {
      restarts: parsed.restarts && typeof parsed.restarts === 'object' ? parsed.restarts : {},
      hourly: Array.isArray(parsed.hourly) ? parsed.hourly : [],
    };
  } catch {
    return defaultState();
  }
}

function saveState(statePath, state, writeFile = fs.writeFileSync, mkdirSync = fs.mkdirSync) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.${process.pid}.tmp`;
  writeFile(tmp, `${JSON.stringify(state)}\n`, 'utf8');
  fs.renameSync(tmp, statePath);
}

function pruneTimestamps(list, now, windowMs) {
  return list.filter((t) => Number.isFinite(t) && now - t < windowMs);
}

function rateLimitCheck(state, app, now) {
  const appTimes = pruneTimestamps(state.restarts[app] || [], now, RESTART_APP_COOLDOWN_MS);
  if (appTimes.length > 0) {
    const wait_s = Math.ceil((RESTART_APP_COOLDOWN_MS - (now - appTimes[appTimes.length - 1])) / 1000);
    return { allowed: false, wait_s: Math.max(1, wait_s), reason: 'app_cooldown' };
  }
  const hourly = pruneTimestamps(state.hourly || [], now, RESTART_HOURLY_MS);
  if (hourly.length >= RESTART_HOURLY_MAX) {
    const oldest = hourly[0];
    const wait_s = Math.ceil((RESTART_HOURLY_MS - (now - oldest)) / 1000);
    return { allowed: false, wait_s: Math.max(1, wait_s), reason: 'hourly_cap' };
  }
  return { allowed: true, wait_s: 0, reason: null };
}

function recordRestart(state, app, now) {
  const next = { ...state, restarts: { ...state.restarts } };
  const appTimes = pruneTimestamps(next.restarts[app] || [], now, RESTART_APP_COOLDOWN_MS);
  appTimes.push(now);
  next.restarts[app] = appTimes;
  next.hourly = pruneTimestamps(next.hourly || [], now, RESTART_HOURLY_MS);
  next.hourly.push(now);
  return next;
}

function auditAppend(auditPath, fields, appendFile = fs.appendFileSync, mkdirSync = fs.mkdirSync) {
  mkdirSync(path.dirname(auditPath), { recursive: true });
  const line = [fields.ts, fields.login, fields.method, fields.path, fields.result].join('\t') + '\n';
  appendFile(auditPath, line, 'utf8');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtmlPage() {
  const appsJson = JSON.stringify(ALLOWED_APPS);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Heidi Lifeline</title>
<style>
  :root { color-scheme: dark; --bg: #0d1117; --card: #161b22; --text: #e6edf3; --muted: #8b949e; --ok: #3fb950; --bad: #f85149; --warn: #d29922; --accent: #58a6ff; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 16px; line-height: 1.4; }
  h1 { font-size: 1.35rem; margin: 0 0 8px; }
  .sub { color: var(--muted); font-size: 0.9rem; margin-bottom: 16px; }
  .grid { display: grid; gap: 12px; }
  .card { background: var(--card); border: 1px solid #30363d; border-radius: 12px; padding: 14px; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
  .pill { padding: 4px 10px; border-radius: 999px; font-size: 0.85rem; font-weight: 600; }
  .pill.up, .pill.online { background: #23863633; color: var(--ok); }
  .pill.down, .pill.stopped, .pill.errored { background: #da363333; color: var(--bad); }
  .pill.other { background: #6e768133; color: var(--muted); }
  button { min-height: 48px; min-width: 120px; font-size: 1rem; border-radius: 10px; border: 1px solid #30363d; background: #21262d; color: var(--text); padding: 10px 16px; touch-action: manipulation; }
  button.primary { background: var(--accent); color: #0d1117; border-color: transparent; font-weight: 600; }
  button:disabled { opacity: 0.5; }
  #msg { margin-top: 12px; min-height: 1.2em; }
  .ports { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .port { font-size: 0.85rem; padding: 4px 8px; border-radius: 8px; background: #21262d; }
</style>
</head>
<body>
  <h1>Heidi Lifeline</h1>
  <p class="sub">Frank process control when the main app is down. Status refreshes every 15s.</p>
  <div id="cards" class="grid"></div>
  <p id="msg" class="sub" aria-live="polite"></p>
<script>
(function () {
  var ALLOWED = ${appsJson};
  var cards = document.getElementById('cards');
  var msg = document.getElementById('msg');

  function pillClass(status) {
    if (status === 'up' || status === 'online') return 'up';
    if (status === 'down' || status === 'stopped' || status === 'errored') return 'down';
    return 'other';
  }

  function render(data) {
    var html = '';
    var apps = (data && data.apps) || [];
    var ports = (data && data.ports) || {};
  ALLOWED.forEach(function (name) {
      var row = apps.find(function (a) { return a.name === name; }) || { name: name, status: 'unknown' };
      html += '<div class="card"><div class="row"><div><strong>' + name + '</strong><br><span class="sub">PM2: <span class="pill ' + pillClass(row.status) + '">' + row.status + '</span></span></div>';
      html += '<button type="button" class="primary" data-app="' + name + '">Restart</button></div></div>';
    });
    html += '<div class="card"><strong>Ports</strong><div class="ports">';
    Object.keys(ports).sort().forEach(function (p) {
      html += '<span class="port">:' + p + ' <span class="pill ' + pillClass(ports[p]) + '">' + ports[p] + '</span></span>';
    });
    html += '</div></div>';
    cards.innerHTML = html;
    cards.querySelectorAll('button[data-app]').forEach(function (btn) {
      btn.onclick = function () {
        var app = btn.getAttribute('data-app');
        if (!confirm('Restart ' + app + '?')) return;
        msg.textContent = 'Restarting ' + app + '…';
        fetch('/lifeline/restart/' + encodeURIComponent(app), {
          method: 'POST',
          headers: { 'X-Lifeline': '1', 'Accept': 'application/json' },
        }).then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
          .then(function (res) {
            if (res.status === 200 && res.body && res.body.ok) {
              msg.textContent = res.body.message || 'Restart queued.';
              setTimeout(refresh, 20000);
            } else if (res.status === 429) {
              msg.textContent = 'Rate limited — wait ' + (res.body && res.body.wait_s ? res.body.wait_s : '?') + 's.';
            } else {
              msg.textContent = (res.body && res.body.message) || 'Restart failed.';
            }
          })
          .catch(function () { msg.textContent = 'Network error calling restart.'; });
      };
    });
  }

  function refresh() {
    fetch('/lifeline/status', { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () { msg.textContent = 'Could not load status.'; });
  }

  refresh();
  setInterval(refresh, 15000);
})();
</script>
</body>
</html>`;
}

function resolveLogin(req, allowedLogins) {
  const login = req.headers['tailscale-user-login'];
  if (typeof login !== 'string' || !login.trim()) return null;
  const trimmed = login.trim();
  return allowedLogins.includes(trimmed) ? trimmed : null;
}

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function createDefaultDeps(overrides = {}) {
  const repoRoot = overrides.repoRoot || REPO_ROOT;
  return {
    platform: overrides.platform || process.platform,
    execFile: overrides.execFile || execFile,
    repoRoot,
    now: overrides.now || (() => Date.now()),
    allowedLogins: overrides.allowedLogins || parseAllowedLogins(process.env.LIFELINE_ALLOWED_LOGINS),
    statePath: overrides.statePath || path.join(repoRoot, '.runtime', 'lifeline-state.json'),
    auditPath: overrides.auditPath || path.join(repoRoot, 'logs', 'lifeline-audit.log'),
    tcpConnect: overrides.tcpConnect,
    readFile: overrides.readFile,
    writeFile: overrides.writeFile,
    appendFile: overrides.appendFile,
    mkdirSync: overrides.mkdirSync,
  };
}

function createLifelineHandler(depsIn = {}) {
  const deps = createDefaultDeps(depsIn);

  return async function handleRequest(req, res) {
    const login = resolveLogin(req, deps.allowedLogins);
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    const audit = (result) => {
      try {
        auditAppend(
          deps.auditPath,
          {
            ts: new Date(deps.now()).toISOString(),
            login: login || '-',
            method,
            path: pathname,
            result,
          },
          deps.appendFile || fs.appendFileSync,
          deps.mkdirSync || fs.mkdirSync,
        );
      } catch {
        /* audit must never break the handler */
      }
    };

    if (!login) {
      audit('forbidden');
      return jsonResponse(res, 403, { ok: false, message: 'Tailscale identity required.' });
    }

    try {
      if (method === 'GET' && pathname === '/health') {
        const pm2 = await readPm2List(deps);
        audit(pm2.ok ? 'ok' : 'degraded');
        return jsonResponse(res, 200, {
          service: 'lifeline',
          ok: pm2.ok,
          version: VERSION,
          deps: { pm2: pm2.ok },
        });
      }

      if (method === 'GET' && pathname === '/lifeline/status') {
        const [pm2, ports] = await Promise.all([readPm2List(deps), probePorts(deps)]);
        audit('ok');
        return jsonResponse(res, 200, {
          ts: deps.now(),
          apps: pm2.apps,
          ports,
          pm2_ok: pm2.ok,
        });
      }

      if (method === 'GET' && (pathname === '/lifeline' || pathname === '/lifeline/')) {
        audit('ok');
        res.statusCode = 200;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(buildHtmlPage());
        return;
      }

      if (method === 'POST' && pathname.startsWith('/lifeline/restart/')) {
        const app = decodeURIComponent(pathname.slice('/lifeline/restart/'.length));
        if (!isAllowedApp(app)) {
          audit('reject_app');
          return jsonResponse(res, 400, { ok: false, message: 'App not in restart allowlist.' });
        }
        const lifelineHeader = req.headers['x-lifeline'];
        if (lifelineHeader !== '1') {
          audit('missing_x_lifeline');
          return jsonResponse(res, 403, { ok: false, message: 'X-Lifeline: 1 header required.' });
        }

        const readFile = deps.readFile || fs.readFileSync;
        const writeFile = deps.writeFile || fs.writeFileSync;
        let state = loadState(deps.statePath, readFile);
        const now = deps.now();
        const limit = rateLimitCheck(state, app, now);
        if (!limit.allowed) {
          audit('rate_limited');
          return jsonResponse(res, 429, { ok: false, wait_s: limit.wait_s, message: `Rate limited (${limit.reason}).` });
        }

        const cmd = pm2RestartCommand(deps.platform, app);
        const out = await execText(deps.execFile, cmd.file, cmd.args, {
          cwd: deps.repoRoot,
          timeout: PM2_JLIST_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
        });

        if (!out.ok) {
          audit('pm2_failed');
          return jsonResponse(res, 502, { ok: false, message: 'PM2 restart failed.', detail: (out.error || '').slice(0, 200) });
        }

        state = recordRestart(state, app, now);
        saveState(deps.statePath, state, writeFile, deps.mkdirSync || fs.mkdirSync);
        audit('restarted');
        return jsonResponse(res, 200, { ok: true, message: `Restarted ${app}.`, app });
      }

      audit('not_found');
      return jsonResponse(res, 404, { ok: false, message: 'Not found.' });
    } catch (err) {
      audit('error');
      const message = err instanceof Error ? err.message : 'Internal error';
      return jsonResponse(res, 500, { ok: false, message });
    }
  };
}

function createLifelineServer(depsIn = {}) {
  const handler = createLifelineHandler(depsIn);
  return http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) jsonResponse(res, 500, { ok: false, message: 'Internal error' });
    });
  });
}

function startFromCli() {
  const host = process.env.LIFELINE_BIND || '127.0.0.1';
  const port = Number(process.env.LIFELINE_PORT || 3090);
  if (host !== '127.0.0.1' && host !== '::1') {
    console.error('Lifeline refuses to bind outside loopback.');
    process.exit(1);
  }
  const server = createLifelineServer();
  server.listen(port, host, () => {
    console.log(`lifeline listening on ${host}:${port}`);
  });
  process.on('uncaughtException', (err) => {
    console.error('lifeline uncaughtException:', err && err.message ? err.message : err);
  });
  process.on('unhandledRejection', (err) => {
    console.error('lifeline unhandledRejection:', err && err.message ? err.message : err);
  });
}

if (require.main === module) {
  startFromCli();
}

module.exports = {
  VERSION,
  ALLOWED_APPS,
  PROBE_PORTS,
  parseAllowedLogins,
  pm2JlistCommand,
  pm2RestartCommand,
  isAllowedApp,
  loadState,
  saveState,
  rateLimitCheck,
  recordRestart,
  auditAppend,
  buildHtmlPage,
  createLifelineHandler,
  createLifelineServer,
  readPm2List,
  probePorts,
  tcpProbe,
};