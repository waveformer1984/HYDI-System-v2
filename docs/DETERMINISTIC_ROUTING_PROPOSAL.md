# Proposal: bounded paraphrases for deterministic read-only routing

Status: PROPOSAL — not deployed, not implemented. Model-driven tool selection
remains unresolved; this does not claim to fix it.

## Why

Five prompt/schema attempts could not make llama3.2:3b (or qwen2.5:3b,
qwen2.5-coder:1.5b) select `system_status` for phrasings like "run the system
report tool now" — the verb "run" anchors selection to `run_command` regardless
of negative rules, few-shot examples, schema boundaries, or tool ordering.
Evidence: `scripts/model-compare.js` + `scripts/order-test.js` runs on
2026-11-03 (results below).

The deterministic fast-path already handles exact whole-commands
(`system report`, `status report`, `health report`, `/status`, `full status`,
`fix list`, `memory ...`, `task ...`, `trace ...`). This proposal extends it to
a **bounded, explicit paraphrase set** — whole-command matching only, no
substring matching, no inference.

## Proposed grammar (exact, finite)

Read-only report/status intents only:

```
system report   ::= "run|get|show|give me|generate" [ "the" ] "system report" [ "tool"|"please"|"now" ]
system status   ::= "system status" | "status report" | "health report" | "health check" [ "please"|"now" ]
fix list        ::= "fix list" | "fixlist" | "fix-list" | "/fixlist" | "show the fix list"
```

Whole-utterance match after normalization (lowercase, collapse whitespace,
strip trailing punctuation). The utterance must match a pattern **completely** —
"run the system report tool now" matches pattern 1; "run the report and then
restart heidi-web" does NOT match (mixed intent → model path).

## Tool mapping (existing registered tools only)

| Pattern | Registered tool / existing renderer |
|---|---|
| system report / status family | `system_status` via `getSystemStatus()` + `formatSystemStatus()` — same governed path as today |
| fix list family | `.runtime/fixlist/current.json` via `formatFixList()` — unchanged |

No new tools, no aliases, no `systemreport` shell command, no allowlist change.

## Explicit non-matches (stay on the model path)

- "run git status" / "run npm test" — real shell requests
- "write me a report about the weather" — unrelated report
- "run the system report and then restart heidi-web" — mixed intent
- "restart the system report service" — mutating intent
- Anything with arguments beyond the bounded pattern

## Governance path (unchanged)

Request → existing `x-heidi-secret`/loopback auth → JSON validation →
normalized whole-command match → existing governed tool/status executor →
deterministic renderer → response. No new authorization surface; a matched
request does exactly what an exact-command request does today.

## Telemetry

Existing machinery already distinguishes: `model: "system-status"`,
`model: "fix-list"`, `model: "fast-path"` on done packets, plus
`chat_tools_terminal` records with `route: deterministic|model`. The paraphrase
set reuses `route: "deterministic"` and adds the matched pattern id to the
terminal record so paraphrase hits are distinguishable from exact commands.

## Tests required before implementation

- Each grammar pattern → correct tool, zero model calls (spy on brain client)
- Negative: explicit `run_command` requests still reach the model/run_command
- Mixed-intent utterances → model path
- Unauthenticated request → 403 before matching
- Tool failure → bounded honest error, no inference fallback
- One `chat_tools_terminal` record with the matched pattern id

## Rollback

Single commit revert of the matcher list; deterministic surface returns to the
exact-command set. No schema, auth, or runtime-config changes.

## Experiment evidence (preserved)

| Attempt | report_original | report_paraphrase | explicit_command | no_tool |
|---|---|---|---|---|
| Baseline prompt | run_command | — | — | — |
| + "system report" in system_status desc | run_command | run_command | run_command ✓ | none ✓ |
| + prompt rule ordering | run_command | run_command | run_command ✓ | none ✓ |
| + run_command negative boundary | timeout | run_command | run_command ✓ | none ✓ |
| + few-shot examples | run_command | run_command | run_command ✓ | none ✓ |
| schema reorder (ss last) | none | none | none ✗ | — |
| qwen2.5:3b (same prompt) | run_command | search_memory | run_command ✓ | search_memory ✗ |
| qwen2.5-coder:1.5b | none | — | — | — |

Conclusion: prompt-layer fixes falsified on every installed tools-capable
model. This proposal changes routing, not model behavior.
