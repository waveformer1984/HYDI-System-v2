# Switchboard — Data Model

Entities from `BUILD_PROMPT.md`, expanded with expected relationships.
Field lists are indicative, not final schema — final schema belongs in
`src/backend` migrations once implementation starts.

| Entity | Purpose | Key relationships |
|---|---|---|
| `User` | Owner or partner account | has one `Role`, many `Device`s |
| `Role` | owner / partner / helper / limited collaborator | assigned to a `User` per pairing |
| `Device` | A paired physical device | belongs to a `User`, has `SessionToken`s |
| `SessionToken` | Active/expired auth session | belongs to a `Device`, appears in `AuditLog` |
| `AppAccount` | A connected gig platform account (DoorDash, Favor, ...) | belongs to a `User`, has many `Run`s |
| `Run` | A completed or in-progress delivery/shop task | belongs to an `AppAccount`, has one `Offer`/`Score`, many `EarningsEntry`/`ExpenseEntry` |
| `Offer` | The raw offer data evaluated before acceptance | produces one `Score` |
| `Score` | Scoring engine verdict + explanation for an `Offer` | belongs to an `Offer` |
| `Zone` | A geographic delivery zone with quality rating | referenced by `Run`, `Offer` |
| `StoreNote` | User notes on a specific store's reliability | referenced by `Run`, `Offer` |
| `SharedSession` | A tag-team session pairing lead + helper | has many `TaskAssignment`s, references one `Run` |
| `TaskAssignment` | A role (shopper/navigator/bagger/communicator/recorder) within a `SharedSession` | belongs to a `SharedSession` and a `User` |
| `EarningsEntry` | A recorded earnings line item | belongs to a `Run` |
| `ExpenseEntry` | A recorded expense (fuel, maintenance, tolls, ...) | belongs to a `Run` or standalone by date |
| `SavingsModule` | Upside / insurance module state | belongs to a `User` |
| `AuditLog` | Immutable record of login, pairing, revocation, role changes | references `User`, `Device`, `SessionToken` |

## Notes

- `AuditLog` should be append-only, matching the audit-trail requirement
  in the spec (login, pairing, revocation, role changes must all be
  logged).
- `SharedSession` must enforce single-lead-ownership at the schema level
  (one `lead_user_id`, not a set) to keep the "obvious who owns final
  completion" requirement enforceable, not just a UI convention.
- `AppAccount` intentionally does not store parent-app credentials for
  QR-paired helper devices — only the lead device's `AppAccount` connects
  to the parent app itself, per the safety model.
