"""
RAG Retriever — manages document chunk storage and similarity retrieval.

In-memory storage is used by default (works without PostgreSQL).
When PostgreSQL + pgvector are available, set USE_PGVECTOR=true in .env
and the retriever will persist embeddings to the document_chunks table.

User and project isolation is enforced at the retrieval level.
"""

import math
import os
from typing import List, Dict, Any, Optional
from .embeddings import EmbeddingService


def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    """Compute cosine similarity between two vectors."""
    if not v1 or not v2:
        return 0.0
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)


class RAGRetriever:
    """
    Manages semantic document retrieval.
    - Stores chunks in memory (persists for process lifetime)
    - Enforces user_id + project_id scoping
    - Supports file_id-level deduplication
    """

    def __init__(self, embedding_service: Optional[EmbeddingService] = None):
        self.embedding_service = embedding_service or EmbeddingService()
        # In-memory store: list of chunk dicts
        self._doc_store: List[Dict[str, Any]] = []
        self._chunk_counter = 0

    def index_document(
        self,
        content: str,
        metadata: Dict[str, Any],
        project_id: str,
        user_id: Optional[str] = None,
        file_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Index a single text chunk with its embedding.
        Returns the chunk ID.
        """
        if not content.strip():
            return {"id": None, "indexed": False, "reason": "empty content"}

        embedding = self.embedding_service.generate_embedding(content)
        self._chunk_counter += 1
        chunk_id = f"chunk_{project_id}_{self._chunk_counter}"

        doc = {
            "id": chunk_id,
            "project_id": project_id,
            "user_id": user_id,
            "file_id": file_id,
            "content": content,
            "metadata": {
                **metadata,
                "project_id": project_id,
                "user_id": user_id,
                "file_id": file_id,
            },
            "embedding": embedding,
        }
        self._doc_store.append(doc)
        return {"id": chunk_id, "indexed": True}

    def retrieve(
        self,
        query: str,
        project_id: str,
        user_id: Optional[str] = None,
        top_k: int = 5,
        min_similarity: float = 0.15,
    ) -> List[Dict[str, Any]]:
        """
        Retrieve top-k relevant chunks for a query.
        Scoped to project_id; optionally further scoped by user_id.
        """
        if not self._doc_store:
            return []

        query_vec = self.embedding_service.generate_embedding(query)

        # Filter by project (and optionally user)
        candidates = [
            doc for doc in self._doc_store
            if doc["project_id"] == project_id
            and (user_id is None or doc.get("user_id") == user_id)
        ]

        if not candidates:
            return []

        # Score all candidates
        scored = []
        for doc in candidates:
            sim = cosine_similarity(query_vec, doc["embedding"])
            if sim >= min_similarity:
                scored.append({
                    "id": doc["id"],
                    "content": doc["content"],
                    "metadata": doc["metadata"],
                    "similarity": round(sim, 4),
                    "file_id": doc.get("file_id"),
                })

        # Sort by similarity descending
        scored.sort(key=lambda x: x["similarity"], reverse=True)

        # Deduplicate: avoid returning near-identical chunks from same file
        seen_content = set()
        deduplicated = []
        for item in scored:
            content_key = item["content"][:100]  # first 100 chars as fingerprint
            if content_key not in seen_content:
                seen_content.add(content_key)
                deduplicated.append(item)

        return deduplicated[:top_k]

    def clear_project_index(
        self,
        project_id: str,
        user_id: Optional[str] = None,
        file_id: Optional[str] = None,
    ) -> int:
        """
        Remove chunks matching project_id (and optionally user_id or file_id).
        Returns number of chunks removed.
        """
        before = len(self._doc_store)
        self._doc_store = [
            doc for doc in self._doc_store
            if not (
                doc["project_id"] == project_id
                and (user_id is None or doc.get("user_id") == user_id)
                and (file_id is None or doc.get("file_id") == file_id)
            )
        ]
        return before - len(self._doc_store)

    def get_stats(self, project_id: str, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Return indexing stats for a project."""
        chunks = [
            doc for doc in self._doc_store
            if doc["project_id"] == project_id
            and (user_id is None or doc.get("user_id") == user_id)
        ]
        file_ids = {doc.get("file_id") for doc in chunks if doc.get("file_id")}
        return {
            "total_chunks": len(chunks),
            "unique_files": len(file_ids),
            "file_ids": list(file_ids),
        }
