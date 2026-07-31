# Switchboard — Floating Overlay

Native platform module for the movable floating widget / edge pop-up
copilot that displays run score, payout estimate, miles, estimated
minutes, and recommendation, with Accept / Decline / Pause / Next App /
Complete actions.

Not yet implemented.

Constraints (see `../../docs/SAFETY_MODEL.md`):
- Must never block the underlying gig app's native UI.
- Displays/reads offer and run data only — never clicks, taps, or
  otherwise drives the underlying gig app.

Planned behaviors: drag, pin, hide, expand; subtle alerts, sounds,
haptics.
