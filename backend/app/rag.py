"""Chat over a paper: standalone-question rewrite -> hybrid retrieval -> grounded, cited answer."""
from collections.abc import Iterator

from .llm import LLMProvider
from .retrieval import Hit
from .textnorm import normalize_text

MAX_HISTORY_TURNS = 6

REWRITE_SYSTEM = (
    "You rewrite follow-up questions about a research paper into standalone search queries. "
    "Resolve pronouns and references using the conversation. Output only the rewritten question."
)

ANSWER_SYSTEM = """You are a helpful research assistant answering questions about ONE research paper.
Rules:
- Answer ONLY from the numbered passages provided. Do not use outside knowledge about the paper.
- Cite the page for every claim inline in EXACTLY this form: [p. 4] (ASCII square brackets, lowercase p, a period, one page per bracket; for several pages write [p. 4] [p. 7]). Never write (p. 4), (Table 1, p. 4), pp. 4-5 or page 4. Use the page given for the passage you used.
- If the passages do not contain the answer, say clearly that the paper doesn't seem to cover it
  (you may say what related information it does contain).
- Be concise; use Markdown (short paragraphs, bullet lists, **bold** key terms) where it helps.
- When asked to explain simply, use plain language but stay faithful to the paper."""


def rewrite_question(provider: LLMProvider, question: str, history: list[dict]) -> str:
    if not history:
        return question
    convo = "\n".join(f"{h['role'].upper()}: {h['content'][:800]}" for h in history[-MAX_HISTORY_TURNS:])
    prompt = f"Conversation so far:\n{convo}\n\nFollow-up question: {question}\n\nStandalone question:"
    try:
        out = provider.complete(
            REWRITE_SYSTEM,
            [{"role": "user", "content": prompt}],
            max_tokens=200,
            task="rewrite",
            hints={"question": question, "history": history},
        ).strip()
    except Exception:
        return question
    return out.strip('"') or question


def format_passages(hits: list[Hit]) -> str:
    return "\n\n".join(f"[Passage {i} | p. {h.chunk.page}]\n{h.chunk.text}" for i, h in enumerate(hits, 1))


def answer_stream(
    provider: LLMProvider, question: str, standalone: str, history: list[dict], hits: list[Hit]
) -> Iterator[str]:
    messages = [{"role": h["role"], "content": h["content"]} for h in history[-MAX_HISTORY_TURNS:]]
    # Anthropic requires the first message to be from the user.
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    # Lead with the standalone version so the model answers *this* question, not the previous turn's.
    asked = f"{standalone}\n(The user's wording: {question})" if standalone != question else question
    messages.append(
        {
            "role": "user",
            "content": f"Passages from the paper:\n\n{format_passages(hits)}\n\n---\nQuestion: {asked}",
        }
    )
    for piece in provider.stream(
        ANSWER_SYSTEM,
        messages,
        max_tokens=1500,
        task="answer",
        hints={"question": standalone, "passages": [(h.chunk.page, h.chunk.text) for h in hits]},
    ):
        # Some models emit full-width brackets or non-breaking hyphens; per-token mapping is safe (1:1 chars).
        yield normalize_text(piece)
