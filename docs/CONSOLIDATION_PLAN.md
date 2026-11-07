# Consolidation Plan — HYDI folder sprawl on Frank

Phase 1 deliverable. Built from `scripts/frank/inventory.ps1` output
(`hydi-inventory-latest/inventory.json`, 2026-11-07): 57 folders,
36 git repos, 27 PM2 apps. Every "ahead" count is commits not in
`origin/clean-main`; squash-merged PRs leave their original commits
"ahead" even though the content already shipped — each candidate below
was checked against clean-main's log before recommending.

## Recommendation key

- **canonical** — the one true tree. PM2 runs it.
- **salvage-PR** — unmerged work worth a `salvage/<folder>` PR.
- **merge-then-archive** — unique commits exist but are superseded or
  low-value; archive after Jordan confirms.
- **archive** — no unique work (empty, fully merged, or stale clone).
- **keep** — data/logs/config, not code; do not archive.

## Git repos

| Folder | Branch | Dirty | Ahead | Verdict | Reason |
|---|---|---|---|---|---|
| `HYDI-System-v2` | clean-main | yes* | 0 | **canonical** | PM2 cwd for all 26 apps. *dirty = uncommitted ursula route fix + untracked instrumentation (PR #517 carries the committed version). |
| `HYDI_System` | salvage/hydi-system-executive-2026-10-23 | yes (cache files only) | 63 | merge-then-archive | Stale `release/v0.9.0` clone per CLAUDE.md. The 63 heidi-executive commits are already pushed as `origin/salvage/hydi-system-executive-2026-10-23`; local dirt is dashboard-poller cache JSON only. Review that salvage branch for the autonomy-layer overlap, then archive the folder. |
| `protoforgesite` | hydi-work | yes | n/a | keep (Jordan decision) | Separate repo (own remote?), 1.1 GB, dirty. Looks like the ProtoForge marketing site — not part of the PM2 stack. Needs its own remote/CI check before any archive. |
| `HYDI-Remediation` | release/v0.9.0-rc.4 | yes | 19 | merge-then-archive | August release-candidate branch, 317 behind. Worktree of canonical. Confirm nothing unique is wanted, then archive. |
| `hydi-ctl-plane` | fix/chat-control-plane | no | 1 | active PR | PR #516 open (chat control-plane auth gate). Worktree stays until merge. |
| `hydi-prov-gaps` | fix/runtime-provenance-gaps | no | 1 | active PR | PR #517 open (provenance gaps). |
| `hydi-phase0` | docs/phase-0-ground-truth | no | 1 | active PR | PR #518 open (Phase 0 docs). |
| `hydi-wt-proto` | feat/proto-yi-workspace | no | 2 | **salvage-PR** | NOT in clean-main: Proto.I.Y workspace on :3010, PM2 entry, portfolio wiring, retires Ursula `/protoi` mock, dep-health test. Directly serves Phase 8 workspaces. Branch exists on origin → open PR from it. |
| `hydi-wt-cleanup` | chore/post-466-cleanup | yes | 1 | salvage-PR | Commit deletes stray `cm.txt`/`commitmsg.txt` (still in clean-main HEAD); dirty tree also carries `.ports.json` supabase-rest fix (already in PR #518) + `moderation.html` :3001→:3018 fix. Recreate the two remaining fixes in a small PR rather than merging the stale branch. |
| `hydi-wt-npmfix` | fix/spawn-deadline-tree | no | 10 | archive | Content shipped via #504/#508/#509/#511 (executor deadline, npm-cli adapter, sweep). Ahead-count is pre-squash originals. |
| `hydi-wt-taskroute` | feat/task-intent-tests | no | 5 | archive | Shipped via #502. |
| `hydi-wt-tail` | fix/mission-output-tail | no | 2 | archive | Shipped via #507. |
| `hydi-wt-otime` | feat/ollama-provider-timing | no | 1 | archive | Shipped via #498. |
| `hydi-wt-bootfix` | fix/mission-boot-interrupt | no | 1 | archive | Shipped via #512. |
| `hydi-wt-dlfix` | feat/deadline-fixture | no | 1 | archive | Shipped via #513. |
| `hydi-wt-ops` | feat/heidi-ops-agent | no | 2 | active PR | PR #515 open. |
| `HYDI-spine-pr1..pr4` | heidi/evidence-spine-pr* | no | 4–9 | archive | Integration branches; content shipped via #336/#338–#341. |
| `HYDI-spine-pr5` | heidi/rls-revenue-hardening | no | 2 | archive | RLS fix shipped via #343. |
| `hydi-dev` | fix/audit-live-hardening | no | 0 | archive | Fully merged. |
| `hydi-ursula-build` | fix/ursula-apps-route-params | yes* | 0 | archive | ahead=0; dirty = same route.ts fix now committed on PR #517. *verify dirt is only that file before archiving. |
| `hydi-wt-b3` | feat/hydi-schedulers | no | 0 | archive | Merged (hydi-schedulers live in PM2). |
| `hydi-wt-fl-after` | fix/fix-list-after-alerts | no | 0 | archive | Merged. |
| `hydi-wt-guard2` | chore/guard-remaining-pm2-scripts | no | 0 | archive | Merged. |
| `hydi-wt-inbox` | feat/decision-inbox | no | 0 | archive | Merged. |
| `hydi-wt-launcher` | feat/ollama-serve-launcher | no | 0 | archive | Merged. |
| `hydi-wt-loop` | feat/chat-tools-loop-timing | no | 0 | archive | Merged. |
| `hydi-wt-ollama` | fix/ollama-serve-env | no | 0 | archive | Merged via #488. |
| `hydi-wt-phases` | feat/chat-tools-phases | no | 0 | archive | Merged. |
| `hydi-wt-pilot` | fix/restart-module-pid0 | no | 0 | archive | Merged. |
| `hydi-wt-sel` | fix/tool-select-report | no | 0 | archive | Merged. |
| `hydi-wt-term` | feat/chat-tools-terminal | no | 0 | archive | Merged. |
| `hydi-wt-ursula1` | feat/ursula-portfolio-p1 | no | 0 | archive | Merged. |

## Non-git folders

| Folder | Size | Verdict | Reason |
|---|---|---|---|
| `HYDI_Backups` | 1.1 GB | keep | Backup data, not code. |
| `HYDI_Vault` | 0.2 MB | keep | Vault/secrets-adjacent — Jordan-managed. |
| `HYDI-TailNet` | 49 MB | keep | Tailscale setup artifacts (Phase 6/7 input). |
| `hydi-logs` | 56 MB | keep | Log output dir referenced by `start-heidi-everything.ps1`. |
| `.hydi`, `HY`, `hydi-dev-doctor`, `hydi-evolution`, `HYDI-kong-heal`, `HYDI-WIP-SAFETY`, `HYDI_CORE`, `HYPDI_System`, `hydi-wt-deps`, `hydi-wt-rezonate`, `hydi-wt-salvage`, `hydi-wt-state`, `hydi-wt-vercel`, `hydi-wt-vercel-exit`, `protoforge-applications`, `HYDI_Governance_Audit_20260724` | ≤2 MB each | archive (after Jordan eyeball) | Empty or near-empty husks — no git, no content. `HYDI_Governance_Audit_20260724` is a dated audit export; keep or archive per Jordan. |

## Salvage PRs to open

1. **`salvage/proto-yi-workspace`** — PR directly from existing origin branch
   `feat/proto-yi-workspace` (2 commits, not merged). Verify it still
   applies to current clean-main (branch is 80 behind; may need rebase).
2. **`salvage/post-466-cleanup`** — small fresh PR: delete `cm.txt`,
   `commitmsg.txt`; `moderation.html` fallback :3001→:3018. (The
   `.ports.json` part already shipped in PR #518.)

## Git hygiene findings

- `claude/local-mobile-chat-app-c3UBW` — **does not exist locally**; only
  `origin/archive/origin-claude-local-mobile-chat-app-c3UBW` (already
  archived remotely). Nothing to stash. Discrepancy closed.
- Default branch confirmed: `clean-main` (remote HEAD).
- Branching model (to document in CONTRIBUTING.md — Phase 2 PR):
  `clean-main` is the integration branch; PM2 runs it; work happens in
  `hydi-wt-*`/`hydi-*` worktrees on `fix|feat|chore|docs/*` branches,
  squash-merged via PR. Worktrees are disposable once their PR merges.

## Archive procedure (Jordan-approved list → dry-run → execute)

1. Jordan reviews this plan, edits the approve list.
2. `scripts/frank/archive-folders.ps1 -ApprovedList approved.txt` → dry run.
3. Verify dry-run output matches plan; re-run with `-Execute`.
4. Script moves folders to `~\HYDI_Archive\<date>\`, prunes worktree
   registrations in the canonical repo, logs to `archive-log.jsonl`.
   Nothing is deleted.
