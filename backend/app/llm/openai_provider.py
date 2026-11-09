"""OpenAI-compatible chat completions. With OPENAI_BASE_URL this also covers Ollama, Groq,
OpenRouter, LM Studio, vLLM, ..."""
import logging
import time
from collections.abc import Iterator

from .base import LLMError, LLMProvider, Message


log = logging.getLogger(__name__)

CHAT_TIMEOUT = 60.0  # seconds per request (stream: per read)
SUMMARY_TIMEOUT = 120.0
TPM_WAIT_S = 20


def _is_tpm_limit(exc: Exception) -> bool:
    text = str(exc).lower()
    return getattr(exc, "status_code", None) in (413, 429) and ("per minute" in text or "rate limit" in text)


class OpenAIProvider(LLMProvider):
    name = "openai"

    def __init__(self, model: str, api_key: str, base_url: str | None = None):
        super().__init__(model)
        try:
            import openai
        except ImportError as exc:  # pragma: no cover
            raise LLMError("The 'openai' package is not installed.") from exc
        if not api_key and not base_url:
            raise LLMError("LLM_PROVIDER=openai but OPENAI_API_KEY is not set.")
        self._openai = openai
        # Local servers (Ollama) accept any key.
        self._client = openai.OpenAI(api_key=api_key or "not-needed", base_url=base_url, max_retries=1)

    def _msgs(self, system: str, messages: list[Message]) -> list[dict]:
        return [{"role": "system", "content": system}, *messages]

    def complete(self, system, messages: list[Message], *, max_tokens=2000, task=None, hints=None) -> str:
        for attempt in range(4):
            try:
                resp = self._client.chat.completions.create(
                    model=self.model,
                    messages=self._msgs(system, messages),
                    max_tokens=max_tokens,
                    temperature=0.2,
                    timeout=SUMMARY_TIMEOUT,
                )
                break
            except self._openai.OpenAIError as exc:
                # Free tiers cap tokens per minute: wait for the window to reset and retry.
                if attempt < 3 and _is_tpm_limit(exc):
                    log.warning("token-per-minute limit hit, waiting %ds (attempt %d)", TPM_WAIT_S, attempt + 1)
                    time.sleep(TPM_WAIT_S)
                    continue
                raise LLMError(f"OpenAI API error: {exc}") from exc
        return resp.choices[0].message.content or ""

    def stream(self, system, messages: list[Message], *, max_tokens=1500, task=None, hints=None) -> Iterator[str]:
        # Retry a TPM limit only until the first token: afterwards a retry would repeat text.
        for attempt in range(4):
            started = False
            try:
                stream = self._client.chat.completions.create(
                    model=self.model,
                    messages=self._msgs(system, messages),
                    max_tokens=max_tokens,
                    temperature=0.2,
                    stream=True,
                    timeout=CHAT_TIMEOUT,
                )
                for event in stream:
                    if event.choices and event.choices[0].delta.content:
                        started = True
                        yield event.choices[0].delta.content
                return
            except self._openai.OpenAIError as exc:
                if not started and attempt < 3 and _is_tpm_limit(exc):
                    log.warning("token-per-minute limit hit, waiting %ds (attempt %d)", TPM_WAIT_S, attempt + 1)
                    time.sleep(TPM_WAIT_S)
                    continue
                raise LLMError(f"OpenAI API error: {exc}") from exc
