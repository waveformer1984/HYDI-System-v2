# Switchboard Domain Events

## Overview

Switchboard emits domain events for every state-changing operation. These events are the authoritative contract between Switchboard and external consumers such as HYDI. All event consumers are read-only; they may not mutate Switchboard state.

## Guarantees

- **At least once** delivery per transport.
- **Deterministic order** within a single process run.
- **No state mutation** by listeners.
- **Versioned payloads** within `meta.version`.

## Event envelope

```json
{
  "id": "uuid",
  "type": "gig.created",
  "payload": { ... },
  "meta": { "version": 1 },
  "createdAt": "2026-07-31T00:00:00Z"
}
```

## Events

### `gig.created`

- **Producer:** `repository.createGig()`
- **When:** A new gig is posted.
- **Payload:** The full gig object (skills as JSON string).

### `gig.filled`

- **Producer:** `repository.acceptApplication()`
- **When:** A gig is filled by accepting an application.
- **Payload:** The updated gig with `status: 'filled'`.

### `user.created`

- **Producer:** `repository.createUser()`
- **When:** A user account is created.
- **Payload:** The public user object (no `password_hash`).

### `user.updated`

- **Producer:** `repository.updateUser()`
- **When:** A user profile is updated.
- **Payload:** The updated public user object.

### `user.parent_approved`

- **Producer:** `repository.approveParent()`
- **When:** A parent email approves a protected account.
- **Payload:** The updated public user object with `parent_approved: true`.

### `application.submitted`

- **Producer:** `repository.createApplication()`
- **When:** A performer applies to a gig.
- **Payload:** The application record.

### `application.accepted`

- **Producer:** `repository.acceptApplication()`
- **When:** A venue accepts an application.
- **Payload:** The updated application with `status: 'approved'`.

### `application.rejected`

- **Producer:** `repository.declineApplication()`
- **When:** A venue rejects an application.
- **Payload:** The updated application with `status: 'rejected'`.

### `application.parent_approved`

- **Producer:** `repository.approveParent()`
- **When:** A protected user's pending application is cleared for review.
- **Payload:** The updated application with `status: 'pending'` and `parent_approved: 1`.

### `contract.created`

- **Producer:** `repository.createContract()`, `repository.acceptApplication()`
- **When:** A contract is created for an accepted application.
- **Payload:** The contract record.

### `contract.signed`

- **Producer:** `repository.signContract()`
- **When:** A party signs a contract.
- **Payload:** The contract record. Status becomes `signed` once both parties have signed.

### `contract.completed`

- **Producer:** `repository.completeContract()`
- **When:** A signed contract is marked completed.
- **Payload:** The contract record with `status: 'completed'`.

### `contract.status_changed`

- **Producer:** `repository.updateContractStatus()`
- **When:** A contract status is changed manually.
- **Payload:** The contract record.

### `payment.created`

- **Producer:** `repository.createPayment()`
- **When:** A payment is recorded for a contract.
- **Payload:** The payment record with `status: 'pending'`.

### `payment.released`

- **Producer:** `repository.releasePayment()`
- **When:** A payment is released/completed.
- **Payload:** The payment record with `status: 'completed'`.

### `rating.created`

- **Producer:** `repository.createRating()`
- **When:** A rating is submitted for a completed contract.
- **Payload:** The rating record.

### `message.sent`

- **Producer:** `repository.createMessage()`
- **When:** A message is sent between users.
- **Payload:** The message record, including `quarantined` flag.

### `database.imported`

- **Producer:** `repository.import()`
- **When:** A full database import is performed via sync.
- **Payload:** `{ tables: [...] }`

### `moderation.created`

- **Producer:** `repository.createModerationCase()`
- **When:** A message or application is flagged by the safety filter.
- **Payload:** The moderation case record.

### `moderation.quarantined`

- **Producer:** `repository.updateModerationStatus()`
- **When:** A moderator quarantines a flagged case.
- **Payload:** `{ caseId, status: 'quarantined', reviewedBy }`

### `moderation.reviewing`

- **Producer:** `repository.updateModerationStatus()`
- **When:** A moderator begins review.
- **Payload:** `{ caseId, status: 'reviewing', reviewedBy }`

### `moderation.released`

- **Producer:** `repository.updateModerationStatus()`
- **When:** A moderator releases content from quarantine.
- **Payload:** `{ caseId, status: 'released', reviewedBy }`

### `moderation.removed`

- **Producer:** `repository.updateModerationStatus()`
- **When:** A moderator removes flagged content.
- **Payload:** `{ caseId, status: 'removed', reviewedBy }`

### `moderation.note_added`

- **Producer:** `repository.addModeratorNote()`
- **When:** A moderator adds a note to a case.
- **Payload:** `{ caseId, author }`

### `user.restricted`

- **Producer:** `repository.applyModerationAction()`
- **When:** A user is restricted by a moderator.
- **Payload:** `{ userId }`

### `availability.created`

- **Producer:** `repository.createAvailabilityProfile()`
- **When:** A user creates or replaces their weekly availability profile.
- **Payload:** The availability profile record.

### `availability.updated`

- **Producer:** `repository.updateAvailabilityProfile()`
- **When:** A user's availability profile is updated.
- **Payload:** The updated availability profile.

### `availability.deleted`

- **Producer:** `repository.deleteAvailabilityProfile()` / `repository.deleteAvailabilityException()`
- **When:** A profile or exception is removed.
- **Payload:** `{ profileId or exceptionId, user_id }`.

### `availability.exception_added`

- **Producer:** `repository.createAvailabilityException()`
- **When:** A user adds an unavailability exception.
- **Payload:** The exception record.

## Reserved events

Future events not yet wired:

- `user.banned`

## HYDI Forwarding

All domain events are candidates for optional HYDI forwarding. When `EVENT_TRANSPORT=hydi` and `HYDI_ENDPOINT` are configured, `HydiAdapter` translates each emitted event into a HYDI capability envelope and POSTs it to HYDI. Events are queued locally if HYDI is unreachable. See `docs/HYDI_INTEGRATION.md` for the capability contract.
