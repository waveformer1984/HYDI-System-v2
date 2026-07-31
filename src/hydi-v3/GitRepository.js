'use strict';

const { execFile } = require('child_process');
const path = require('path');

const UNIT = '\u001f'; // ASCII unit separator — cannot appear in git field output
const RECORD = '\u001e'; // ASCII record separator

/**
 * Read-only accessor for a git working copy.
 *
 * Every method here observes; none of them mutate. That is enforced
 * structurally rather than by convention:
 *
 *   - `execFile` is used, never `exec` — there is no shell, so no command
 *     substitution or injection through branch names, paths, or commit
 *     messages, all of which are attacker-influenced in a shared repo.
 *   - Only subcommands on ALLOWED_SUBCOMMANDS may run. A typo or a future
 *     edit cannot turn this class into something that writes to the repo.
 *   - Every invocation is bounded by a timeout and a stdout cap, so a huge
 *     history or a hung git process cannot stall the sensor that polls it.
 *
 * Absence of git, or a directory that is not a repository, is a normal
 * condition and is reported, never thrown as a crash.
 */

const ALLOWED_SUBCOMMANDS = new Set([
  'rev-parse',
  'log',
  'show',
  'status',
  'for-each-ref',
  'symbolic-ref',
]);

class GitRepository {
  constructor(config = {}) {
    this.cwd = config.cwd || process.cwd();
    this.gitPath = config.gitPath || 'git';
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.maxBuffer = config.maxBuffer ?? 4 * 1024 * 1024;
    this.logger = config.logger || console;
  }

  /**
   * Run a read-only git subcommand.
   * @returns {Promise<{ok: boolean, stdout: string, error: string|null}>}
   */
  run(args = []) {
    const subcommand = args[0];
    if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
      return Promise.resolve({
        ok: false,
        stdout: '',
        error: `git subcommand "${subcommand}" is not permitted by GitRepository`,
      });
    }

    return new Promise((resolve) => {
      execFile(
        this.gitPath,
        args,
        { cwd: this.cwd, timeout: this.timeoutMs, maxBuffer: this.maxBuffer, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            resolve({
              ok: false,
              stdout: String(stdout || ''),
              error: String(stderr || (error instanceof Error ? error.message : error)).trim(),
            });
            return;
          }
          resolve({ ok: true, stdout: String(stdout || ''), error: null });
        },
      );
    });
  }

  /** True only when cwd is inside a real git working copy and git is runnable. */
  async isRepository() {
    const result = await this.run(['rev-parse', '--is-inside-work-tree']);
    return result.ok && result.stdout.trim() === 'true';
  }

  /**
   * Distinguish "git is not installed" from "this is not a repository", so the
   * sensor can report an accurate reason instead of a generic failure.
   */
  async diagnose() {
    const version = await this.run(['rev-parse', '--version']);
    if (!version.ok && /ENOENT|not found|not recognized/i.test(version.error || '')) {
      return { ok: false, reason: 'git-not-installed', detail: `git executable "${this.gitPath}" was not found` };
    }
    if (await this.isRepository()) {
      return { ok: true, reason: 'ok', detail: `${this.cwd} is a git working copy` };
    }
    return { ok: false, reason: 'not-a-repository', detail: `${this.cwd} is not inside a git working copy` };
  }

  /** Current HEAD sha, or null. */
  async head() {
    const result = await this.run(['rev-parse', 'HEAD']);
    if (!result.ok) return null;
    const sha = result.stdout.trim();
    return sha || null;
  }

  /** Current branch name, or null when detached. */
  async currentBranch() {
    const result = await this.run(['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (!result.ok) return null;
    return result.stdout.trim() || null;
  }

  /**
   * Commits reachable from HEAD that are newer than `sinceSha`.
   *
   * When `sinceSha` is null the caller is starting cold; only the most recent
   * `limit` commits are returned so a first run cannot replay an entire
   * repository's history as fresh activity.
   *
   * Returned oldest-first, so consumers see them in the order they happened.
   */
  async commitsSince(sinceSha = null, limit = 50) {
    const format = ['%H', '%an', '%aI', '%s'].join(UNIT) + RECORD;
    const range = sinceSha ? `${sinceSha}..HEAD` : 'HEAD';
    const result = await this.run(['log', range, `--max-count=${Number(limit) || 1}`, `--format=${format}`]);

    // An unknown `sinceSha` (rebased away, or a store from another repo) makes
    // the range invalid. Fall back to a cold read rather than losing the sensor.
    if (!result.ok) {
      if (sinceSha) return this.commitsSince(null, limit);
      return [];
    }

    const commits = result.stdout
      .split(RECORD)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const [sha, author, isoDate, subject] = chunk.split(UNIT);
        return {
          sha,
          author: author || 'unknown',
          at: isoDate ? Date.parse(isoDate) : Date.now(),
          subject: subject || '',
        };
      })
      .filter((commit) => !!commit.sha);

    return commits.reverse();
  }

  /** File paths touched by a commit. */
  async filesInCommit(sha) {
    if (!sha) return [];
    const result = await this.run(['show', '--name-only', '--format=', '--no-color', sha]);
    if (!result.ok) return [];
    return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  /** Local branches with their last commit time. */
  async branches() {
    const format = ['%(refname:short)', '%(committerdate:unix)'].join(UNIT);
    const result = await this.run(['for-each-ref', `--format=${format}`, 'refs/heads']);
    if (!result.ok) return [];
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, unix] = line.split(UNIT);
        return { name, lastCommitAt: Number(unix) * 1000 || 0 };
      })
      .filter((branch) => !!branch.name);
  }

  /**
   * Working-tree state.
   * @returns {Promise<{clean: boolean, files: Array<{status: string, path: string}>, counts: object}>}
   */
  async status() {
    const result = await this.run(['status', '--porcelain', '--untracked-files=normal']);
    if (!result.ok) return { clean: true, files: [], counts: { modified: 0, added: 0, deleted: 0, untracked: 0 } };

    const files = result.stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3).trim() }));

    const counts = { modified: 0, added: 0, deleted: 0, untracked: 0 };
    for (const file of files) {
      if (file.status === '??') counts.untracked++;
      else if (file.status.includes('D')) counts.deleted++;
      else if (file.status.includes('A')) counts.added++;
      else counts.modified++;
    }

    return { clean: files.length === 0, files, counts };
  }

  /** Repository directory name, used as the default project label. */
  get name() {
    return path.basename(this.cwd);
  }
}

module.exports = GitRepository;
module.exports.ALLOWED_SUBCOMMANDS = ALLOWED_SUBCOMMANDS;
