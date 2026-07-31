# Switchboard — Architecture Notes

Derived from `BUILD_PROMPT.md`. This document tracks architectural
decisions as they're made; it starts as a restatement of the suggested
architecture until real implementation choices are locked in.

## Layers

- **Frontend** — mobile-first client (React Native or Flutter, TBD). Hosts
  the dashboard and the floating copilot overlay.
- **Overlay module** — native platform module for the movable
  floating widget / edge pop-up. Must never block the underlying gig app.
- **Backend API** — authentication, QR device pairing, role management,
  audit logging, run/earnings/expense tracking.
- **Scoring engine** — evaluates offers (payout, tip, miles, time, wait,
  pickup difficulty, store reliability, deadhead risk, zone quality, time
  of day, drop-off complexity) into a verdict + plain-language
  explanation. Runs client-side or via the backend API — TBD based on
  latency requirements for the overlay.
- **Database** — PostgreSQL (or equivalent), holding the data model
  described in `DATA_MODEL.md`.
- **Notification system** — alerts and reminders (run scoring alerts,
  session/device changes, savings-module reminders).

## Open decisions

- React Native vs Flutter for the frontend.
- Where the scoring engine runs (on-device vs backend) — overlay latency
  budget should drive this.
- Auth/session token storage mechanism (platform secure storage vs
  backend-issued short-lived tokens).

## Cross-cutting constraint

Every layer must respect the parent-app safety model
(`SAFETY_MODEL.md`): no layer may create a second session inside a parent
gig app, and no layer may automate a parent app beyond what that app
explicitly permits.
