"""LLM provider abstraction: LLM_PROVIDER=anthropic | openai | mock."""
from functools import lru_cache

from ..config import Settings, get_settings
from .base import LLMError, LLMProvider


def build_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "anthropic":
        from .anthropic_provider import AnthropicProvider

        return AnthropicProvider(settings.model, settings.anthropic_api_key)
    if settings.llm_provider == "openai":
        from .openai_provider import OpenAIProvider

        return OpenAIProvider(settings.model, settings.openai_api_key, settings.openai_base_url or None)
    from .mock import MockProvider

    return MockProvider(settings.model)


@lru_cache
def get_provider() -> LLMProvider:
    return build_provider(get_settings())


__all__ = ["LLMProvider", "LLMError", "build_provider", "get_provider"]
