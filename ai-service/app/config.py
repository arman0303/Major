import os
from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

project_root = Path(__file__).resolve().parent.parent.parent
env_file_path = project_root / ".env"
if env_file_path.exists():
    try:
        load_dotenv(dotenv_path=env_file_path, encoding="utf-8")
    except Exception:
        pass


class Settings(BaseSettings):
    APP_NAME: str = "Conversational SQL Analytics Assistant - AI Service"
    PORT: int = int(os.getenv("AI_PORT", "8000"))
    HOST: str = "0.0.0.0"
    DEBUG: bool = True

    # Database Settings
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "postgresql://postgres:postgres@localhost:5432/conversational_sql"
    )
    MAX_ROW_LIMIT: int = int(os.getenv("MAX_ROW_LIMIT", "1000"))
    MAX_EXECUTION_TIME_MS: int = int(os.getenv("MAX_EXECUTION_TIME_MS", "30000"))

    # LLM Provider settings
    DEFAULT_LLM_PROVIDER: str = os.getenv("DEFAULT_LLM_PROVIDER", "gemini")
    GEMINI_API_KEY: Optional[str] = os.getenv("GEMINI_API_KEY", None)
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    GEMINI_EMBEDDING_MODEL: str = os.getenv("GEMINI_EMBEDDING_MODEL", "models/gemini-embedding-001")
    OPENAI_API_KEY: Optional[str] = os.getenv("OPENAI_API_KEY", None)
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # Safety limits
    AUTO_EXECUTE_SELECT: bool = os.getenv("AUTO_EXECUTE_SELECT", "true").lower() == "true"
    REQUIRE_CONFIRMATION_FOR_MUTATIONS: bool = True

    model_config = {
        "env_file": ".env",
        "extra": "allow"
    }

settings = Settings()
