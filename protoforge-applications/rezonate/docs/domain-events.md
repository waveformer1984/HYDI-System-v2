# Resonate Domain Events

## Contract

Resonate emits domain events through the ProtoForge EventBus. All events include:

```json
{
  "id": "",
  "type": "",
  "payload": {},
  "meta": {},
  "createdAt": ""
}
```

## Core events

### `audio.asset.created`

Emitted when a new audio asset is registered in the repository.

**Payload:**

```json
{
  "assetId": "",
  "projectId": "",
  "source": "rezonate",
  "type": "generated_song"
}
```

**When:**

- Generation job completes and the MP3 is saved.
- Stem analysis completes and a stem asset is registered.
- An asset is manually registered via `POST /assets`.

### `song.generated`

Emitted when the Rezonate Python engine produces an MP3.

**Payload:**

```json
{
  "jobId": "",
  "prompt": "",
  "audioPath": "",
  "projectId": ""
}
```

### `stem.processing.started`

**Payload:**

```json
{
  "jobId": "",
  "sourcePath": "",
  "projectId": ""
}
```

### `stem.processing.completed`

**Payload:**

```json
{
  "jobId": "",
  "sourcePath": "",
  "folder": ""
}
```

### `processing.started`

**Payload:**

```json
{
  "entityId": "",
  "previousState": "queued",
  "newState": "generating",
  "timestamp": "",
  "metadata": {}
}
```

### `processing.completed`

**Payload:**

```json
{
  "entityId": "",
  "previousState": "generating",
  "newState": "completed",
  "timestamp": "",
  "metadata": { "audioPath": "", "assetId": "" }
}
```

### `processing.failed`

**Payload:**

```json
{
  "entityId": "",
  "previousState": "",
  "newState": "failed",
  "timestamp": "",
  "metadata": { "error": "" }
}
```

### `ownership.created`

**Payload:**

```json
{
  "entityId": "",
  "assetId": "",
  "previousStatus": "draft",
  "newStatus": "verified",
  "timestamp": "",
  "metadata": {}
}
```

### `rights.registered`

**Payload:**

```json
{
  "entityId": "",
  "assetId": "",
  "timestamp": "",
  "metadata": { "right": {} }
}
```

### `collaborator.added`

**Payload:**

```json
{
  "entityId": "",
  "assetId": "",
  "timestamp": "",
  "metadata": { "collaborator": {} }
}
```

### `royalty.created`

**Payload:**

```json
{
  "entityId": "",
  "assetId": "",
  "timestamp": "",
  "metadata": { "splits": [] }
}
```

## HYDI integration boundary

In Phase 4, `audio.asset.created` and `processing.completed` will be forwarded through the HYDI Event Gateway to the RAW LEDGER. No HYDI coupling exists in this phase.
