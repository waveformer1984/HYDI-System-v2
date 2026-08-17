# Switchboard Moderation Console

## Purpose

The Moderation Console gives operators a single place to review, quarantine, release, and remove flagged content and users. It is the trust-management layer for the Switchboard marketplace.

## Architecture

```
Content Submission
      ↓
Safety Filter
      ↓
Moderation Case (repository.createModerationCase)
      ↓
Repository / Store
      ↓
EventBus (moderation.* events)
      ↓
Audit Log
```

All moderation state lives in the `moderation` table and is managed by `Repository` methods. The API does not touch the store directly.

## Data Model

```json
{
  "id": "mod_xxx",
  "targetType": "message|application|user|contract",
  "targetId": "xxx",
  "reason": "content flagged",
  "status": "flagged",
  "createdBy": "system",
  "createdAt": "2026-07-31T00:00:00Z",
  "reviewedBy": null,
  "reviewedAt": null,
  "notes": []
}
```

## Status Lifecycle

```
flagged
  ↓
quarantined
  ↓
reviewing
  ↓
released  |  removed  |  restricted
```

## Domain Events

- `moderation.created`
- `moderation.quarantined`
- `moderation.reviewing`
- `moderation.released`
- `moderation.removed`
- `moderation.note_added`
- `user.restricted`

## API Endpoints

```
GET    /moderation/queue
GET    /moderation/queue?status=quarantined
GET    /moderation/:id
POST   /moderation/:id/quarantine
POST   /moderation/:id/release
POST   /moderation/:id/remove
POST   /moderation/:id/notes
GET    /moderation/timeline
```

## Moderator Actions

### Quarantine

- Sets case status `quarantined`.
- Marks `messages` and `applications` with `quarantined: 1`.
- Emits `moderation.quarantined`.

### Release

- Sets case status `released`.
- Clears `quarantined` on `messages` and `applications`.
- Emits `moderation.released`.

### Remove

- Sets case status `removed`.
- Marks target `quarantined: 1`.
- Emits `moderation.removed`.

### Restrict

- For user-targeted cases, sets `restricted: 1` on the user.
- Emits `user.restricted`.

### Add Note

- Appends `{ author, text, at }` to `notes`.
- Emits `moderation.note_added`.

## Frontend

Open `public/moderation.html` or use the **Moderation** link in `public/index.html`.

## Operator Workflow

1. A message or application containing contact info is flagged automatically.
2. The case appears in the moderation queue.
3. An operator opens the case, reads the note, and chooses:
   - **Quarantine** — hold content until review
   - **Release** — clear the flag
   - **Remove** — keep content hidden
   - **Add Note** — record reasoning

## Safety Integration

- `safety.moderateContent()` detects phone numbers, emails, and references to external platforms.
- Flagged messages and applications trigger `repository.createModerationCase()` in `api.js`.
- Protected accounts and parent approval flows are unchanged.

## Testing

Tests are in `tests/moderation.test.js`:
- case creation
- queue filtering
- quarantine/release target updates
- event emission
- API endpoint behavior
