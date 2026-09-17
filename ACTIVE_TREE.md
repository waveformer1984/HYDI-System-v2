# This is the active HYDI tree

**Canonical path:** `C:\Users\Owner\HYDI-System-v2`
**Primary branch:** `clean-main` (not `main`)
**Stack:** Node.js / JavaScript. The executive layer lives in `src/hydi-v3/`.

> Updated 2026-09-16. This file previously pointed at `C:\Users\Owner\HYDI_System`
> as canonical. That was true once, but `HYDI_System` drifted: it's now stuck on
> branch `release/v0.9.0`, a month behind `clean-main` (last commit 2026-08-16 vs.
> this tree's 2026-09-15), and PM2's `ecosystem.config.js` has been supervising
> *this* tree (`HYDI-System-v2`) in production the whole time — confirmed via
> `pm2 describe <app> | grep "exec cwd"`, which showed every hydi-* process
> running from here. `HYDI_System` does carry real uncommitted local work (a
> `src/heidi-executive/*` autonomy/decision-engine layer, `docs/HEIDI_*` policy
> docs) that was never committed, pushed, or merged into `clean-main` — that
> still needs a deliberate review/port decision, it wasn't just discarded.

If you are an agent or a person and you found more than one directory called
`HYDI_System` or `HYDI-System-v2` on this machine, **this one
(`HYDI-System-v2`) is the live project**. Every other copy is an archive or a
stale worktree.

## How to confirm you are in the right place

All four must be true:

```bash
git rev-parse --is-inside-work-tree     # true — the live tree is under version control
git branch --show-current               # clean-main, or a branch based on it
ls src/hydi-v3/ExecutiveOperatingSystem.js
ls reports/business-os/                 # phase14b … phase20a reports present
```

For extra confidence when PM2 is running, this is the strongest signal —
it tells you which tree is *actually* live, not just which one looks right:

```bash
pm2 describe hydi-boot | grep "exec cwd"   # should be C:\Users\Owner\HYDI-System-v2
```

**If `git rev-parse` fails, you are in an archive copy. Stop.** Archives are not
version-controlled. A briefing that reports "missing git" is not telling you
something about the business — it is telling you the tool is in the wrong folder.

## Known decoys

- `C:\Users\Owner\_HYDI_ARCHIVE\<date>\HYDI_System` — dated snapshots. Read-only
  history. Never build here. A Python `HYDI_Executive` package was written into
  the `2026-07-11` snapshot by mistake in July 2026; it is a discarded spike and
  is not part of the system.
- `C:\Users\Owner\HYDI_System` — a separate live clone of this same GitHub repo,
  stuck on `release/v0.9.0` (a month stale) with uncommitted local work on top.
  Not an archive, not safe to delete casually, but not where PM2 runs from and
  not where new work should land until its uncommitted changes are reviewed and
  either ported here or explicitly discarded.

## Do not reimplement what already exists

The executive layer is complete and audited. Before building anything that
sounds like it belongs here, check whether it already exists:

| If you are about to build | It already exists as |
|---|---|
| A "good morning" executive briefing | `ExecutiveOperatingSystem.morningBriefing()` + `BriefingRenderer` |
| Priority ranking / a Resonate rule | `StrategicObjectives` — objectives are configuration, never hard-coded |
| Recommendations with reason, confidence, evidence | `TrustEngine` + `BusinessEvidenceEngine` |
| Natural-language operator questions | `ConversationEngine` + `ExecutiveCockpit` |
| A launcher / REPL | `scripts/operator-cli.js` (`npm run cockpit`) |
| Session state persistence | `OperatorSession` + the `data/*.json` stores |
| A sensor that observes something | `GitSensor` / `FilesystemMonitor` / `PrinterSensor` — copy the pattern |

Read `CLAUDE.md` and `src/hydi-v3/RUNBOOKS.md` before writing code. Runbooks 16
and 17 define the learning and evidence contracts.

**Adding a second implementation of any of the above — in any language — creates
a second source of truth. That is the specific thing this architecture is built
to avoid.**
