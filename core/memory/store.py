"""PROTOFORGE MEMORY STORE

Abstraction over structured + vector storage for the five memory types:
episodic, procedural, semantic, active context, and archive.

Backends supported:
- ChromaDB  (local vector DB, install: pip install chromadb)
- Qdrant    (local or remote, install: pip install qdrant-client)
- In-memory (always available, no persistence)
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from ..schemas import MemoryEntry, MemoryImportance, MemoryType

logger = logging.getLogger("ProtoForge.MemoryStore")


class MemoryStore:
    """
    Unified memory store.

    Write path:  ``write(entry)`` → in-memory dict + vector DB (if available)
    Read path:   ``get(id)`` for exact lookup, ``search(query)`` for semantic
    Maintenance: ``prune_expired()`` to evict stale entries
    """

    def __init__(
        self,
        backend: str = "memory",
        collection: str = "protoforge_memory",
    ) -> None:
        self._store: Dict[str, MemoryEntry] = {}
        self._backend = self._connect(backend, collection)
        self._collection_name = collection

    # ------------------------------------------------------------------
    # Backend connection
    # ------------------------------------------------------------------

    def _connect(self, backend: str, collection: str):
        if backend == "chroma":
            try:
                import chromadb
                client = chromadb.Client()
                coll = client.get_or_create_collection(collection)
                logger.info("MemoryStore: ChromaDB collection '%s'", collection)
                return ("chroma", coll)
            except ImportError:
                logger.warning("chromadb not installed — falling back to in-memory")
        elif backend == "qdrant":
            try:
                from qdrant_client import QdrantClient
                from qdrant_client.models import Distance, VectorParams
                client = QdrantClient(":memory:")
                client.recreate_collection(
                    collection_name=collection,
                    vectors_config=VectorParams(size=384, distance=Distance.COSINE),
                )
                logger.info("MemoryStore: Qdrant collection '%s' (in-memory)", collection)
                return ("qdrant", client, collection)
            except ImportError:
                logger.warning("qdrant_client not installed — falling back to in-memory")
        logger.info("MemoryStore: using in-memory backend")
        return None

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def write(self, entry: MemoryEntry) -> str:
        self._store[entry.memory_id] = entry
        if self._backend:
            self._vector_write(entry)
        logger.debug("Memory written: %s (%s)", entry.memory_id, entry.memory_type)
        return entry.memory_id

    def _vector_write(self, entry: MemoryEntry) -> None:
        kind = self._backend[0] if self._backend else None
        if kind == "chroma":
            try:
                coll = self._backend[1]
                coll.add(
                    ids=[entry.memory_id],
                    documents=[entry.content],
                    metadatas=[{
                        "type":       entry.memory_type,
                        "importance": entry.importance,
                        "source":     entry.source,
                    }],
                )
            except Exception as exc:
                logger.warning("ChromaDB write error: %s", exc)

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def get(self, memory_id: str) -> Optional[MemoryEntry]:
        entry = self._store.get(memory_id)
        if entry:
            entry.accessed_at = time.time()
            entry.access_count += 1
        return entry

    def search(
        self,
        query: str,
        memory_type: Optional[str] = None,
        limit: int = 10,
        min_importance: int = MemoryImportance.LOW.value,
    ) -> List[MemoryEntry]:
        """Semantic search (vector DB) with keyword fallback."""
        kind = self._backend[0] if self._backend else None
        if kind == "chroma":
            return self._chroma_search(query, memory_type, limit)
        return self._local_search(query, memory_type, limit, min_importance)

    def _chroma_search(
        self, query: str, memory_type: Optional[str], limit: int
    ) -> List[MemoryEntry]:
        try:
            coll = self._backend[1]
            where = {"type": memory_type} if memory_type else None
            results = coll.query(query_texts=[query], n_results=limit, where=where)
            ids = results.get("ids", [[]])[0]
            return [self._store[i] for i in ids if i in self._store]
        except Exception as exc:
            logger.warning("ChromaDB search error: %s", exc)
            return self._local_search(query, memory_type, limit, MemoryImportance.LOW.value)

    def _local_search(
        self,
        query: str,
        memory_type: Optional[str],
        limit: int,
        min_importance: int,
    ) -> List[MemoryEntry]:
        lower = query.lower()
        now = time.time()
        results = [
            e for e in self._store.values()
            if lower in e.content.lower()
            and e.importance >= min_importance
            and (memory_type is None or e.memory_type == memory_type)
            and (e.expires_at is None or e.expires_at > now)
        ]
        results.sort(key=lambda e: (-e.importance, -e.accessed_at))
        return results[:limit]

    # ------------------------------------------------------------------
    # Maintenance
    # ------------------------------------------------------------------

    def delete(self, memory_id: str) -> bool:
        existed = memory_id in self._store
        self._store.pop(memory_id, None)
        return existed

    def prune_expired(self) -> int:
        now = time.time()
        expired = [
            mid for mid, e in self._store.items()
            if e.expires_at and e.expires_at < now
        ]
        for mid in expired:
            del self._store[mid]
        if expired:
            logger.info("Pruned %d expired memories", len(expired))
        return len(expired)

    def all_by_type(self, memory_type: MemoryType) -> List[MemoryEntry]:
        return [
            e for e in self._store.values()
            if e.memory_type == memory_type.value
        ]

    def stats(self) -> Dict[str, Any]:
        by_type: Dict[str, int] = {}
        for e in self._store.values():
            by_type[e.memory_type] = by_type.get(e.memory_type, 0) + 1
        return {"total": len(self._store), "by_type": by_type}
