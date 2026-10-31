import os
import json
import logging
from typing import Dict, Any, Optional, List
from ..config import settings

logger = logging.getLogger("ai_service.llm")

class LLMProvider:
    """
    Unified LLM Provider abstraction supporting Gemini, OpenAI, and
    deterministic schema-aware SQL generation fallback.
    """
    def __init__(self, provider: Optional[str] = None, api_key: Optional[str] = None):
        self.provider = provider or settings.DEFAULT_LLM_PROVIDER
        self.api_key = api_key or (
            settings.GEMINI_API_KEY if self.provider == "gemini" else settings.OPENAI_API_KEY
        )
        self._gemini_client = None
        self._openai_client = None
        self._init_client()

    def _init_client(self):
        if self.provider == "gemini" and self.api_key:
            try:
                import google.generativeai as genai
                genai.configure(api_key=self.api_key)
                self._gemini_client = genai.GenerativeModel(settings.GEMINI_MODEL)
                logger.info(f"Gemini client initialized with model {settings.GEMINI_MODEL}")
            except Exception as e:
                logger.warning(f"Failed to initialize Gemini: {e}")
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

    def generate_completion(self, prompt: str, system_prompt: Optional[str] = None, temperature: float = 0.1) -> str:
        """Generates text from configured LLM provider."""
        if self.provider == "gemini" and self._gemini_client:
            try:
                full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
                response = self._gemini_client.generate_content(
                    full_prompt,
                    generation_config={"temperature": temperature}
                )
                return response.text
            except Exception as e:
                logger.error(f"Gemini generation error: {e}")
                raise e

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
        raise ValueError(f"No active API credentials for provider '{self.provider}'. Please configure GEMINI_API_KEY or OPENAI_API_KEY in settings or .env.")

    def generate_stream(self, prompt: str, system_prompt: Optional[str] = None, temperature: float = 0.1):
        """Streams text chunks from configured LLM provider."""
        if self.provider == "gemini" and self._gemini_client:
            try:
                full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
                response = self._gemini_client.generate_content(
                    full_prompt,
                    generation_config={"temperature": temperature},
                    stream=True
                )
                for chunk in response:
                    if chunk.text:
                        yield chunk.text
                return
            except Exception as e:
                logger.error(f"Gemini streaming error: {e}")
                raise e

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
