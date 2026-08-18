# Lineage Graph

## Purpose

CASCADE maintains causal relationships between events. When a derived event includes `parentFingerprint`, it is linked into a graph of parents, children, ancestors, and descendants.

## Endpoint

### `GET /lineage/:fingerprint`

Response:

```json
{
  "ok": true,
  "event": { ... },
  "children": ["child-fp-1", "child-fp-2"],
  "descendants": ["child-fp-1", "grandchild-fp", "child-fp-2"],
  "ancestors": ["parent-fp", "grandparent-fp"]
}
```

## Methods

- `children` — direct children
- `descendants` — all children, grandchildren, etc.
- `ancestors` — all parents, grandparents, etc.

## Cycle safety

All traversal algorithms keep a `seen` set and do not revisit nodes. If a cycle is present, the graph returns the first path and stops when it would revisit a node. The starting node is never included in its own descendants.
