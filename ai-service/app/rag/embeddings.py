import math
from typing import List, Optional
from ..config import settings
from ..llm.provider import LLMProvider

class EmbeddingService:
    """
    Generates genuine semantic vector embeddings using the configured provider
    (Google Gemini via google-genai SDK, or OpenAI). Does NOT use fake hash vectors.
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
                from google import genai
                from google.genai import types
                client = genai.Client(api_key=api_key)
                model = settings.GEMINI_EMBEDDING_MODEL
                try:
                    # Try with output_dimensionality if the model supports it
                    result = client.models.embed_content(
                        model=model,
                        contents=text,
                        config=types.EmbedContentConfig(
                            task_type="retrieval_document",
                            output_dimensionality=self.dimension,
                        ),
                    )
                except Exception:
                    # Fallback without output_dimensionality parameter
                    result = client.models.embed_content(
                        model=model,
                        contents=text,
                        config=types.EmbedContentConfig(
                            task_type="retrieval_document",
                        ),
                    )
                # google-genai SDK returns a EmbedContentResponse;
                # embeddings are in result.embeddings[0].values
                if result.embeddings and len(result.embeddings) > 0:
                    embedding = result.embeddings[0].values
                else:
                    raise RuntimeError("Gemini embed_content returned an empty embedding response.")

                if not embedding:
                    raise RuntimeError("Gemini embed_content returned an empty embedding vector.")
                # Ensure vector is normalized to self.dimension (768)
                return self._normalize(list(embedding)[:self.dimension])
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
