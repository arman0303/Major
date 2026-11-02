import os
import json
import logging
from typing import Dict, Any, Optional, List
from ..config import settings

logger = logging.getLogger("ai_service.llm")

# Resilient priority order for Gemini models with high free-tier limits
FALLBACK_GEMINI_MODELS = [
    "gemini-2.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash",
]

class LLMProvider:
    """
    Unified LLM Provider abstraction supporting Gemini (via google-genai SDK with
    automatic quota-exhaustion fallback across models), OpenAI, and a deterministic
    schema-aware SQL fallback.
    """
    def __init__(self, provider: Optional[str] = None, api_key: Optional[str] = None):
        self.provider = provider or settings.DEFAULT_LLM_PROVIDER
        if self.provider in ("none", "offline", "mock"):
            self.api_key = None
        elif api_key is not None:
            self.api_key = api_key if api_key.strip() else None
        else:
            self.api_key = (
                settings.GEMINI_API_KEY if self.provider == "gemini" else settings.OPENAI_API_KEY
            )
        self._gemini_client = None
        self._openai_client = None
        self._init_client()

    def _init_client(self):
        if self.provider == "gemini" and self.api_key:
            try:
                from google import genai
                self._gemini_client = genai.Client(api_key=self.api_key)
                logger.info(f"Gemini client (google-genai) initialized with primary model {settings.GEMINI_MODEL}")
            except Exception as e:
                logger.warning(f"Failed to initialize Gemini (google-genai): {e}")
                self._gemini_client = None

        elif self.provider == "openai" and self.api_key:
            try:
                from openai import OpenAI
                self._openai_client = OpenAI(api_key=self.api_key)
                logger.info(f"OpenAI client initialized with model {settings.OPENAI_MODEL}")
            except Exception as e:
                logger.warning(f"Failed to initialize OpenAI: {e}")
                self._openai_client = None

    def has_active_api_key(self) -> bool:
        if self.provider == "gemini":
            return bool(self.api_key and self._gemini_client)
        elif self.provider == "openai":
            return bool(self.api_key and self._openai_client)
        return False

    def _get_gemini_candidate_models(self) -> List[str]:
        """Returns ordered list of Gemini models to try, starting with the configured model."""
        primary = settings.GEMINI_MODEL
        candidates = [primary]
        for m in FALLBACK_GEMINI_MODELS:
            if m not in candidates:
                candidates.append(m)
        return candidates

    def generate_completion(self, prompt: str, system_prompt: Optional[str] = None, temperature: float = 0.1) -> str:
        """Generates text from configured LLM provider with automatic model fallback."""
        if self.provider == "gemini" and self._gemini_client:
            from google.genai import types
            full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
            last_err = None

            for model_name in self._get_gemini_candidate_models():
                try:
                    response = self._gemini_client.models.generate_content(
                        model=model_name,
                        contents=full_prompt,
                        config=types.GenerateContentConfig(temperature=temperature),
                    )
                    if response and response.text:
                        return response.text
                except Exception as e:
                    last_err = e
                    err_msg = str(e)
                    # Catch quota exhaustion (429), model deprecation (404), or rate limits and rotate
                    is_quota_or_notfound = any(c in err_msg for c in ["429", "RESOURCE_EXHAUSTED", "404", "NOT_FOUND", "quota", "limit", "Quota exceeded"])
                    if is_quota_or_notfound:
                        logger.warning(f"Gemini model '{model_name}' unavailable ({err_msg[:100]}...). Trying next candidate model...")
                        continue
                    else:
                        raise e

            logger.error(f"All Gemini models failed: {last_err}")
            raise last_err

        elif self.provider == "openai" and self._openai_client:
            try:
                messages = []
                if system_prompt:
                    messages.append({"role": "system", "content": system_prompt})
                messages.append({"role": "user", "content": prompt})

                response = self._openai_client.chat.completions.create(
                    model=settings.OPENAI_MODEL,
                    messages=messages,
                    temperature=temperature
                )
                return response.choices[0].message.content or ""
            except Exception as e:
                logger.error(f"OpenAI generation error: {e}")
                raise e

        # If no external API key is configured, return notification
        raise ValueError(
            f"No active API credentials for provider '{self.provider}'. "
            "Please configure GEMINI_API_KEY or OPENAI_API_KEY in settings or .env."
        )

    def generate_stream(self, prompt: str, system_prompt: Optional[str] = None, temperature: float = 0.1):
        """Streams text chunks from configured LLM provider with model fallback."""
        if self.provider == "gemini" and self._gemini_client:
            from google.genai import types
            full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
            last_err = None

            for model_name in self._get_gemini_candidate_models():
                try:
                    yielded_any = False
                    for chunk in self._gemini_client.models.generate_content_stream(
                        model=model_name,
                        contents=full_prompt,
                        config=types.GenerateContentConfig(temperature=temperature),
                    ):
                        if chunk.text:
                            yielded_any = True
                            yield chunk.text
                    if yielded_any:
                        return
                except Exception as e:
                    last_err = e
                    err_msg = str(e)
                    is_quota = any(c in err_msg for c in ["429", "RESOURCE_EXHAUSTED", "404", "NOT_FOUND", "quota", "limit"])
                    if is_quota:
                        logger.warning(f"Gemini streaming model '{model_name}' failed ({err_msg[:100]}...). Rotating...")
                        continue
                    else:
                        raise e

            logger.error(f"All Gemini streaming models failed: {last_err}")
            raise last_err

        elif self.provider == "openai" and self._openai_client:
            try:
                messages = []
                if system_prompt:
                    messages.append({"role": "system", "content": system_prompt})
                messages.append({"role": "user", "content": prompt})

                response = self._openai_client.chat.completions.create(
                    model=settings.OPENAI_MODEL,
                    messages=messages,
                    temperature=temperature,
                    stream=True
                )
                for chunk in response:
                    delta = chunk.choices[0].delta.content if chunk.choices else ""
                    if delta:
                        yield delta
                return
            except Exception as e:
                logger.error(f"OpenAI streaming error: {e}")
                raise e

        # Local simulated stream fallback when no API key
        text = self.generate_completion(prompt, system_prompt, temperature)
        words = text.split(" ")
        for i, word in enumerate(words):
            yield word + (" " if i < len(words) - 1 else "")

    def generate_structured_json(self, prompt: str, system_prompt: Optional[str] = None) -> Dict[str, Any]:
        """Generates structured JSON response from LLM."""
        json_sys_prompt = (
            (system_prompt or "") +
            "\nYou MUST output valid JSON only. Do not include markdown code fence formatting or surrounding conversational text."
        )
        raw_text = self.generate_completion(prompt, system_prompt=json_sys_prompt)
        # Clean potential markdown fences
        cleaned = raw_text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        elif cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        return json.loads(cleaned.strip())
