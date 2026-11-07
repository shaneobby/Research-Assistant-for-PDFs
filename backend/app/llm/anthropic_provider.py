from collections.abc import Iterator

from .base import LLMError, LLMProvider, Message


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, model: str, api_key: str):
        super().__init__(model)
        try:
            import anthropic
        except ImportError as exc:  # pragma: no cover
            raise LLMError("The 'anthropic' package is not installed.") from exc
        if not api_key:
            raise LLMError("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.")
        self._anthropic = anthropic
        self._client = anthropic.Anthropic(api_key=api_key, max_retries=2)

    def complete(self, system, messages: list[Message], *, max_tokens=2000, task=None, hints=None) -> str:
        try:
            resp = self._client.messages.create(
                model=self.model, max_tokens=max_tokens, system=system, messages=messages
            )
        except self._anthropic.APIError as exc:
            raise LLMError(f"Anthropic API error: {exc}") from exc
        return "".join(block.text for block in resp.content if block.type == "text")

    def stream(self, system, messages: list[Message], *, max_tokens=1500, task=None, hints=None) -> Iterator[str]:
        try:
            with self._client.messages.stream(
                model=self.model, max_tokens=max_tokens, system=system, messages=messages
            ) as s:
                yield from s.text_stream
        except self._anthropic.APIError as exc:
            raise LLMError(f"Anthropic API error: {exc}") from exc
