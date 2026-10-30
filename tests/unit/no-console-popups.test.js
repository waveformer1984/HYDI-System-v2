'use strict';

/**
 * No visible console windows from Frank's background processes.
 *
 * On Windows, a console program (git, gh, powershell, node, and cmd.exe when
 * `shell` is on) started from a background process without
 * `windowsHide: true` opens a terminal window that steals focus; with Windows
 * Terminal as the default console, one that exits non-zero stays open and
 * they pile up. On 2026-10-30 hydi-local-ci did exactly that on every pass.
 * See docs/FRANK_CONSOLE_POPUPS.md.
 *
 * This checks every script PM2 runs (ecosystem.config.js) plus the helper
 * modules those loops use: each call to a child_process launcher must pass
 * windowsHide in its options.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const LAUNCHERS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];
const HELPER_DIRS = ['lib/observation', 'lib/storage', 'lib/runtime'];

function pm2Scripts() {
  const { apps } = require(path.join(ROOT, 'ecosystem.config.js'));
  const files = new Set();
  for (const app of apps) {
    const file = path.resolve(app.cwd ? path.resolve(ROOT, app.cwd) : ROOT, app.script || '');
    if (file.startsWith(ROOT) && !file.includes(`${path.sep}node_modules${path.sep}`) && /\.(c|m)?js$/.test(file) && fs.existsSync(file)) {
      files.add(file);
    }
  }
  return [...files];
}

function helperFiles() {
  const out = [];
  for (const dir of HELPER_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) if (/\.js$/.test(f) && !/\.test\.js$/.test(f)) out.push(path.join(abs, f));
  }
  return out;
}

/** Names this file binds from child_process: destructured names and module aliases. */
function childProcessBindings(src) {
  const names = new Set();
  const aliases = new Set();
  const re = /(?:const|let|var)\s+(\{[^}]*\}|\w+)\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1].startsWith('{')) {
      for (const part of m[1].slice(1, -1).split(',')) {
        const [orig, alias] = part.split(':').map((s) => s.trim());
        if (LAUNCHERS.includes(orig)) names.add(alias || orig);
      }
    } else {
      aliases.add(m[1]);
    }
  }
  return { names, aliases };
}

/** The argument text of the call whose "(" is at `open`, with balanced brackets. */
function callArgs(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/**
 * Blank out comments (keeping newlines, so line numbers stay right) so a
 * launcher named in a comment isn't mistaken for a call. Strings are kept.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += next || ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c; out += c; i += 1;
    } else if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i += 1; }
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += c; i += 1;
    }
  }
  return out;
}

function unhiddenLaunches(file) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const { names, aliases } = childProcessBindings(src);
  if (!names.size && !aliases.size) return [];
  const callees = [...names, ...[...aliases].flatMap((a) => LAUNCHERS.map((l) => `${a}.${l}`))];
  const found = [];
  for (const callee of callees) {
    const re = new RegExp(`(?<![\\w.])${callee.replace('.', '\\.')}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(src))) {
      const args = callArgs(src, m.index + m[0].length - 1);
      if (!/windowsHide/.test(args)) {
        const line = src.slice(0, m.index).split('\n').length;
        found.push(`${path.relative(ROOT, file)}:${line} ${callee}(${args.split('\n')[0].slice(0, 60)}…)`);
      }
    }
  }
  return found;
}

describe('background processes never open console windows on Windows', () => {
  const files = [...new Set([...pm2Scripts(), ...helperFiles()])];

  it('covers the PM2 loops that launch programs on a timer', () => {
    const rel = files.map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
    for (const expected of ['scripts/local-ci.js', 'scripts/frank-auto-deploy.js', 'scripts/frank-observer.js', 'scripts/watchdog.js', 'lib/observation/strays.js']) {
      expect(rel).toContain(expected);
    }
  });

  it('every child_process launch in them passes windowsHide', () => {
    const offenders = files.flatMap(unhiddenLaunches);
    expect(offenders).toEqual([]);
  });

  it('the checker itself catches an unhidden launch and accepts a hidden one', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'popup-check-'));
    const tmp = path.join(dir, 'sample.js');
    fs.writeFileSync(tmp, [
      "const { spawn, execFileSync: run } = require('child_process');",
      "const cp = require('node:child_process');",
      "spawn('git', ['status'], { cwd: '.' });",
      "run('gh', ['auth', 'token'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });",
      "cp.exec('npm test', { shell: true });",
      "/x/.exec('not a launcher');",
      "// spawn('commented', ['out']) and /* exec('also') */ are ignored",
    ].join('\n'), { flag: 'wx', mode: 0o600 });
    try {
      const found = unhiddenLaunches(tmp).map((s) => s.replace(/^.*?:(\d+) /, '$1 '));
      expect(found).toEqual(["3 spawn('git', ['status'], { cwd: '.' }…)", "5 cp.exec('npm test', { shell: true }…)"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
