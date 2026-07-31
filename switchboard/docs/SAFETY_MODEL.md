# Switchboard — Parent-App Safety Model

This document is the non-negotiable constraint set from `BUILD_PROMPT.md`,
kept as its own file so it's easy to reference from code reviews and PRs
touching auth, pairing, or shared-session logic.

## Rules

1. Switchboard never automates, scrapes, clicks, or bypasses protections
   in a third-party gig app unless that app explicitly allows it.
2. No hidden bot behavior. No credential harvesting. No anonymous access.
3. No account sharing outside approved roles/devices.
4. No multi-user concurrent login inside parent apps (Favor and similar).
   A parent app must always see: **one live session, one device, one lead
   user, one session owner.**
5. Switchboard may coordinate people *around* a parent app (tag-team
   mode), but must never duplicate or mirror a parent-app login across
   devices.
6. If no official API exists for a platform, use manual entry or
   permitted integrations only — never reverse-engineered automation.
7. QR pairing grants Switchboard access only. It is never a mechanism for
   sharing parent-app credentials.
8. If a parent app has no built-in team-workflow support, Switchboard
   emulates collaboration only at its own layer (shared item lists, task
   notes, role assignments) — never by touching the parent app's session.
9. Only the designated lead shopper/driver account interacts with the
   parent app directly; helpers work inside Switchboard.

## Where this applies in the architecture

- **Pairing/auth (`src/backend`)**: QR pairing issues Switchboard session
  tokens scoped to a device + role. It must have no code path that stores
  or forwards parent-app credentials to a second device.
- **Tag-team mode (`src/backend`, `src/frontend`)**: `SharedSession` has
  exactly one lead user; helper `TaskAssignment`s never gain parent-app
  access, only Switchboard-layer visibility into the shared run.
- **Overlay (`src/overlay`)**: reads/displays offer and run data; it does
  not click, tap, or otherwise drive the underlying gig app's UI.

Any implementation change touching auth, pairing, or shared sessions
should be checked against this list before merging.
