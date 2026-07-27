# Phase 26 — Daily Operator Loop

## Morning

1. **Start HYDI**
   - `npm run hydi:status` or `npm run cockpit`
   - HYDI loads persisted state, verifies the audit chain, and reports `READY` or `DEGRADED`.

2. **Review executive briefing**
   - Say `good morning` in the cockpit or run `npm run hydi:operator-demo`.
   - HYDI shows: status, completed work, attention items, recommended next action, strategic focus.

3. **Review risks**
   - Ask `what deserves my attention` or `what's blocking revenue`.
   - HYDI lists risks from signals: equipment offline, stale branches, overdue invoices, etc.

4. **Approve or reject actions**
   - Ask `show approvals`.
   - Ask `explain approval <id>` before deciding.
   - Say `approve <id>` or `reject <id>`.
   - HYDI records `action-approved`/`action-rejected` and `action-executed` audit entries.

### What is automatic

- Event ingestion from configured sensors.
- Business signal interpretation and memory updates.
- Recommendation generation and scoring.
- Autonomous actions (`create-report`, `run-tests`, `maintain-log`) execute without approval.

### What requires human approval

- Review-required actions (`update-markdown`, `draft-email`, `generate-proposal`, `organize-files`).
- Any action class without an explicit `autonomous` classification.
- Forbidden actions (`delete-file`, `send-email`, `commit-code`, `purchase`, `transfer-funds`) are rejected automatically and cannot be approved.

### What requires human measurement

- Confirming whether a recommendation achieved its expected outcome.
- Recording a numeric measured impact with provenance.
- Qualitative confirmations (`measured: false`) are recorded but cannot move learning confidence.

## Midday

1. **Review changes**
   - Ask `what changed`.
   - HYDI summarizes events since the last briefing.

2. **Check unresolved recommendations**
   - Ask `show approvals` or `outcome queue`.
   - HYDI lists pending approvals and recommendations awaiting measurement.

3. **Provide measurements**
   - Run `hydi outcome <recommendation-id> --result <successful|unsuccessful|unknown> --value <n> --source "..." --notes "..."`.
   - HYDI records the outcome and adjusts confidence only if the value is numeric and sourced.

## End of Day

1. **Review completed actions**
   - Ask `history` or `timeline`.
   - HYDI lists executed actions and approval decisions.

2. **Confirm outcomes**
   - Ask `outcome queue` for anything still awaiting measurement.
   - Record outcomes before close.

3. **Capture lessons**
   - Ask `learning` or `memory-review`.
   - HYDI shows recent confidence changes, measured outcomes, and lessons learned.

## Weekly

1. **Review strategic trends**
   - Ask `focus <priority>` to change the owner priority.
   - Ask `recommendations` for the full recommendation lifecycle.

2. **Confidence changes**
   - Ask `learning` for prediction accuracy, average confidence drift, and recent lessons.

3. **Recurring risks**
   - Ask `what's blocking revenue` or `what deserves my attention`.
   - Look for risks that appear repeatedly and consider policy or process changes.
