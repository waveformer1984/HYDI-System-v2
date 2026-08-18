# Contributing to HYDI System v2

## First-time contributors

Look for issues labelled **`good first issue`** — these are scoped to a single module, have clear acceptance criteria, and do not require deep knowledge of the event pipeline. Leave a comment before starting so duplicate work is avoided.

For larger changes, open a draft PR early (even with just a description) so the approach can be validated before significant effort is invested.

## Before You Start

- Read `CLAUDE.md` for architecture overview and module reference.
- Read `AGENTS.md` for the constraint checklist every contributor must respect.
- The primary branch is **`clean-main`** — not `main`. All PRs target `clean-main`.
- Node >= 20 is required (`"engines": { "node": ">=20.x" }` in `package.json`).

## Setup

```bash
git clone https://github.com/waveformer1984/HYDI-System-v2.git
cd HYDI-System-v2
npm install
```

Environment variables are not committed. See the **Environment Variables** table in `CLAUDE.md` and provision them before running the dev server or integration tests.

## Branch Strategy

```
clean-main  ←  feature/<short-name>
            ←  fix/<short-name>
            ←  docs/<short-name>
```

- Branch from `clean-main`, not from another feature branch.
- Keep branches short-lived; open a PR as soon as the first meaningful commit lands.
- **Merge or delete promptly.** Fix and feature branches should be merged to `clean-main` via PR within a few days, or deleted if abandoned. Don't leave work stranded on an orphan branch — if a branch has been inactive for more than two weeks, it should either be merged, rebased, or deleted. Stale branches cause confusion about which code is authoritative and lead to duplicate or divergent work.

## Making Changes

### Checklist before opening a PR

- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm test` passes (Jest unit tests)
- [ ] Coverage is not decreased (Codecov comment will appear on the PR)
- [ ] No secrets are present in any file — see [Secret Handling](#secret-handling)
- [ ] If you added a new `supabase/migrations/*.sql` file, a corresponding test exists in `tests/migrations/<version>.test.js`
- [ ] If you changed an enum or state transition, `STATE_MACHINE_APPROVED` appears in the PR description
- [ ] New workers are registered in `workers/WorkerOrchestrator.js`

### Running tests

```bash
npm test                       # Jest unit tests (tests/unit/)
npm run test:coverage          # with coverage report
npm run typecheck              # TypeScript check
npm run test:integration       # adversarial tests — requires live SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
```

Run a single file or test name:

```bash
npx jest tests/unit/heidi-core-loop.test.js
npx jest --testNamePattern="should classify events"
```

### Code style

- **TypeScript strict mode** — `next.config.js` does not suppress errors. Fix every error you introduce.
- Catch variables are `unknown` — always guard: `error instanceof Error ? error.message : 'Unknown error'`
- `api/` files use ESM (`export default async function handler`). `kilo/index.js` uses CommonJS. Deno Edge Functions use pure ESM. Be consistent within a file.
- `SUPABASE_SERVICE_ROLE_KEY` is server-side only — never expose it to the client or logs.

### Architecture constraints

The six-layer event pipeline must be respected:

```
[1] Ingestion → [2] RAW LEDGER → [3] CASCADE → [4] KILO → [5] ProtoForge → [6] Emission
```

- **KILO must never execute actions.** `execute()` throws unconditionally by design.
- **The Emission layer must contain no logic** — no conditionals, no state mutations.
- **The PolicyEngine default is `'reject'`** — do not change it to anything permissive.
- **Both cooldown windows are mandatory** (2-minute startup, 30-second drift observation).

### Database migrations

Every new `.sql` migration in `supabase/migrations/` requires:
1. A corresponding test in `tests/migrations/<version>.test.js`
2. `STATE_MACHINE_APPROVED` in the PR description if it changes enums or state transitions
3. `search_path` pinned on any `SECURITY DEFINER` function
4. RLS enabled on any new table

Files ending in `.sql.skip` are intentionally excluded from the migration runner — do not run them.

Run `./verify-supabase.sh` after applying migrations locally to confirm Supabase connectivity and key table state before opening the PR.

## Secret Handling

Per `SECURITY_PROTOCOL.md`: secrets must never be displayed, echoed, logged, or pasted. Use direct injection:

```bash
# Generate and inject without ever seeing the value
node -e "require('crypto').randomBytes(32).toString('hex')" | vercel env add SECRET_NAME

# Verify presence only
vercel env ls | grep SECRET_NAME
```

## Opening a Pull Request

Use the PR template (`.github/PULL_REQUEST_TEMPLATE.md`). Fill in:

- **Summary** — one sentence describing what the PR does
- **Context** — issue reference (`Closes #N`) if applicable
- **Subsystems affected** — check the relevant boxes (HeidiOrchestrator, HybridModelStack, etc.)
- **Testing** — confirm unit tests pass, describe any manual verification
- **Checklist** — no secrets, no coverage decrease, no breaking changes (or documented)

Add `STATE_MACHINE_APPROVED` to the PR description body if you changed any database enum or allowed state transition.

## CI

Two workflows run on every PR:

| Workflow | What it checks |
|----------|----------------|
| `unit-tests.yml` | `npm test -- --coverage --forceExit`; uploads coverage to Codecov |
| `hdi-governance-gate.yml` | Triggers on changes to `supabase/migrations/**` — 7-gate schema review including adversarial tests and replay fidelity |

`health-monitor.yml` and `codeql.yml` run on a schedule and are not gated on PRs.

Both `npm run typecheck` and `npm test` must pass before a PR can be merged. Coverage must not decrease.

## Reporting Issues

Use the issue templates in `.github/ISSUE_TEMPLATE/`:

- **Bug report** — include Node version, OS, branch/commit, reproduction steps, and logs.
- **Feature request** — describe the problem, proposed solution, affected subsystem, and acceptance criteria.

## Changelog

The `CHANGELOG.md` is maintained by the project maintainer and updated at release time. Contributors do not need to update it — describe your changes clearly in the PR description and commit messages instead.

## Questions

Open a discussion or a draft PR. Tag the relevant subsystem in the title (e.g., `[KILO]`, `[ProtoForge]`, `[Stripe]`).

## See also

| Document | Purpose |
|----------|---------|
| [`CLAUDE.md`](CLAUDE.md) | Full architecture reference for AI-assisted development |
| [`SUPPORT.md`](SUPPORT.md) | Help channels and diagnostics guide |
| [`GOVERNANCE.md`](GOVERNANCE.md) | Decision-making process and maintainer responsibilities |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | Community standards and enforcement |
| [`SECURITY_PROTOCOL.md`](SECURITY_PROTOCOL.md) | Secret handling and security procedures |
