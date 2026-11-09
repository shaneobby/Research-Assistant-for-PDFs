from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent

DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-5-5",
    "openai": "gpt-4o-mini",
    "mock": "mock-extractive-v1",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    llm_provider: Literal["mock", "anthropic", "openai"] = "mock"
    llm_model: str = ""
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    openai_base_url: str = ""

    embedding_backend: Literal["fastembed", "hash"] = "fastembed"
    embedding_model: str = "BAAI/bge-small-en-v1.5"

    data_dir: Path = BACKEND_DIR / "data"
    max_upload_mb: int = 25
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # RAG knobs
    # Keep chunk_tokens under the embedder's window (bge-small truncates at 512). Changing either re-indexes on startup.
    chunk_tokens: int = 450
    chunk_overlap_tokens: int = 60
    top_k: int = 6
    # Summary pipeline sizing (lower both on small-quota providers, e.g. Groq free tier: 4000 / 3000)
    summary_single_pass_tokens: int = 24_000
    summary_map_group_tokens: int = 6_000

    @property
    def model(self) -> str:
        return self.llm_model or DEFAULT_MODELS[self.llm_provider]

    @property
    def resolved_data_dir(self) -> Path:
        p = Path(self.data_dir)
        return p if p.is_absolute() else (BACKEND_DIR / p).resolve()

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
