# Event Normalization

## Canonical input envelope

```json
{
  "eventId": "uuid",
  "eventType": "audio.asset.created",
  "source": "resonate",
  "version": "1",
  "timestamp": "2026-08-01T00:00:00.000Z",
  "payload": {}
}
```

## Validation

Required fields:

- `eventId`
- `eventType`
- `source`
- `version`
- `timestamp`
- `payload` (must be an object)

`timestamp` must be a valid ISO 8601 string.

## Integrity verification

The processor recomputes:

```text
fingerprint = sha256({ source, eventId, eventType })
hash        = sha256({ fingerprint, event_type: eventType, payload })
```

If the recomputed values do not match the raw ledger values, the event is rejected and recorded as a validation failure.

## Version adapters

Version adapters transform a payload without modifying the original event.

| Version | Behavior |
|---|---|
| `1` | Adds `cascadeVersion: 1` |
| `2` | Adds `cascadeVersion: 2` and maps `parent` or `parentFingerprint` to `parentFingerprint` |

Adapters are registered in `src/versioning/adapters.js`.

## Derived output

```json
{
  "id": "cascade:{fingerprint}",
  "fingerprint": "...",
  "eventId": "uuid",
  "eventType": "audio.asset.created",
  "source": "resonate",
  "version": "1",
  "timestamp": "2026-08-01T00:00:00.000Z",
  "originalPayload": {},
  "normalizedPayload": { "cascadeVersion": 1 },
  "processingTimestamp": "...",
  "processorVersion": "1.0",
  "parentFingerprint": null,
  "children": []
}
```
