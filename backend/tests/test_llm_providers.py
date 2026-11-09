"""OpenAI provider robustness with a fake client: timeouts are passed, TPM limits retried."""
from types import SimpleNamespace

import openai
import pytest

from app.llm import openai_provider
from app.llm.base import LLMError
from app.llm.openai_provider import CHAT_TIMEOUT, SUMMARY_TIMEOUT, OpenAIProvider


def _tpm_error():
    exc = openai.APIStatusError.__new__(openai.APIStatusError)
    Exception.__init__(exc, "Rate limit reached: 8000 tokens per minute")
    exc.status_code = 429
    return exc


def _event(text):
    return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=text))])


class FakeCompletions:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def create(self, **kw):
        self.calls.append(kw)
        out = self.outcomes.pop(0)
        if isinstance(out, Exception):
            raise out
        if kw.get("stream"):
            return iter(out)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=out))])


def _provider(outcomes, monkeypatch):
    monkeypatch.setattr(openai_provider.time, "sleep", lambda s: None)
    p = OpenAIProvider("m", "key")
    fake = FakeCompletions(outcomes)
    p._client = SimpleNamespace(chat=SimpleNamespace(completions=fake))
    return p, fake


def test_stream_retries_tpm_limit_before_first_token(monkeypatch):
    p, fake = _provider([_tpm_error(), [_event("Hel"), _event("lo")]], monkeypatch)
    assert "".join(p.stream("s", [{"role": "user", "content": "q"}])) == "Hello"
    assert len(fake.calls) == 2
    assert all(c["timeout"] == CHAT_TIMEOUT for c in fake.calls)


def test_stream_gives_up_after_retries(monkeypatch):
    p, fake = _provider([_tpm_error()] * 4, monkeypatch)
    with pytest.raises(LLMError):
        list(p.stream("s", []))
    assert len(fake.calls) == 4


def test_stream_does_not_retry_after_first_token(monkeypatch):
    def broken():
        yield _event("partial")
        raise _tpm_error()

    p, fake = _provider([broken()], monkeypatch)
    got = []
    with pytest.raises(LLMError):
        for tok in p.stream("s", []):
            got.append(tok)
    assert got == ["partial"] and len(fake.calls) == 1


def test_timeout_error_becomes_llm_error_with_explicit_timeouts(monkeypatch):
    timeout = openai.APITimeoutError(request=None)
    p, fake = _provider([timeout, timeout], monkeypatch)
    with pytest.raises(LLMError):
        p.complete("s", [])
    with pytest.raises(LLMError):
        list(p.stream("s", []))
    assert fake.calls[0]["timeout"] == SUMMARY_TIMEOUT
    assert fake.calls[1]["timeout"] == CHAT_TIMEOUT
