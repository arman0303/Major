import os
import json
import logging
from typing import Dict, Any, Optional, List
from ..config import settings

logger = logging.getLogger("ai_service.llm")

# Verified list of Gemini content generation models with priority on high free-tier limits
FALLBACK_GEMINI_MODELS = [
    "gemini-2.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-3.8-flash",
    "gemini-flash-latest",
]


def classify_llm_error(error: Exception) -> Dict[str, Any]:
    """
    Classifies an LLM exception into specific categories:
    invalid_api_key, quota_exhausted, rate_limited, model_unavailable, timeout, or unknown.
    Never exposes raw API keys.
    """
    err_str = str(error)
    err_lower = err_str.lower()

    if any(k in err_lower for k in ["api_key_invalid", "unauthenticated", "invalid api key", "401", "403", "forbidden"]):
        return {
            "category": "invalid_api_key",
            "message": "Authentication failed: The configured API key is invalid or unauthorized.",
            "is_retryable": False,
        }
    elif any(k in err_lower for k in ["resource_exhausted", "429", "quota exceeded", "quota"]):
        return {
            "category": "quota_exhausted",
            "message": "API Quota Exceeded (429): Your daily or per-minute API request quota has been reached.",
            "is_retryable": True,
        }
    elif any(k in err_lower for k in ["rate limit", "too many requests"]):
        return {
            "category": "rate_limited",
            "message": "Rate Limit Exceeded (429): Too many concurrent requests. Please retry in a few moments.",
            "is_retryable": True,
        }
    elif any(k in err_lower for k in ["404", "not_found", "model not found", "unsupported model"]):
        return {
            "category": "model_unavailable",
            "message": "Model Unavailable (404): The specified model was not found or is currently unsupported by the provider.",
            "is_retryable": False,
        }
    elif any(k in err_lower for k in ["timeout", "timed out", "deadline_exceeded"]):
        return {
            "category": "timeout",
            "message": "Connection Timeout: The AI provider did not respond within the allocated time.",
            "is_retryable": True,
        }
    else:
        # Sanitize any potential API key substrings from the error message
        sanitized = err_str
        for env_key in [settings.GEMINI_API_KEY, settings.OPENAI_API_KEY]:
            if env_key and len(env_key) > 6:
                sanitized = sanitized.replace(env_key, "[REDACTED_API_KEY]")
        return {
            "category": "provider_error",
            "message": f"Provider Error: {sanitized[:200]}",
            "is_retryable": False,
        }


class LLMProvider:
    """
    Unified LLM Provider abstraction supporting Gemini (via google-genai SDK with
    automatic quota-exhaustion fallback across verified models) and OpenAI.
    Provides real lightweight health probing and detailed error classification.
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
            except Exception as e:
                logger.warning(f"Failed to initialize Gemini client: {e}")
                self._gemini_client = None

        elif self.provider == "openai" and self.api_key:
            try:
                from openai import OpenAI
                self._openai_client = OpenAI(api_key=self.api_key)
            except Exception as e:
                logger.warning(f"Failed to initialize OpenAI client: {e}")
                self._openai_client = None

    def has_active_api_key(self) -> bool:
        """Returns True if client object is initialized with an API key."""
        if self.provider == "gemini":
            return bool(self.api_key and self._gemini_client)
        elif self.provider == "openai":
            return bool(self.api_key and self._openai_client)
        return False

    def check_health(self) -> Dict[str, Any]:
        """
        Performs a real lightweight API request to verify authentication,
        model availability, and quota health. Does NOT merely check client initialization.
        """
        if not self.has_active_api_key():
            return {
                "status": "not_configured",
                "healthy": False,
                "provider": self.provider,
                "message": f"No active API credentials configured for provider '{self.provider}'.",
            }

        try:
            if self.provider == "gemini" and self._gemini_client:
                from google.genai import types
                primary_model = settings.GEMINI_MODEL
                # Make a real 1-token test prompt
                resp = self._gemini_client.models.generate_content(
                    model=primary_model,
                    contents="Ping",
                    config=types.GenerateContentConfig(max_output_tokens=5, temperature=0.0),
                )
                if resp and (resp.text or resp.candidates):
                    return {
                        "status": "healthy",
                        "healthy": True,
                        "provider": "gemini",
                        "active_model": primary_model,
                        "message": f"Gemini provider is fully authenticated and responsive (model: {primary_model}).",
                    }
                else:
                    return {
                        "status": "unhealthy",
                        "healthy": False,
                        "provider": "gemini",
                        "active_model": primary_model,
                        "message": "Gemini returned an empty response on probe.",
                    }

            elif self.provider == "openai" and self._openai_client:
                model = settings.OPENAI_MODEL
                resp = self._openai_client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": "Ping"}],
                    max_tokens=5,
                    temperature=0.0,
                )
                if resp and resp.choices:
                    return {
                        "status": "healthy",
                        "healthy": True,
                        "provider": "openai",
                        "active_model": model,
                        "message": f"OpenAI provider is fully authenticated and responsive (model: {model}).",
                    }
                else:
                    return {
                        "status": "unhealthy",
                        "healthy": False,
                        "provider": "openai",
                        "active_model": model,
                        "message": "OpenAI returned an empty response on probe.",
                    }
        except Exception as e:
            classified = classify_llm_error(e)
            return {
                "status": classified["category"],
                "healthy": False,
                "provider": self.provider,
                "message": classified["message"],
                "is_retryable": classified["is_retryable"],
            }

        return {
            "status": "unsupported",
            "healthy": False,
            "provider": self.provider,
            "message": f"Unsupported provider: {self.provider}",
        }

    def _get_gemini_candidate_models(self) -> List[str]:
        """Returns ordered list of verified Gemini models to try, starting with the configured model."""
        primary = settings.GEMINI_MODEL
        candidates = [primary]
        for m in FALLBACK_GEMINI_MODELS:
            if m not in candidates:
                candidates.append(m)
        return candidates

    def generate_completion(self, prompt: str, system_prompt: Optional[str] = None, temperature: float = 0.1) -> str:
        """Generates text from configured LLM provider with automatic verified model fallback."""
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
                    is_quota_or_notfound = any(c in err_msg for c in ["429", "RESOURCE_EXHAUSTED", "404", "NOT_FOUND", "quota", "limit", "Quota exceeded"])
                    if is_quota_or_notfound:
                        logger.warning(f"Gemini model '{model_name}' unavailable ({err_msg[:100]}...). Trying next candidate model...")
                        continue
                    else:
                        raise e

            logger.error(f"All candidate Gemini models failed: {last_err}")
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

        # Fallback local stream
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
        cleaned = raw_text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        elif cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        return json.loads(cleaned.strip())
