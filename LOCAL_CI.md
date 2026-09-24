# Local CI (workaround for the GitHub Actions outage)

GitHub-hosted runners have not been dispatched for this repo since
2026-07-17 (`ROADMAP.md` P0 #2): every Actions job fails within seconds
with `runner_id: 0`, so red Actions checks carry no information.
`scripts/local-ci.js` gives pull requests a real signal without Actions. It
runs the same checks on a machine you control and reports each result
back to the commit as a **commit status**, shown on the PR next to the
(dead) Actions checks.

| Status context | Runs | Mirrors |
|---|---|---|
| `local-ci/unit-tests` | `npm run lint`, `npm test -- --forceExit` | `Jest Unit Tests` (`unit-tests.yml`) |
| `local-ci/integration-tests` | `typecheck:hydi-v3`, `lint:hydi-v3`, `test:integration:jest` | `HYDI V3 Operational Integration Suite` (`integration-tests.yml`) |
| `local-ci/typecheck` | `npm run typecheck` | the pre-push hook's typecheck |

Each commit is tested in a throwaway `git worktree` with a clean `npm ci`,
so uncommitted local changes can't affect the result. Logs are written to
`<tmp>/hydi-local-ci/<short-sha>/`.

## Running it

On heidi-pc (or any machine with the repo cloned):

```bash
npm run ci:local                      # test HEAD and post statuses
npm run ci:local -- --pr 276          # test PR #276's current head
npm run ci:local -- --no-post         # test HEAD, don't report to GitHub
npm run ci:local -- --watch           # test every open same-repo PR head that
                                      # has no final local-ci result yet, then
                                      # re-check every 10 min (--interval N)
```

To keep the watcher running across reboots, run it under PM2 alongside the
rest of the fleet:

```bash
pm2 start scripts/local-ci.js --name hydi-local-ci -- --watch
pm2 save
```

**`local-ci/unit-tests` needs local Supabase running** (Docker Desktop up,
`supabase start`). 27 suites (`tests/migrations/**` and several
`heidi-*-qualification` suites) connect to Postgres on `127.0.0.1:54322`.
Without it they fail with `ECONNREFUSED`, and the status will be red.

## Token

Reads `GITHUB_TOKEN` or `GH_TOKEN`, else `gh auth token`. The token needs
**Commit statuses: write** on this repo (fine-grained token) or
`repo:status` (classic). It is only sent to `api.github.com` and is never
printed. Per `SECURITY_PROTOCOL.md`, set it without echoing it, e.g.
`gh auth login` once and let the script pick it up.

## Why not a self-hosted Actions runner?

This repository is **public**. A self-hosted runner executes the workflow
code of any pull request, including ones opened from forks, directly on
the host, and for heidi-pc that means production secrets and the local
data plane. GitHub advises against self-hosted runners on public repos for
exactly this reason. `local-ci` only ever tests commits whose head
branch lives in this repository: `--watch` skips fork PRs, and `--pr`
refuses them.

## Making it the merge gate

While the outage lasts, the Actions checks can never pass. In **Settings →
Branches → `clean-main` protection → Require status checks**, add
`local-ci/unit-tests`, `local-ci/integration-tests` and
`local-ci/typecheck` as required checks, and remove the Actions ones until
Actions works again. Anyone with push access can post a status, so this
gate is only as trustworthy as the machines and tokens allowed to post
them.

## Root cause (still open)

Public repositories get GitHub-hosted runner minutes free, so a spending
limit or used-up minutes can't explain the outage. Jobs that fail before
any runner is assigned on a public repo usually mean the **account is
locked**, typically by a failed payment or unpaid invoice. Check
<https://github.com/settings/billing> for a payment-failure banner. Once
Actions runs again, the Actions checks are the gate again, and this script
remains a way to verify locally.
