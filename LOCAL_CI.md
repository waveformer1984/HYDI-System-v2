# Local CI (workaround for the GitHub Actions outage)

GitHub will not start any Actions job for this repo: every job fails
within seconds with `runner_id: 0` and the annotation *"The job was not
started because your account is locked due to a billing issue"*
(`ROADMAP.md` P0 #2e), so red Actions checks carry no information.
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
npm run ci:local -- --watch --include-main
                                      # same, plus clean-main's head whenever it
                                      # has no final local-ci result (i.e. after
                                      # every merge)
```

A head with a final result for all three checks (pass or fail) is not
tested again. A head whose latest status is still `pending`, from an
interrupted run, is tested again. Runs are sequential: one commit at a time,
`clean-main` first.

## Keeping it running (PM2)

On heidi-pc, run the watcher as its own PM2 app alongside the fleet. It is
deliberately **not** in `ecosystem.config.js`, so `pm2 start
ecosystem.config.js` and the boot agent never start CI runs on their own.

**1. Prerequisites**, once, as the Windows user PM2 runs as (`Owner`):

* Run `npm install` in the repo.
* Run `gh auth login`. The watcher reads the token at run time via `gh auth
  token`.
* Docker Desktop up and `npx supabase start` (see the next section).

**Do not** put `GITHUB_TOKEN`/`GH_TOKEN` in the user environment or the
shell you start PM2 from. PM2 copies the daemon's whole environment into
each app, and `pm2 save` writes it to `%USERPROFILE%\.pm2\dump.pm2` in
plaintext (`docs/security/PM2_SECRET_EXPOSURE_REMEDIATION.md`). With `gh
auth login` no token ever enters that environment.

**2. Start it** from the repo root:

```powershell
pm2 start scripts/local-ci.js --name hydi-local-ci -- --watch --include-main --interval 10
pm2 save
```

`pm2 save` adds it to the process list that the `PM2Resurrect` scheduled
task replays at logon, so the watcher comes back after a reboot. (On Linux
or macOS, `pm2 startup` installs the equivalent boot service.)

**3. Check it:**

```powershell
pm2 status hydi-local-ci
pm2 logs hydi-local-ci --lines 50     # one [local-ci] line per commit tested and per check result
```

Full per-check logs are in `%TEMP%\hydi-local-ci\<short-sha>\`. Results show
on each commit and PR as `local-ci/unit-tests`, `local-ci/integration-tests`
and `local-ci/typecheck`.

**Operating it:**

* **Stop:** `pm2 stop hydi-local-ci`.
* **Remove:** `pm2 delete hydi-local-ci && pm2 save`.
* **After pulling a new `scripts/local-ci.js`:** run `pm2 restart
  hydi-local-ci`, since PM2 keeps the old code loaded.
* **Re-test a commit:** delete nothing. Run `npm run ci:local -- <sha>`
  (or `--pr N`) by hand; the new statuses supersede the old ones.

**`local-ci/unit-tests` needs local Supabase running** (Docker Desktop up,
`supabase start`). 27 suites (`tests/migrations/**` and several
`heidi-*-qualification` suites) connect to Postgres on `127.0.0.1:54322`.
Without it they fail with `ECONNREFUSED`, and the status will be red.
`local-ci` reads the running stack with `npx supabase status -o env` and
passes the unit check the same variables `unit-tests.yml` exports
(`SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_ANON_KEY`). The throwaway worktree has no `.env.local`, so a
watcher started under PM2 needs no extra configuration. It never starts or
stops Supabase, since on heidi-pc that is the live stack, and it never
logs the keys. A `SUPABASE_URL` you set yourself takes precedence.

## Token

Reads `GITHUB_TOKEN` or `GH_TOKEN`, else `gh auth token`. The token needs
**Commit statuses: write** on this repo (fine-grained token) or
`repo:status` (classic). It is only sent to `api.github.com` and is never
printed. Per `SECURITY_PROTOCOL.md`, set it without echoing it, e.g.
`gh auth login` once and let the script pick it up. Under PM2, always use
`gh auth login` rather than an environment variable (see above).

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

## Root cause (confirmed 2026-09-27)

GitHub's own check-run annotation on every failed job reads *"The job was
not started because your account is locked due to a billing issue."* It
goes back to the oldest run on record (2026-05-15). Dependabot jobs still
run on GitHub's runners, so only this account's own workflows are refused.
Clear the lock at <https://github.com/settings/billing> (payment method,
failed or past-due invoice), or open a GitHub Support billing ticket if
nothing shows as outstanding. See `ROADMAP.md` P0 #2e for the job IDs to
quote. Once Actions runs again, the Actions checks are the gate again, and
this script remains a way to verify locally.
