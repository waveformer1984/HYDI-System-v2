# Switchboard Availability Calendar

## Purpose

The Availability Calendar lets performers define recurring weekly availability, add unavailable exceptions, and lets venues see if a candidate can work a given gig.

## Data Model

### Availability Profile

```json
{
  "id": "prof_xxx",
  "user_id": "user_123",
  "timezone": "America/Chicago",
  "weekly": {
    "monday": [{ "start": "09:00", "end": "17:00" }],
    "tuesday": [],
    "wednesday": [{ "start": "13:00", "end": "18:00" }]
  },
  "created_at": "2026-07-31T00:00:00.000Z"
}
```

### Availability Exception

```json
{
  "id": "exc_xxx",
  "user_id": "user_123",
  "start_time": "2026-08-15T00:00:00.000Z",
  "end_time": "2026-08-15T23:59:59.000Z",
  "reason": "Personal event",
  "created_at": "2026-07-31T00:00:00.000Z"
}
```

## Schema

- `availability_profiles` — one profile per user
- `availability_exceptions` — unavailability windows that override the weekly schedule
- Schema version `3`

## API Endpoints

```
GET    /availability/:userId
POST   /availability/:userId
POST   /availability/:userId/exceptions
PUT    /availability/:id          (exception)
DELETE /availability/:id          (exception)
GET    /availability/:userId/date/:date
GET    /availability/:userId/next
```

## Domain Events

- `availability.created`
- `availability.updated`
- `availability.deleted`
- `availability.exception_added`

## Slot Computation

`GET /availability/:userId/date/:date` returns the daily slots by:

1. Looking up the user's `weekly` schedule for the date's day-of-week.
2. Mapping `HH:MM` start/end times to that calendar date in UTC.
3. Removing any slot that overlaps an exception.

`GET /availability/:userId/next` scans the next 30 days and returns the first available slot.

## Frontend

Open `public/availability.html` from the main `index.html` link.

- Set a weekly schedule per day.
- Add unavailable exceptions.
- View the next available slot.
- Check slots for a specific date.

## Integration with Matching

The existing `availabilityScore()` in `src/scoring.js` uses explicit `availability` records. The new profile-driven slots are available through `getAvailabilityForDate()` and can be used by future scoring enhancements. The current phase focuses on calendar management, not scoring.

## Testing

Tests are in `tests/availability.test.js`:
- profile creation and retrieval
- invalid weekly schedule rejection
- slot computation for a date
- exception application
- next slot discovery
- event emission
- API endpoints
