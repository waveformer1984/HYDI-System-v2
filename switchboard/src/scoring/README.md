# Switchboard — Scoring Engine

Evaluates a gig-app offer and produces a verdict (Strong Run / Okay Run /
Weak Run / Reject) with a plain-language explanation.

Not yet implemented. See `../../BUILD_PROMPT.md` section 5 ("Run
Scoring") for the full factor list and formula shape:

```
Score = weighted profitability + efficiency - delay - risk + zone bonus
```

- Primary signals: profit per hour, profit per mile (weighted highest).
- Inputs: payout, tip, miles, estimated time, wait time, pickup
  difficulty, store reliability, deadhead risk, zone quality, time of
  day, drop-off complexity.
- User-configurable minimum profit floor gates the verdict.

Open decision: whether this runs on-device (for overlay latency) or via
`../backend` — see `../../docs/ARCHITECTURE.md`.
