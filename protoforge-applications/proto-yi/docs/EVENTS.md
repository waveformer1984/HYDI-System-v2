# Domain Events

## Lifecycle Events

### `record.created`

- **When:** A new record is created.
- **Payload:** The record object.

### `record.updated`

- **When:** A record is updated.
- **Payload:** The updated record object.

### `record.deleted`

- **When:** A record is deleted.
- **Payload:** `{ id }`.

## External Transport

If `EXTERNAL_ENDPOINT` is configured and enabled, all emitted events are forwarded as JSON envelopes to `POST $EXTERNAL_ENDPOINT/events`.
