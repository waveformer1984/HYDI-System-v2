#!/usr/bin/env node
'use strict';

/**
 * Local CI -- runs this repo's CI checks on a machine you control and
 * reports the result to GitHub as commit statuses, so pull requests show a
 * real green/red signal without GitHub Actions.
 *
 * Why: GitHub-hosted runners have not been dispatched for this repo since
 * 2026-07-17 (ROADMAP.md P0 #2) -- every Actions job fails in seconds with
 * runner_id 0, so the Actions checks carry no information. A self-hosted
 * Actions runner is not a safe substitute: this repo is public, so any fork
 * PR could run arbitrary code on the runner's host. This script only tests
 * commits from branches in this repository (never forks) and never needs
 * Actions at all. See LOCAL_CI.md.
 *
 * Each commit is tested in a throwaway `git worktree` with a clean `npm ci`,
 * so uncommitted local changes can't leak into the result.
 *
 * Usage:
 *   node scripts/local-ci.js [<sha|ref>]    test one commit (default HEAD)
 *   node scripts/local-ci.js --pr 276       test a PR's current head
 *   node scripts/local-ci.js --watch        test every same-repo open PR head
 *                                           without a local-ci status; repeat
 *                                           every --interval minutes (default 10)
 *   --no-post   run the checks but don't report to GitHub
 *   --once      with --watch: one pass, then exit
 *
 * Token: GITHUB_TOKEN or GH_TOKEN, else `gh auth token`. Needs "Commit
 * statuses: write" (fine-grained) or `repo:status` (classic). Never logged.
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = process.env.LOCAL_CI_REPO || 'waveformer1984/HYDI-System-v2';
const API = 'https://api.github.com';
const IS_WINDOWS = process.platform === 'win32';

// Mirrors the steps of .github/workflows/unit-tests.yml and
// integration-tests.yml (minus coverage upload), plus the repo-wide
// typecheck the pre-push hook runs.
const CHECKS = [
  {
    context: 'local-ci/unit-tests',
    mirrors: 'Jest Unit Tests',
    steps: [['npm', ['run', 'lint']], ['npm', ['test', '--', '--forceExit']]],
  },
  {
    context: 'local-ci/integration-tests',
    mirrors: 'HYDI V3 Operational Integration Suite',
    steps: [
      ['npm', ['run', 'typecheck:hydi-v3']],
      ['npm', ['run', 'lint:hydi-v3']],
      ['npm', ['run', 'test:integration:jest']],
    ],
  },
  {
    context: 'local-ci/typecheck',
    mirrors: 'npm run typecheck',
    steps: [['npm', ['run', 'typecheck']]],
  },
];

function parseArgs(argv) {
  const opts = { target: 'HEAD', pr: null, watch: false, once: false, post: true, intervalMin: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pr') opts.pr = Number(argv[++i]);
    else if (a === '--watch') opts.watch = true;
    else if (a === '--once') opts.once = true;
    else if (a === '--no-post') opts.post = false;
    else if (a === '--interval') opts.intervalMin = Number(argv[++i]);
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else opts.target = a;
  }
  if (opts.pr !== null && !(opts.pr > 0)) throw new Error('--pr needs a PR number');
  if (!(opts.intervalMin > 0)) throw new Error('--interval needs a positive number of minutes');
  return opts;
}

/** Pulls "Tests: 3 failed, 12 passed, 15 total" out of Jest output. */
function summarizeJest(output) {
  const lines = output.split(/\r?\n/).filter((l) => /^Tests:\s/.test(l.trim()));
  return lines.length ? lines[lines.length - 1].trim().replace(/\s+/g, ' ') : null;
}

/** GitHub caps status descriptions at 140 characters. */
function describe(text) {
  return text.length <= 140 ? text : `${text.slice(0, 137)}...`;
}

/**
 * Open PRs that still need a local-ci run: same-repo heads only (a fork's
 * code must never run on this machine) whose head lacks a final result for
 * some check. A head whose latest status for a check is still `pending`
 * (an interrupted run) is tested again. `statuses` is GitHub's list for the
 * commit, newest first.
 */
function selectPullsToTest(pulls, statusesBySha) {
  return pulls.filter((pr) => {
    if (!pr.head || !pr.head.repo || pr.head.repo.full_name !== REPO) return false;
    const statuses = statusesBySha[pr.head.sha] || [];
    return CHECKS.some((check) => {
      const latest = statuses.find((s) => s.context === check.context);
      return !latest || latest.state === 'pending';
    });
  });
}

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: IS_WINDOWS }).trim();
  } catch (_) {
    return null;
  }
}

