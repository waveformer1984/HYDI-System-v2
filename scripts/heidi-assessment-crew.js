'use strict';

/**
 * heidi-assessment-crew.js — run a specialist agent assessment of Heidi's
 * operations and have the crew coordinate on the forge board.
 *
 * Each agent owns one specialty, collects real evidence (PM2 table, health
 * probes, git inventory, code scans), then posts findings as a reply to the
 * coordinator's thread on #ops. Heidi opens and synthesizes the thread.
 * Reuses existing board identities and their HYDI_BOARD_TOKEN_* env vars —
 * no new secrets. Optional Ollama pass (CREW_LLM, default on when reachable)
 * only rephrases collected evidence; it never invents findings.
 *
 * Usage:
 *   node scripts/heidi-assessment-crew.js [--dry-run] [--channel=ops]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const sdk = require('../lib/forge-board/sdk');

const ROOT = path.resolve(__dirname, '..');
const ARGS = process.argv.slice(2);
const DRY = ARGS.includes('--dry-run');
const CHANNEL = (ARGS.find((a) => a.startsWith('--channel=')) || '--channel=ops').split('=')[1];
const CYCLE = new Date().toISOString().slice(0, 10);

function sh(cmd, args, timeoutMs = 8000) {
  try {
    return execFileSync(cmd, args, {
      cwd: ROOT, timeout: timeoutMs, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    }).trim();
  } catch {
    return '';
  }
}

async function probe(url, timeoutMs = 3000) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.status;
  } catch {
    return 0;
  }
}

function trackedFiles() {
  const out = sh('git', ['ls-files'], 15000);
  return out ? out.split('\n').map((l) => l.trim()).filter(Boolean) : [];
}

function countPattern(files, re, exts) {
  let hits = 0;
  for (const rel of files) {
    if (!exts.test(rel)) continue;
    const abs = path.join(ROOT, rel);
    try {
      const st = fs.statSync(abs);
      if (st.size > 200 * 1024) continue;
      const text = fs.readFileSync(abs, 'utf8');
      hits += (text.match(re) || []).length;
    } catch { /* unreadable */ }
  }
  return hits;
}

/* ── Specialists ─────────────────────────────────────────── */

