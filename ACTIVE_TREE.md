# This is the active HYDI tree

**Canonical path:** `C:\Users\Owner\HYDI_System`
**Primary branch:** `clean-main` (not `main`)
**Stack:** Node.js / JavaScript. The executive layer lives in `src/hydi-v3/`.

If you are an agent or a person and you found more than one directory called
`HYDI_System` on this machine, **this one is the live project**. Every other copy
is an archive or a stale worktree.

## How to confirm you are in the right place

All four must be true:

```bash
git rev-parse --is-inside-work-tree     # true — the live tree is under version control
git branch --show-current               # clean-main, or a branch based on it
ls src/hydi-v3/ExecutiveOperatingSystem.js
ls reports/business-os/                 # phase14b … phase20a reports present
```

**If `git rev-parse` fails, you are in an archive copy. Stop.** Archives are not
version-controlled. A briefing that reports "missing git" is not telling you
something about the business — it is telling you the tool is in the wrong folder.

## Known decoys

- `C:\Users\Owner\_HYDI_ARCHIVE\<date>\HYDI_System` — dated snapshots. Read-only
  history. Never build here. A Python `HYDI_Executive` package was written into
  the `2026-07-11` snapshot by mistake in July 2026; it is a discarded spike and
  is not part of the system.

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
