"""
HydiMemory — Persistent JSON-file knowledge store with keyword relevance retrieval.
Designed to upgrade to Firestore + Vertex AI Vector Search without interface changes.
"""
import os
import json
import datetime
from typing import Optional

# Memory lives in the Vault so it's covered by the existing audit trail
_MEMORY_DIR = os.path.join(os.path.dirname(__file__), "..", "HYDI_Vault", "Memory")


class HydiMemory:
    def __init__(self, memory_dir: str = _MEMORY_DIR):
        self._dir = memory_dir
        os.makedirs(self._dir, exist_ok=True)
        self._index_path = os.path.join(self._dir, "_index.json")
        self._index: dict = self._load_index()

    # ------------------------------------------------------------------ write

    def store(self, key: str, value: dict) -> None:
        """Persist a memory entry under the given key."""
        safe_key = "".join(c if c.isalnum() or c in "-_" else "_" for c in key)
        entry = {
            "key": safe_key,
            "value": value,
            "stored_at": datetime.datetime.utcnow().isoformat(),
        }
        path = os.path.join(self._dir, f"{safe_key}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(entry, f, indent=2)

        self._index[safe_key] = {
            "path": path,
            "summary": str(value)[:300],
            "stored_at": entry["stored_at"],
        }
        self._save_index()

    # ------------------------------------------------------------------ read

    def retrieve(self, key: str) -> Optional[dict]:
        """Fetch a single memory by key. Returns None if not found."""
        meta = self._index.get(key)
        if not meta:
            return None
        path = meta["path"]
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)["value"]

    def retrieve_relevant(self, query: str, top_k: int = 5) -> list[dict]:
        """
        Keyword-overlap relevance search across all stored memories.
        Replace with Vertex AI Matching Engine embeddings when scaling.
        """
        query_words = set(query.lower().split())
        scored: list[tuple[int, str]] = []

        for key, meta in self._index.items():
            summary = meta.get("summary", "").lower()
            score = sum(1 for w in query_words if len(w) > 3 and w in summary)
            if score > 0:
                scored.append((score, key))

        scored.sort(reverse=True)
        results = []
        for _, key in scored[:top_k]:
            value = self.retrieve(key)
            if value is not None:
                results.append({"key": key, "memory": value})
        return results

    def list_keys(self) -> list[str]:
        return list(self._index.keys())

    # ------------------------------------------------------------------ private

    def _load_index(self) -> dict:
        if os.path.exists(self._index_path):
            try:
                with open(self._index_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError):
                return {}
        return {}

    def _save_index(self) -> None:
        with open(self._index_path, "w", encoding="utf-8") as f:
            json.dump(self._index, f, indent=2)
