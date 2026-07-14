# Archived: orphaned agents/specialized/* HTTP agents

Moved here 2026-07-14, Phase 0 of `HYDI_KERNEL_ARCHITECTURE_ROADMAP.md`, after
a dedicated review of the `agents/specialized/` island (see the roadmap doc
and `archive/heidi-v2-dormant-pipeline/README.md` for context on the sibling
files that were NOT moved).

`command-center.js`, `deployment-manager.js`, and `operator-agent.js` are
each standalone, self-starting Express HTTP agents (they `listen()`
immediately when run directly). Despite doc-comments implying they call each
other and other agents, a repo-wide grep for requiring references to each
filename returned zero hits anywhere — not from `protoforge-main.js`'s
chain, not from `ecosystem.config.js` (which lists `heidi`, `hydi-processor`,
`hydi-protoforge`, `ursula-agent`, `ursula-frontend` — none of these three),
not from `agents/ursula/ursula.js` (which loads a different, same-named
`modules/deployment-manager.js`, not this file), and not from any test or
manual diagnostic script. They were runnable only by a human typing
`node agents/specialized/<file>.js` directly.

Unlike the rest of the `agents/specialized/` roster (`agent-factory.js`,
`business-agents.js`, `execution-agents.js`, `workflow-agent.js`,
`security-agent.js`), which is PM2-deployed in practice via `protoforge-main.js`
and left untouched pending an ops decision, these three had no reachability
from anything at all, so archiving them carries no deployment risk.
