/**
 * Heidi GitHub Client
 *
 * Gives Heidi autonomous GitHub capability: she can list, review, merge,
 * comment on, and close PRs and issues without the operator in the loop.
 *
 * Auth:   GITHUB_TOKEN env var (fine-grained PAT with repo scope)
 * Scope:  GITHUB_OWNER / GITHUB_REPO env vars (or pass per-call)
 * Safety: GITHUB_DRY_RUN=true logs actions instead of executing them
 *
 * All methods return { ok: bool, data, error } — Heidi never throws on
 * API failures, she reports them and decides what to do next.
 *
 * Usage (standalone):
 *   const gh = new HeidiGitHub();
 *   const { ok, data } = await gh.listPRs();
 *   await gh.mergePR(6, 'squash');
 *
 * Usage (via Nexus operator API):
 *   POST /nexus/github/prs/6/merge  { method: 'squash' }
 */

const GH_API = 'https://api.github.com';

class HeidiGitHub {
  constructor(config = {}) {
    this.token   = config.token   || process.env.GITHUB_TOKEN;
    this.owner   = config.owner   || process.env.GITHUB_OWNER;
    this.repo    = config.repo    || process.env.GITHUB_REPO;
    this.dryRun  = config.dryRun  ?? (process.env.GITHUB_DRY_RUN === 'true');

    if (!this.token) {
      console.warn('[HeidiGitHub] GITHUB_TOKEN not set — all write operations will fail');
    }

    this._headers = {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  // ─── Pull Requests ────────────────────────────────────────────────────────

  async listPRs({ state = 'open', perPage = 30 } = {}) {
    return this._get(`/repos/${this.owner}/${this.repo}/pulls`, { state, per_page: perPage });
  }

  async getPR(number) {
    return this._get(`/repos/${this.owner}/${this.repo}/pulls/${number}`);
  }

  async getPRFiles(number) {
    return this._get(`/repos/${this.owner}/${this.repo}/pulls/${number}/files`);
  }

  async getPRChecks(number) {
    const pr = await this.getPR(number);
    if (!pr.ok) return pr;
    const sha = pr.data.head?.sha;
    return this._get(`/repos/${this.owner}/${this.repo}/commits/${sha}/check-runs`);
  }

  /**
   * Merge a PR. method: 'merge' | 'squash' | 'rebase'
   * Heidi uses squash by default to keep history clean.
   */
  async mergePR(number, method = 'squash', { commitTitle, commitMessage } = {}) {
    if (this.dryRun) {
      console.log(`[HeidiGitHub][DRY RUN] Would merge PR #${number} via ${method}`);
      return { ok: true, data: { dry_run: true, pr: number, method } };
    }

    const pr = await this.getPR(number);
    if (!pr.ok) return pr;

    return this._put(`/repos/${this.owner}/${this.repo}/pulls/${number}/merge`, {
      merge_method:   method,
      commit_title:   commitTitle || pr.data.title,
      commit_message: commitMessage || '',
    });
  }

  async createPR({ title, head, base, body = '', draft = false }) {
    if (this.dryRun) {
      console.log(`[HeidiGitHub][DRY RUN] Would create PR "${title}" ${head} → ${base}`);
      return { ok: true, data: { dry_run: true } };
    }
    return this._post(`/repos/${this.owner}/${this.repo}/pulls`, { title, head, base, body, draft });
  }

  async commentOnPR(number, body) {
    if (this.dryRun) {
      console.log(`[HeidiGitHub][DRY RUN] Would comment on PR #${number}: ${body.slice(0, 80)}`);
      return { ok: true, data: { dry_run: true } };
    }
    return this._post(`/repos/${this.owner}/${this.repo}/issues/${number}/comments`, { body });
  }

  async closePR(number) {
    if (this.dryRun) {
      console.log(`[HeidiGitHub][DRY RUN] Would close PR #${number}`);
      return { ok: true, data: { dry_run: true } };
    }
    return this._patch(`/repos/${this.owner}/${this.repo}/pulls/${number}`, { state: 'closed' });
  }

  // ─── Issues ───────────────────────────────────────────────────────────────

  async listIssues({ state = 'open', perPage = 30, labels } = {}) {
    const params = { state, per_page: perPage };
    if (labels) params.labels = labels;
    return this._get(`/repos/${this.owner}/${this.repo}/issues`, params);
  }

  async getIssue(number) {
    return this._get(`/repos/${this.owner}/${this.repo}/issues/${number}`);
  }

  async commentOnIssue(number, body) {
    if (this.dryRun) {
      console.log(`[HeidiGitHub][DRY RUN] Would comment on issue #${number}: ${body.slice(0, 80)}`);
      return { ok: true, data: { dry_run: true } };
    }
    return this._post(`/repos/${this.owner}/${this.repo}/issues/${number}/comments`, { body });
  }

  async closeIssue(number, reason = 'completed') {
    if (this.dryRun) {
      console.log(`[HeidiGitHub][DRY RUN] Would close issue #${number} as ${reason}`);
      return { ok: true, data: { dry_run: true } };
    }
    return this._patch(`/repos/${this.owner}/${this.repo}/issues/${number}`, {
      state: 'closed',
      state_reason: reason,
    });
  }

  // ─── Repo info ────────────────────────────────────────────────────────────

  async getRepo() {
    return this._get(`/repos/${this.owner}/${this.repo}`);
  }

  async listBranches() {
    return this._get(`/repos/${this.owner}/${this.repo}/branches`);
  }

  async getCommit(sha) {
    return this._get(`/repos/${this.owner}/${this.repo}/commits/${sha}`);
  }

  // ─── Heidi-facing summary helpers ─────────────────────────────────────────

  /**
   * Return a plain-English summary of all open PRs — Heidi uses this
   * to decide which ones need her attention.
   */
  async briefOpenPRs() {
    const { ok, data, error } = await this.listPRs({ state: 'open' });
    if (!ok) return `Could not fetch PRs: ${error}`;
    if (!data.length) return 'No open pull requests.';

    return data.map(pr => {
      const age = Math.floor((Date.now() - new Date(pr.created_at)) / 86_400_000);
      return `PR #${pr.number} [${pr.state}] "${pr.title}" by ${pr.user?.login} — ${age}d old, base: ${pr.base?.ref}`;
    }).join('\n');
  }

  /**
   * Return a plain-English summary of open issues.
   */
  async briefOpenIssues() {
    const { ok, data, error } = await this.listIssues({ state: 'open' });
    if (!ok) return `Could not fetch issues: ${error}`;
    // GitHub issues API returns PRs too — filter them out
    const issues = data.filter(i => !i.pull_request);
    if (!issues.length) return 'No open issues.';

    return issues.map(i => {
      const age = Math.floor((Date.now() - new Date(i.created_at)) / 86_400_000);
      const labels = i.labels?.map(l => l.name).join(', ') || 'none';
      return `Issue #${i.number} "${i.title}" — ${age}d old, labels: ${labels}`;
    }).join('\n');
  }

  // ─── HTTP internals (native fetch, Node 18+) ─────────────────────────────

  async _get(path, params = {}) {
    const qs = Object.keys(params).length
      ? '?' + new URLSearchParams(params).toString()
      : '';
    return this._req('GET', path + qs);
  }

  async _post(path, body)  { return this._req('POST',  path, body); }
  async _put(path, body)   { return this._req('PUT',   path, body); }
  async _patch(path, body) { return this._req('PATCH', path, body); }

  async _req(method, path, body) {
    const url = path.startsWith('http') ? path : `${GH_API}${path}`;
    try {
      const res = await fetch(url, {
        method,
        headers: this._headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
      const data = res.headers.get('content-type')?.includes('json')
        ? await res.json()
        : await res.text();
      if (!res.ok) {
        const msg = data?.message || data || res.statusText;
        console.error(`[HeidiGitHub] ${method} ${path} → ${res.status}: ${msg}`);
        return { ok: false, error: msg, status: res.status };
      }
      return { ok: true, data, status: res.status };
    } catch (err) {
      console.error(`[HeidiGitHub] ${method} ${path} failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }
}

module.exports = HeidiGitHub;
