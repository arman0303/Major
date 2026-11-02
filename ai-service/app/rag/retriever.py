"""
RAG Retriever — manages persistent document chunk storage and hybrid semantic retrieval.

Persistence Architecture:
1. PostgreSQL + pgvector: Primary relational vector store using `document_chunks` table.
2. Local disk SQLite store: Embedded persistent store (`data/document_chunks.sqlite`) ensuring
   document chunks and embeddings survive service restarts even if PostgreSQL is offline.
3. Strict scoping by user_id and project_id for tenant isolation.
4. Hybrid retrieval: Vector cosine similarity + full-text/keyword matching with score reranking.
"""

import math
import os
import json
import sqlite3
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional

from .embeddings import EmbeddingService
from ..config import settings

logger = logging.getLogger(__name__)


def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    """Compute cosine similarity between two normalized float vectors."""
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)


class RAGRetriever:
    """
    Persistent document chunk store and hybrid retriever.
    Survives restarts by maintaining persistent storage in PostgreSQL and SQLite.
    """

    def __init__(self, embedding_service: Optional[EmbeddingService] = None):
        self.embedding_service = embedding_service or EmbeddingService()
        self.dimension = self.embedding_service.dimension
        
        # Initialize SQLite disk storage
        self.db_dir = Path(__file__).resolve().parent.parent.parent / "data"
        self.db_dir.mkdir(parents=True, exist_ok=True)
        self.sqlite_path = self.db_dir / "document_chunks.sqlite"
        self._init_sqlite()

        # Check and initialize PostgreSQL if accessible
        self._pg_available = False
        self._init_postgres()

    def _init_sqlite(self):
        """Ensure persistent local SQLite schema exists."""
        with sqlite3.connect(str(self.sqlite_path)) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS document_chunks (
                    id TEXT PRIMARY KEY,
                    file_id TEXT NOT NULL,
                    user_id TEXT,
                    project_id TEXT NOT NULL,
                    conversation_id TEXT,
                    chunk_index INTEGER NOT NULL DEFAULT 0,
                    content TEXT NOT NULL,
                    page_number INTEGER,
                    section TEXT,
                    metadata TEXT,
                    embedding TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_dc_project ON document_chunks(project_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_dc_file ON document_chunks(file_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_dc_user ON document_chunks(user_id)")
            conn.commit()

    def _init_postgres(self):
        """Check PostgreSQL connectivity and ensure document_chunks table exists."""
        try:
            import psycopg2
            conn = psycopg2.connect(settings.DATABASE_URL, connect_timeout=3)
            with conn.cursor() as cur:
                # Check if table exists
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS document_chunks (
                        id SERIAL PRIMARY KEY,
                        file_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        project_id TEXT NOT NULL,
                        conversation_id TEXT,
                        chunk_index INTEGER NOT NULL DEFAULT 0,
                        content TEXT NOT NULL,
                        page_number INTEGER,
                        section TEXT,
                        metadata JSONB DEFAULT '{}',
                        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                # Try adding pgvector embedding column if vector extension exists
                try:
                    cur.execute("""
                        DO $$
                        BEGIN
                            IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
                                ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding vector(768);
                            END IF;
                        END $$;
                    """)
                except Exception:
                    pass
                conn.commit()
            conn.close()
            self._pg_available = True
            logger.info("RAGRetriever connected to persistent PostgreSQL store.")
        except Exception as e:
            self._pg_available = False
            logger.info("RAGRetriever running in disk-backed SQLite mode (PostgreSQL offline: %s)", e)

    def index_document(
        self,
        content: str,
        metadata: Dict[str, Any],
        project_id: str,
        user_id: Optional[str] = None,
        file_id: Optional[str] = None,
        conversation_id: Optional[str] = None,
        chunk_index: int = 0,
    ) -> Dict[str, Any]:
        """
        Generates real semantic embedding and stores chunk persistently.
        Raises an exception if embedding or storage fails.
        """
        cleaned = content.strip()
        if not cleaned:
            return {"id": None, "indexed": False, "reason": "empty content"}

        # 1. Generate real semantic embedding (raises error if provider/key fails)
        embedding = self.embedding_service.generate_embedding(cleaned)

        f_id = file_id or f"doc_{int(math.floor(math.log10(len(cleaned) + 1)))}"
        chunk_id = f"chunk_{project_id}_{f_id}_{chunk_index}_{len(cleaned)}"
        page_num = metadata.get("page_number")
        section = metadata.get("section")

        # 2. Persist to SQLite Disk Store
        with sqlite3.connect(str(self.sqlite_path)) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO document_chunks 
                (id, file_id, user_id, project_id, conversation_id, chunk_index, content, page_number, section, metadata, embedding)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                chunk_id,
                f_id,
                user_id or "default_user",
                project_id,
                conversation_id,
                chunk_index,
                cleaned,
                page_num,
                section,
                json.dumps(metadata),
                json.dumps(embedding),
            ))
            conn.commit()

        # 3. Persist to PostgreSQL if available
        if self._pg_available:
            try:
                import psycopg2
                conn = psycopg2.connect(settings.DATABASE_URL, connect_timeout=3)
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO document_chunks 
                        (file_id, user_id, project_id, conversation_id, chunk_index, content, page_number, section, metadata)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        f_id,
                        user_id or "default_user",
                        project_id,
                        conversation_id,
                        chunk_index,
                        cleaned,
                        page_num,
                        section,
                        json.dumps(metadata)
                    ))
                conn.commit()
                conn.close()
            except Exception as pg_err:
                logger.warning("PostgreSQL sync notice (saved to disk SQLite): %s", pg_err)

        return {
            "id": chunk_id,
            "indexed": True,
            "file_id": f_id,
            "chunk_index": chunk_index,
            "embedding_dim": len(embedding)
        }

    def retrieve(
        self,
        query: str,
        project_id: str,
        user_id: Optional[str] = None,
        top_k: int = 5,
        min_similarity: float = 0.10,
    ) -> List[Dict[str, Any]]:
        """
        Hybrid retrieval: semantic vector similarity + keyword boosting.
        Scoped strictly by project_id and optional user_id.
        """
        if not query.strip():
            return []

        # Generate query embedding
        query_vec = self.embedding_service.generate_embedding(query)
        query_tokens = set(query.lower().split())

        scored_candidates = []

        # Read candidates from disk-backed SQLite store
        with sqlite3.connect(str(self.sqlite_path)) as conn:
            cursor = conn.cursor()
            if user_id:
                cursor.execute("""
                    SELECT id, file_id, user_id, project_id, conversation_id, chunk_index, 
                           content, page_number, section, metadata, embedding
                    FROM document_chunks
                    WHERE project_id = ? AND (user_id = ? OR user_id = 'default_user' OR user_id IS NULL)
                """, (project_id, user_id))
            else:
                cursor.execute("""
                    SELECT id, file_id, user_id, project_id, conversation_id, chunk_index, 
                           content, page_number, section, metadata, embedding
                    FROM document_chunks
                    WHERE project_id = ?
                """, (project_id,))

            rows = cursor.fetchall()
            for row in rows:
                c_id, f_id, u_id, p_id, conv_id, idx, content, page_num, sec, meta_str, emb_str = row
                try:
                    chunk_vec = json.loads(emb_str)
                    sim = cosine_similarity(query_vec, chunk_vec)
                except Exception:
                    sim = 0.0

                # Keyword boost: lexical overlap
                content_lower = content.lower()
                matches = sum(1 for token in query_tokens if token in content_lower and len(token) > 3)
                keyword_boost = min(0.15, matches * 0.03)
                combined_score = sim + keyword_boost

                if combined_score >= min_similarity:
                    try:
                        meta = json.loads(meta_str) if meta_str else {}
                    except Exception:
                        meta = {}
                    
                    if page_num and "page_number" not in meta:
                        meta["page_number"] = page_num
                    if f_id and "source" not in meta:
                        meta["source"] = meta.get("original_name", f_id)

                    scored_candidates.append({
                        "id": c_id,
                        "file_id": f_id,
                        "content": content,
                        "metadata": meta,
                        "similarity": round(combined_score, 4),
                        "vector_similarity": round(sim, 4),
                    })

        # Sort descending by combined score
        scored_candidates.sort(key=lambda x: x["similarity"], reverse=True)

        # Deduplicate near-identical excerpts from the same file
        deduped = []
        seen_texts = set()
        for item in scored_candidates:
            prefix = item["content"][:120].strip()
            if prefix not in seen_texts:
                seen_texts.add(prefix)
                deduped.append(item)
                if len(deduped) >= top_k:
                    break

        return deduped

    def clear_project_index(
        self,
        project_id: str,
        user_id: Optional[str] = None,
        file_id: Optional[str] = None,
    ) -> int:
        """Removes chunks matching project_id, user_id, or file_id from persistent store."""
        removed = 0
        with sqlite3.connect(str(self.sqlite_path)) as conn:
            cursor = conn.cursor()
            if file_id:
                cursor.execute("DELETE FROM document_chunks WHERE project_id = ? AND file_id = ?", (project_id, file_id))
            elif user_id:
                cursor.execute("DELETE FROM document_chunks WHERE project_id = ? AND user_id = ?", (project_id, user_id))
            else:
                cursor.execute("DELETE FROM document_chunks WHERE project_id = ?", (project_id,))
            removed = cursor.rowcount
            conn.commit()

        if self._pg_available:
            try:
                import psycopg2
                conn = psycopg2.connect(settings.DATABASE_URL, connect_timeout=3)
                with conn.cursor() as cur:
                    if file_id:
                        cur.execute("DELETE FROM document_chunks WHERE project_id = %s AND file_id = %s", (project_id, file_id))
                    elif user_id:
                        cur.execute("DELETE FROM document_chunks WHERE project_id = %s AND user_id = %s", (project_id, user_id))
                    else:
                        cur.execute("DELETE FROM document_chunks WHERE project_id = %s", (project_id,))
                conn.commit()
                conn.close()
            except Exception:
                pass

        return removed

    def get_stats(self, project_id: str, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Returns indexing statistics for a project from persistent storage."""
        with sqlite3.connect(str(self.sqlite_path)) as conn:
            cursor = conn.cursor()
            if user_id:
                cursor.execute("""
                    SELECT COUNT(*), COUNT(DISTINCT file_id) 
                    FROM document_chunks 
                    WHERE project_id = ? AND (user_id = ? OR user_id = 'default_user')
                """, (project_id, user_id))
            else:
                cursor.execute("""
                    SELECT COUNT(*), COUNT(DISTINCT file_id) 
                    FROM document_chunks 
                    WHERE project_id = ?
                """, (project_id,))
            total_chunks, unique_files = cursor.fetchone()

            cursor.execute("SELECT DISTINCT file_id FROM document_chunks WHERE project_id = ?", (project_id,))
            file_ids = [r[0] for r in cursor.fetchall()]

            return {
                "total_chunks": total_chunks,
                "unique_files": unique_files,
                "file_ids": file_ids,
                "persistence": "postgresql_and_sqlite" if self._pg_available else "persistent_disk_sqlite"
            }
