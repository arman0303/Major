import os
import math
from typing import List, Optional
from ..config import settings
from ..llm.provider import LLMProvider

class EmbeddingService:
    """
    Generates genuine semantic vector embeddings using the configured provider
    (Google Gemini or OpenAI). Does NOT use fake hash vectors.
    """
    def __init__(self, provider: Optional[LLMProvider] = None):
        self.provider = provider or LLMProvider()
        self.dimension = 768

    def generate_embedding(self, text: str) -> List[float]:
        """
        Returns real 768-dimensional normalized float embedding vector.
        Raises an explicit exception if the embedding provider fails or is not configured.
        """
        if not text or not text.strip():
            return [0.0] * self.dimension

        if self.provider.provider == "gemini":
            api_key = self.provider.api_key or settings.GEMINI_API_KEY
            if not api_key:
                raise ValueError(
                    "GEMINI_API_KEY is not configured. Real semantic embeddings require a valid API key. "
                    "Please set GEMINI_API_KEY in your .env file."
                )
            try:
                import google.generativeai as genai
                genai.configure(api_key=api_key)
                try:
                    res = genai.embed_content(
                        model=settings.GEMINI_EMBEDDING_MODEL,
                        content=text,
                        task_type="retrieval_document",
                        output_dimensionality=self.dimension
                    )
                except Exception:
                    # Fallback for models or API versions where output_dimensionality is not recognized
                    res = genai.embed_content(
                        model=settings.GEMINI_EMBEDDING_MODEL,
                        content=text,
                        task_type="retrieval_document"
                    )
                embedding = res.get("embedding")
                if not embedding:
                    raise RuntimeError("Gemini embed_content returned an empty embedding vector.")
                # Ensure vector is normalized to self.dimension (768)
                return self._normalize(embedding[:self.dimension])
            except Exception as e:
                raise RuntimeError(f"Gemini embedding generation failed: {str(e)}")

        elif self.provider.provider == "openai":
            api_key = self.provider.api_key or settings.OPENAI_API_KEY
            if not api_key:
                raise ValueError(
                    "OPENAI_API_KEY is not configured. Real semantic embeddings require a valid API key. "
                    "Please set OPENAI_API_KEY in your .env file."
                )
            try:
                from openai import OpenAI
                client = OpenAI(api_key=api_key)
                res = client.embeddings.create(
                    model="text-embedding-3-small",
                    input=text
                )
                embedding = res.data[0].embedding
                if not embedding:
                    raise RuntimeError("OpenAI embeddings.create returned an empty embedding.")
                return self._normalize(embedding[:self.dimension])
            except Exception as e:
                raise RuntimeError(f"OpenAI embedding generation failed: {str(e)}")

        else:
            raise ValueError(f"Unsupported embedding provider: {self.provider.provider}. Use 'gemini' or 'openai'.")

    def _normalize(self, vec: List[float]) -> List[float]:
        norm = math.sqrt(sum(x * x for x in vec))
        if norm == 0:
            return [0.0] * len(vec)
        return [x / norm for x in vec]
