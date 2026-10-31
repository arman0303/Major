import math
from typing import List, Dict, Any, Optional
from .embeddings import EmbeddingService

def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)

class RAGRetriever:
    """
    Manages in-memory and pgvector semantic retrieval for
    schema documentation, PDF chunks, and prior question-SQL pairs.
    """
    def __init__(self, embedding_service: Optional[EmbeddingService] = None):
        self.embedding_service = embedding_service or EmbeddingService()
        self._doc_store: List[Dict[str, Any]] = []

    def index_document(self, content: str, metadata: Dict[str, Any], project_id: str) -> Dict[str, Any]:
        """Indexes a chunk of text with its vector embedding."""
        embedding = self.embedding_service.generate_embedding(content)
        doc = {
            "id": f"chunk_{len(self._doc_store) + 1}",
            "project_id": project_id,
            "content": content,
            "metadata": metadata,
            "embedding": embedding
        }
        self._doc_store.append(doc)
        return {"id": doc["id"], "indexed": True}

    def retrieve(self, query: str, project_id: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """Retrieves top-k relevant document chunks for the query and project."""
        query_vec = self.embedding_service.generate_embedding(query)
        scored = []
        for doc in self._doc_store:
            if doc["project_id"] == project_id:
                sim = cosine_similarity(query_vec, doc["embedding"])
                scored.append({
                    "id": doc["id"],
                    "content": doc["content"],
                    "metadata": doc["metadata"],
                    "similarity": round(sim, 4)
                })

        scored.sort(key=lambda x: x["similarity"], reverse=True)
        return scored[:top_k]

    def clear_project_index(self, project_id: str):
        self._doc_store = [d for d in self._doc_store if d["project_id"] != project_id]
