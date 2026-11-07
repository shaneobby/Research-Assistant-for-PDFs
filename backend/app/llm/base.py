from abc import ABC, abstractmethod
from collections.abc import Iterator
from typing import Any


class LLMError(RuntimeError):
    """Provider failure with a user-facing message."""


Message = dict[str, str]  # {"role": "user" | "assistant", "content": str}


class LLMProvider(ABC):
    """Minimal interface every backend implements.

    `task` and `hints` are optional metadata. Real providers ignore them; the mock provider
    uses them to produce deterministic, paper-derived output without parsing prompts.
    """

    name: str = "base"

    def __init__(self, model: str):
        self.model = model

    @abstractmethod
    def complete(
        self,
        system: str,
        messages: list[Message],
        *,
        max_tokens: int = 2000,
        task: str | None = None,
        hints: dict[str, Any] | None = None,
    ) -> str: ...

    @abstractmethod
    def stream(
        self,
        system: str,
        messages: list[Message],
        *,
        max_tokens: int = 1500,
        task: str | None = None,
        hints: dict[str, Any] | None = None,
    ) -> Iterator[str]: ...
