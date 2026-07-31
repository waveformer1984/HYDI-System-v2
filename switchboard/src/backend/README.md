# Switchboard — Backend

API for authentication, QR device pairing, role management, run/earnings/
expense logging, and the audit trail.

Not yet implemented. See `../../docs/DATA_MODEL.md` for the entities this
service owns and `../../docs/SAFETY_MODEL.md` for constraints that apply
to auth and pairing endpoints specifically.

Planned responsibilities:
- Auth (owner account, PIN/biometric-backed sessions)
- QR pairing issuance + device registration + role assignment
- Device/session revocation
- Audit logging (append-only)
- Run, offer, earnings, expense CRUD
- Shared-session (tag-team) coordination
- Savings-module (Upside, insurance) state
