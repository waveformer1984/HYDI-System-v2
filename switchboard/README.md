# Switchboard

Secure gig-work copilot and operations dashboard for managing multiple
delivery platforms from one unified interface.

Switchboard is not a replacement for DoorDash, Favor, or any other gig
platform, and it does not automate, scrape, or bypass those platforms — it
is a decision-support and workflow layer that sits alongside them.

## Status

Early scaffolding. No application code yet. See `BUILD_PROMPT.md` for the
full product spec this scaffold is derived from.

## Layout

```
switchboard/
  BUILD_PROMPT.md   Full product spec / IDE build prompt
  docs/              Architecture, data model, and safety-model notes
  src/
    frontend/        Mobile app (dashboard + floating overlay)
    backend/         Auth, pairing, role management, logging API
    scoring/          Run scoring engine (payout/mile/hour evaluation)
    overlay/          Native floating overlay module
  tests/             Test suites, mirrored by src/ subdirectory
```

## Relationship to this repo

This currently lives inside `HYDI-System-v2` as a matter of convenience —
Switchboard is an unrelated product from HYDI/Heidi/ProtoForge and is
expected to move to its own repository once repo-creation access is
available. The layout above is deliberately structured so that move is a
straightforward `git subtree split` rather than a rewrite.

## Non-negotiable constraints

See `docs/SAFETY_MODEL.md`. In short: Switchboard must never create a
second concurrent login/session inside a parent gig app (Favor and
similar apps stay single-session, single-device, single-lead-user at all
times), never automate/scrape/bypass a parent app without that app's
explicit permission, and never share parent-app credentials via QR
pairing — QR pairing grants Switchboard access only.