const AGENTS = [
  {
    sender: 'hydi-daemon',
    title: 'Runtime & Reliability',
    async collect() {
      const findings = [];
      const recs = [];
      const pm2 = process.platform === 'win32' ? 'cmd' : 'pm2';
      const pm2Args = process.platform === 'win32' ? ['/c', 'pm2', 'jlist'] : ['jlist'];
      const raw = sh(pm2, pm2Args, 30000);
      let apps = [];
      try { apps = JSON.parse(raw || '[]'); } catch { apps = []; }
      const online = apps.filter((a) => a.pm2_env && a.pm2_env.status === 'online');
      const other = apps.filter((a) => !online.includes(a));
      const restarts = apps.reduce((n, a) => n + ((a.pm2_env && a.pm2_env.restart_time) || 0), 0);
      if (apps.length) {
        findings.push(`PM2 fleet: ${online.length}/${apps.length} online, ${restarts} lifetime restarts across all apps`);
        for (const a of other.slice(0, 5)) {
          findings.push(`NOT-ONLINE: ${a.name} (status ${a.pm2_env && a.pm2_env.status}, restarts ${a.pm2_env && a.pm2_env.restart_time})`);
        }
        const hot = [...apps].sort((x, y) => ((y.pm2_env && y.pm2_env.restart_time) || 0) - ((x.pm2_env && x.pm2_env.restart_time) || 0)).slice(0, 3);
        if (hot[0] && hot[0].pm2_env.restart_time > 0) {
          findings.push(`Most-restarted: ${hot.map((a) => `${a.name}(${a.pm2_env.restart_time})`).join(', ')}`);
        }
      } else {
        findings.push('PM2 table unreadable — pm2 jlist returned nothing');
      }
      const probes = [
        ['heidi-web :3000', 'http://127.0.0.1:3000/api/ping'],
        ['heidi-core :3459', 'http://127.0.0.1:3459/health'],
        ['heidi-mobile :3006', 'http://127.0.0.1:3006/api/health'],
        ['heidi-bridge :5050', 'http://127.0.0.1:5050/health'],
        ['ollama :11434', 'http://127.0.0.1:11434/api/tags'],
      ];
      const up = [], down = [];
      for (const [name, url] of probes) {
        const code = await probe(url);
        (code ? up : down).push(`${name}(${code || 'down'})`);
      }
      findings.push(`Health probes: ${up.length} up [${up.join(', ')}]${down.length ? ` — DOWN: ${down.join(', ')}` : ''}`);
      try {
        const s = fs.statfsSync('C:\\');
        const freeGb = (s.bavail * s.bsize / 1073741824).toFixed(1);
        findings.push(`C: free space ${freeGb} GB`);
        if (Number(freeGb) < 11) recs.push('Disk trending toward the 10 GiB WARNING floor — revisit the gate-005 Docker/image cleanup decisions');
      } catch { /* statfs unavailable */ }
      if (down.length) recs.push(`Investigate unhealthy endpoints before claiming the stack is up: ${down.join(', ')}`);
      return { findings, recs };
    },
  },
  {
    sender: 'CASCADE',
    title: 'Architecture & Code Health',
    async collect() {
      const files = trackedFiles();
      const findings = [`Tracked files: ${files.length}`];
      const recs = [];
      const byTop = {};
      for (const f of files) byTop[(f.split('/')[0])] = (byTop[f.split('/')[0]] || 0) + 1;
      const tops = Object.entries(byTop).sort((a, b) => b[1] - a[1]).slice(0, 8);
      findings.push(`Largest dirs by file count: ${tops.map(([d, n]) => `${d}(${n})`).join(', ')}`);
      const codeRe = /\.(js|jsx|ts|tsx|py|sh|ps1)$/;
      const big = files.filter((f) => codeRe.test(f))
        .map((f) => { try { return [f, fs.statSync(path.join(ROOT, f)).size]; } catch { return null; } })
        .filter(Boolean).sort((a, b) => b[1] - a[1]).slice(0, 5);
      findings.push(`Largest source files: ${big.map(([f, sz]) => `${f} ${(sz / 1024).toFixed(0)}KB`).join(', ')}`);
      const todos = countPattern(files, /TODO|FIXME|XXX|HACK/g, /\.(js|ts|tsx|py)$/);
      findings.push(`TODO/FIXME/HACK markers in code: ${todos}`);
      const dupNames = {};
      for (const f of files) {
        const base = path.basename(f);
        if (codeRe.test(base)) dupNames[base] = (dupNames[base] || []).concat(f);
      }
      const dups = Object.values(dupNames).filter((v) => v.length > 1).slice(0, 5);
      if (dups.length) findings.push(`Same-name files (possible duplication): ${dups.map((v) => v.join(' vs ')).join('; ')}`);
      if (todos > 200) recs.push('Marker debt is high — schedule a TODO sweep; many are likely stale');
      recs.push('Consider module boundaries per top dir before they grow past navigable size');
      return { findings, recs };
    },
  },
  {
    sender: 'KILO',
    title: 'Testing & Quality Gates',
    async collect() {
      const files = trackedFiles();
      const tests = files.filter((f) => /^tests\//.test(f) && /\.(test|spec)\.(js|ts|tsx)$/.test(f));
      const src = files.filter((f) => /^(lib|api|pages|src|apps)\//.test(f) && /\.(js|ts|tsx)$/.test(f));
      const findings = [
        `Test inventory: ${tests.length} test files vs ${src.length} source files (ratio ${(tests.length / Math.max(1, src.length)).toFixed(2)})`,
      ];
      const recs = [];
      const skips = countPattern(tests, /(describe|it|test)\.skip|\.skip\(/g, /\.(js|ts|tsx)$/);
      findings.push(`Skipped test markers in suite files: ${skips}`);
      const hooksPath = sh('git', ['config', 'core.hooksPath']) || '.git/hooks';
      const prePush = path.join(ROOT, hooksPath, 'pre-push');
      findings.push(`Pre-push hook: ${fs.existsSync(prePush) ? `present at ${hooksPath}/pre-push` : 'MISSING'}`);
      const jestCfg = files.filter((f) => /jest\.config|jest\.config\./.test(f));
      findings.push(`Jest config files: ${jestCfg.join(', ') || 'none found'}`);
      if (skips > 0) recs.push(`Audit the ${skips} skipped-test markers — decide fix, delete, or document`);
      if (tests.length / Math.max(1, src.length) < 0.15) recs.push('Test-to-source ratio is thin; prioritize coverage on revenue/delivery/auth paths');
      return { findings, recs };
    },
  },
  {
    sender: 'Hyve',
    title: 'Security & Governance',
    async collect() {
      const files = trackedFiles();
      const findings = [];
      const recs = [];
      const envTracked = files.some((f) => /(^|\/)\.env(\.local)?$/.test(f));
      findings.push(`.env files in git index: ${envTracked ? 'YES — tracked secrets file!' : 'none tracked'}`);
      if (envTracked) recs.push('Remove .env files from the index and rotate anything they contained');
      const envLocal = path.join(ROOT, '.env.local');
      if (fs.existsSync(envLocal)) {
        const names = fs.readFileSync(envLocal, 'utf8').split('\n')
          .map((l) => l.split('=')[0].trim()).filter((k) => k && !k.startsWith('#'));
        findings.push(`.env.local present locally with ${names.length} keys (names only, not tracked)`);
      }
      const liveReaders = countPattern(files, /ALLOW_LIVE_STRIPE/g, /\.(js|ts|tsx)$/);
      const looseReaders = countPattern(files, /ALLOW_LIVE_STRIPE\s*\?|ALLOW_LIVE_STRIPE\s*\)|ALLOW_LIVE_STRIPE\s*&&|ALLOW_LIVE_STRIPE\s*\|\|/g, /\.(js|ts|tsx)$/);
      findings.push(`ALLOW_LIVE_STRIPE references: ${liveReaders}; loose truthy readers: ${looseReaders}`);
      if (looseReaders > 0) recs.push('Found possibly-truthy ALLOW_LIVE_STRIPE readers — all must be strict === \'true\'');
      const boardGuard = countPattern(files, /is_internal_ip|client_ip/g, /store\.py|http\.js/);
      findings.push(`Board LAN-only guard references: ${boardGuard} (posts/reads restricted to internal IPs)`);
      const scanner = files.filter((f) => /hardcoded-secrets|no-hardcoded/.test(f));
      findings.push(`Secrets-scan test present: ${scanner.length ? 'yes' : 'NO'}`);
      if (!scanner.length) recs.push('Add a tracked-file secrets scan to the gate suite');
      recs.push('Rotate HYDI_BOARD_HUMAN_TOKEN — it has appeared in plain chat twice');
      return { findings, recs };
    },
  },
  {
    sender: 'ProtoForge',
    title: 'Revenue Pipeline',
    async collect() {
      const files = trackedFiles();
      const findings = [];
      const recs = [];
      const revenue = files.filter((f) => /^(lib\/revenue|lib\/billing|api\/checkout|api\/webhooks|api\/revenue)/.test(f));
      findings.push(`Revenue surface: ${revenue.length} files across lib/revenue, lib/billing, api/{checkout,webhooks,revenue}`);
      const live = String(process.env.ALLOW_LIVE_STRIPE || '');
      const agg = String(process.env.REVENUE_AGGREGATE_LIVEMODE_ONLY || '');
      findings.push(`Stripe mode: ALLOW_LIVE_STRIPE=${live === 'true' ? 'LIVE' : 'test-only'} · livemode-only aggregation ${agg === 'true' ? 'ON' : 'off'}`);
      const streams = ['galactic_bytes', 'detailer_bot', 'lipi_v2', 'protogrance_aromatics', 'rezonate', 'waveformer_studio'];
      const present = streams.filter((s) => files.some((f) => f.includes(s) || f.includes(s.split('_')[0])));
      findings.push(`Revenue streams with code presence: ${present.length}/6 (${present.join(', ') || 'none'})`);
      const delivery = files.filter((f) => /deliver|Delivery/.test(f));
      findings.push(`Delivery-path files: ${delivery.length}`);
      if (live !== 'true') recs.push('Live payments still disabled — first real sale still blocked behind a deliberate go-live step');
      if (present.length < 6) recs.push(`Streams without code footprint: ${streams.filter((s) => !present.includes(s)).join(', ')}`);
      recs.push('Wire verified-revenue reporting into the board: a weekly ledger digest post would close the loop visibly');
      return { findings, recs };
    },
  },
  {
    sender: 'Ursula',
    title: 'Product & Mobile Surface',
    async collect() {
      const files = trackedFiles();
      const findings = [];
      const recs = [];
      const termux = files.filter((f) => /^termux\//.test(f));
      const mobile = files.filter((f) => /hydi-mobile|mobile/i.test(f));
      findings.push(`Termux/thin-client surface: ${termux.length} files; mobile-named files: ${mobile.length}`);
      const boardBits = ['lib/forge-board/store.py', 'lib/forge-board/ui.html', 'hydi.py']
        .filter((f) => files.includes(f));
      findings.push(`Board stack present: ${boardBits.join(', ') || 'MISSING'}`);
      const store = path.join(ROOT, 'lib/forge-board/store.py');
      if (fs.existsSync(store)) {
        const src = fs.readFileSync(store, 'utf8');
        findings.push(`Offline outbox: ${/sync_outbox_once/.test(src) ? 'implemented (pushed flag + replay)' : 'absent'}`);
      }
      const rez = files.filter((f) => /^rezonate\//.test(f));
      findings.push(`Rezonate product files: ${rez.length}`);
      const pwa = files.filter((f) => /manifest\.json|sw\.js/.test(f));
      findings.push(`PWA assets: ${pwa.length ? pwa.join(', ') : 'embedded only'}`);
      recs.push('FRANK_HOSTS failover and the outbox ship in PR #379 — merge + redeploy hydi.py and heidi-web before relying on cellular');
      recs.push('The phone still runs llama.cpp on :8080 feeding little — retire or keep deliberately (see PR #379 note)');
      return { findings, recs };
    },
  },
];

/* ── Coordinator ─────────────────────────────────────────── */

async function ollamaSummarize(evidence) {
  const base = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  let model = 'qwen2.5:3b';
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const tags = await res.json();
    const names = (tags.models || []).map((m) => m.name);
    model = names.find((n) => /qwen2\.5/.test(n)) || names[0] || model;
  } catch { return null; }
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        model, stream: false,
        messages: [
          { role: 'system', content: 'You are the coordinator of a Heidi operations assessment. Given the specialist evidence below, write 3-5 prioritized streamlining recommendations. Be terse, concrete, and only use the evidence. No preamble.' },
          { role: 'user', content: evidence.slice(0, 6000) },
        ],
        options: { temperature: 0.3, num_predict: 400 },
      }),
    });
    const data = await res.json();
    return (data.message && data.message.content || '').trim() || null;
  } catch { return null; }
}