async function github(token, method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'hydi-local-ci',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`GitHub ${method} ${route} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

function postStatus(ctx, sha, context, state, description) {
  if (!ctx.post) return Promise.resolve();
  return github(ctx.token, 'POST', `/repos/${REPO}/statuses/${sha}`, {
    state,
    context,
    description: describe(description),
  });
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Runs one command, streaming to the log file; resolves with exit code + output. */
function run(cmd, args, cwd, logStream) {
  return new Promise((resolve) => {
    logStream.write(`\n$ ${cmd} ${args.join(' ')}\n`);
    const child = spawn(cmd, args, { cwd, shell: IS_WINDOWS, env: { ...process.env, CI: 'true' } });
    let output = '';
    const onData = (chunk) => {
      output += chunk;
      logStream.write(chunk);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => resolve({ code: 1, output: `${output}\n${err.message}` }));
    child.on('close', (code) => resolve({ code: code === null ? 1 : code, output }));
  });
}

async function testCommit(ctx, sha) {
  const short = sha.slice(0, 7);
  const host = os.hostname();
  const logDir = path.join(os.tmpdir(), 'hydi-local-ci', short);
  fs.mkdirSync(logDir, { recursive: true });
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), `hydi-ci-${short}-`));
  fs.rmdirSync(workdir); // git worktree add wants to create it

  console.log(`[local-ci] ${short}: testing on ${host} (logs: ${logDir})`);
  for (const check of CHECKS) await postStatus(ctx, sha, check.context, 'pending', `Running on ${host}`);

  const results = [];
  try {
    git(['worktree', 'add', '--detach', workdir, sha], ctx.repoRoot);
    const installLog = fs.createWriteStream(path.join(logDir, 'install.log'));
    const install = await run('npm', ['ci', '--no-audit', '--no-fund'], workdir, installLog);
    installLog.end();
    if (install.code !== 0) {
      for (const check of CHECKS) {
        await postStatus(ctx, sha, check.context, 'error', `npm ci failed on ${host}`);
        results.push({ context: check.context, ok: false, description: 'npm ci failed' });
      }
      return results;
    }

    for (const check of CHECKS) {
      const log = fs.createWriteStream(path.join(logDir, `${check.context.replace('/', '-')}.log`));
      let failed = null;
      let summary = null;
      for (const [cmd, args] of check.steps) {
        const step = await run(cmd, args, workdir, log);
        summary = summarizeJest(step.output) || summary;
        if (step.code !== 0) {
          failed = `${cmd} ${args.join(' ')}`;
          break;
        }
      }
      log.end();
      const description = failed
        ? `Failed: ${failed}${summary ? ` (${summary})` : ''} on ${host}`
        : `Passed${summary ? `: ${summary}` : ''} on ${host}`;
      await postStatus(ctx, sha, check.context, failed ? 'failure' : 'success', description);
      results.push({ context: check.context, ok: !failed, description });
      console.log(`[local-ci] ${short}: ${check.context} ${failed ? 'FAILED' : 'passed'} -- ${description}`);
    }
    return results;
  } finally {
    try {
      git(['worktree', 'remove', '--force', workdir], ctx.repoRoot);
    } catch (_) {
      fs.rmSync(workdir, { recursive: true, force: true });
      try { git(['worktree', 'prune'], ctx.repoRoot); } catch (__) { /* best effort */ }
    }
  }
}

async function watchOnce(ctx) {
  const pulls = await github(ctx.token, 'GET', `/repos/${REPO}/pulls?state=open&per_page=50`);
  const statusesBySha = {};
  for (const pr of pulls) {
    if (pr.head && pr.head.repo && pr.head.repo.full_name === REPO) {
      statusesBySha[pr.head.sha] = await github(ctx.token, 'GET', `/repos/${REPO}/commits/${pr.head.sha}/statuses?per_page=100`);
    }
  }
  const todo = selectPullsToTest(pulls, statusesBySha);
  const skippedForks = pulls.filter((pr) => !pr.head || !pr.head.repo || pr.head.repo.full_name !== REPO);
  if (skippedForks.length) {
    console.log(`[local-ci] not testing fork PRs: ${skippedForks.map((pr) => `#${pr.number}`).join(', ')}`);
  }
  if (!todo.length) console.log('[local-ci] no open PR heads need a run');
  for (const pr of todo) {
    git(['fetch', 'origin', pr.head.ref], ctx.repoRoot);
    console.log(`[local-ci] PR #${pr.number} (${pr.head.ref})`);
    await testCommit(ctx, pr.head.sha);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = git(['rev-parse', '--show-toplevel'], process.cwd());
  const ctx = { repoRoot, post: opts.post, token: null };

  const needsApi = opts.post || opts.watch || opts.pr !== null;
  if (needsApi) {
    ctx.token = getToken();
    if (!ctx.token) {
      throw new Error('No GitHub token: set GITHUB_TOKEN/GH_TOKEN or run `gh auth login` (or pass --no-post for a local-only run).');
    }
  }

  if (opts.watch) {
    for (;;) {
      try {
        await watchOnce(ctx);
      } catch (err) {
        console.error(`[local-ci] watch pass failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
      if (opts.once) return;
      await new Promise((resolve) => setTimeout(resolve, opts.intervalMin * 60 * 1000));
    }
  }

  let sha;
  if (opts.pr !== null) {
    const pr = await github(ctx.token, 'GET', `/repos/${REPO}/pulls/${opts.pr}`);
    if (!pr.head.repo || pr.head.repo.full_name !== REPO) {
      throw new Error(`PR #${opts.pr} comes from a fork; local-ci never runs fork code.`);
    }
    git(['fetch', 'origin', pr.head.ref], repoRoot);
    sha = pr.head.sha;
  } else {
    sha = git(['rev-parse', '--verify', `${opts.target}^{commit}`], repoRoot);
  }

  const results = await testCommit(ctx, sha);
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `[local-ci] ${failed.length} check(s) failed` : '[local-ci] all checks passed');
  process.exitCode = failed.length ? 1 : 0;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[local-ci] ${err instanceof Error ? err.message : 'Unknown error'}`);
    process.exitCode = 1;
  });
}

module.exports = { CHECKS, REPO, parseArgs, summarizeJest, describe, selectPullsToTest };
