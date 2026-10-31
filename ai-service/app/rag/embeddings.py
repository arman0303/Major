import os
import math
import hashlib
from typing import List, Optional
from ..config import settings
from ..llm.provider import LLMProvider

class EmbeddingService:
    """
    Generates vector embeddings using Gemini, OpenAI, or a deterministic
    hash-based semantic projection when external keys are not provided.
    """
    def __init__(self, provider: Optional[LLMProvider] = None):
        self.provider = provider or LLMProvider()
        self.dimension = 768

    def generate_embedding(self, text: str) -> List[float]:
        """Returns 768-dimensional normalized float embedding vector."""
        if not text:
            return [0.0] * self.dimension

        if self.provider.provider == "gemini" and self.provider.api_key:
            try:
                import google.generativeai as genai
                genai.configure(api_key=self.provider.api_key)
                res = genai.embed_content(
                    model=settings.GEMINI_EMBEDDING_MODEL,
                    content=text,
                    task_type="retrieval_document"
                )
                embedding = res["embedding"]
                return self._normalize(embedding[:self.dimension])
            except Exception:
                pass

        elif self.provider.provider == "openai" and self.provider.api_key:
            try:
                from openai import OpenAI
                client = OpenAI(api_key=self.provider.api_key)
                res = client.embeddings.create(
                    model="text-embedding-3-small",
                    input=text
                )
                embedding = res.data[0].embedding
                return self._normalize(embedding[:self.dimension])
            except Exception:
                pass

        # Deterministic semantic hash projection (768 dimensions)
        return self._deterministic_vector(text)

    def _deterministic_vector(self, text: str) -> List[float]:
        """Creates reproducible unit-normalized 768-d vector from text."""
        vec = [0.0] * self.dimension
        tokens = text.lower().split()
        for i, token in enumerate(tokens):
            h = int(hashlib.md5(token.encode("utf-8")).hexdigest(), 16)
            idx = h % self.dimension
            vec[idx] += 1.0 / (1.0 + math.log(i + 1))
        return self._normalize(vec)

    def _normalize(self, vec: List[float]) -> List[float]:
        norm = math.sqrt(sum(x * x for x in vec))
        if norm == 0:
            return [0.0] * len(vec)
        return [x / norm for x in vec]