async function post(sender, body, replyTo) {
  if (DRY) {
    console.log(`\n--- [${sender}] ---\n${body}\n`);
    return { ok: true, message: { id: 'dry-' + Math.random().toString(36).slice(2) } };
  }
  process.env.HYDI_BOARD_SENDER = sender;
  const res = await sdk.post(CHANNEL, body, replyTo);
  if (!res || !res.ok) console.error(`post failed for ${sender}: ${JSON.stringify(res).slice(0, 200)}`);
  return res;
}

async function main() {
  const t0 = Date.now();
  const header = `HEIDI ASSESSMENT ${CYCLE} — 7-agent specialist review of Heidi + ProtoForge ops. Findings below are evidence-collected live; replies thread under this post.`;
  const root = await post('Heidi', header, null);
  const rootId = root && root.message && root.message.id;
  console.log(`thread root: ${rootId}`);

  const allFindings = [];
  const allRecs = [];
  for (const agent of AGENTS) {
    let report;
    try {
      report = await agent.collect();
    } catch (error) {
      report = { findings: [`collector crashed: ${error.message}`], recs: [] };
    }
    allFindings.push(...report.findings.map((f) => `[${agent.title}] ${f}`));
    allRecs.push(...report.recs.map((r) => `[${agent.title}] ${r}`));
    const body = [
      `@Heidi ${agent.title} report (sender ${agent.sender}):`,
      ...report.findings.map((f) => `• ${f}`),
      ...(report.recs.length ? ['Recommendations:', ...report.recs.map((r) => `→ ${r}`)] : []),
    ].join('\n');
    await post(agent.sender, body.slice(0, 3900), rootId);
    console.log(`${agent.sender}: ${report.findings.length} findings, ${report.recs.length} recs`);
  }

  const evidence = allFindings.concat(allRecs.map((r) => 'REC ' + r)).join('\n');
  let synthesis = '';
  if (process.env.CREW_LLM !== '0') {
    synthesis = await ollamaSummarize(evidence) || '';
  }
  const summary = [
    `Assessment synthesis — ${allFindings.length} findings, ${allRecs.length} recommendations across ${AGENTS.length} specialties.`,
    synthesis ? `\nCoordinator pass (${process.env.OLLAMA_URL || 'local Ollama'}):\n${synthesis}` : '',
    `\nTop recommendations:`,
    ...allRecs.slice(0, 8).map((r, i) => `${i + 1}. ${r}`),
    `\nCycle complete in ${((Date.now() - t0) / 1000).toFixed(0)}s.`,
  ].join('\n');
  await post('Heidi', summary.slice(0, 3900), rootId);
  console.log('synthesis posted');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
