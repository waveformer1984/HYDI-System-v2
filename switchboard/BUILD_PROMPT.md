# Switchboard — Build Prompt

## Goal
Build a local-first, end-to-end MVP that lets performers discover gigs, apply to them, communicate with venues, and receive deterministic match rankings.

## Core Entities

- **User** — performer or venue representative. Has roles, age bracket, skills, location, safety status.
- **Venue** — gig host; linked to a user account.
- **Gig** — a posted event with required skills, schedule, location, budget, age restrictions.
- **Application** — a performer's expression of interest in a gig.
- **Message** — chat between two users.
- **Contract** — confirmed agreement between venue and performer.
- **Payment** — local payment record.
- **Rating** — mutual rating after a gig.
- **Availability** — time windows a user is free.

## Scoring Engine

The scoring engine is deterministic, explainable, and requires no AI.

### Match score (`user` for a `gig`)

Each factor returns a value in `0..1`, multiplied by a weight. Weights sum to `1.0`.

| Factor | Weight | Description |
|--------|--------|-------------|
| skill_match | 0.30 | Jaccard overlap of user skills and gig required skills. Empty skill sets = 0. |
| availability | 0.20 | 1.0 if any user availability window fully contains the gig window; 0.5 if overlaps partially; 0.0 if no overlap or missing data. |
| location | 0.15 | 1.0 if user/venue within 25km; 0.6 within 50km; 0.3 within 100km; 0.0 otherwise or missing. |
| ratings | 0.15 | Average of user's completed-gig ratings, normalized 0..1. No ratings = 0.5. |
| experience | 0.10 | Count of completed contracts relative to a baseline (maxes at 10). |
| response_reliability | 0.10 | 1.0 if user has never no-showed or been late; 0.0 if any incident; no history = 0.8. |

Output format:

```js
{
  total: 0..1,
  factors: [
    { name: "skill_match", weight: 0.30, score: 0.75, reason: "3 of 4 required skills matched" }
  ]
}
```

### Application score for a venue

Same factors, but the `User` is the applicant and the `Gig` is the target.

## Safety Model

- **Protected accounts** — users under 16 are protected; parent approval is required to apply to or host gigs.
- **Parent approval** — applications from protected accounts have status `pending_approval` until a parent record approves.
- **Audit logging** — every application, message, and contract change is written to an immutable `audit_log` table.
- **Moderation hooks** — flagged messages and applications are quarantined until a moderator releases them.

## REST API

- `GET /health` — status
- `POST /users` — create user
- `GET /users/:id` — get user
- `PUT /users/:id` — update user
- `POST /venues` — create venue
- `GET /venues` — list venues
- `POST /gigs` — create gig
- `GET /gigs` — search gigs
- `GET /gigs/:id` — gig details
- `POST /gigs/:id/apply` — apply to gig
- `GET /gigs/:id/applications` — ranked applications
- `POST /messages` — send message
- `GET /messages/:userId` — conversation
- `GET /match/gigs` — recommend gigs for current user
- `GET /match/applications/:gigId` — ranked applications

## Offline-First Storage

- SQLite is the local source of truth.
- The frontend caches `users`, `gigs`, and `messages` in `localStorage` and syncs on demand.
- Synchronization uses a simple export/import of the SQLite database file or a JSON sync payload; no cloud services are required.

## Tests

- Unit tests for the scoring engine with edge cases.
- API smoke tests for every route.
- Safety-model tests for protected accounts and audit logging.
