"""Deterministic, key-free provider.

Instead of canned lorem ipsum it does cheap *extractive* work on the real paper (headings,
first sentences, sentences with numbers, keyword overlap), so the whole app is usable and
demo-able without an API key. Output goes through the same JSON-parse/validate path as real
providers.
"""
import json
import re
from collections import Counter
from collections.abc import Iterator

from ..retrieval import tokenize
from .base import LLMProvider, Message

_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\[])")
_HEAD_NUM = r"^(?:\d+(?:\.\d+)*\.?|[IVX]+\.)?\s*"
SECTION_PATTERNS = {
    "abstract": r"abstract",
    "problem_statement": r"(introduction|motivation|background|problem( statement| formulation)?)",
    "methodology": r"(method(s|ology)?|approach|proposed (method|approach|model)|model|architecture|framework|experimental setup|materials and methods)",
    "key_results": r"(results?( and discussion)?|experiments?|evaluation|findings)",
    "conclusion": r"(conclusions?( and future work)?|discussion|summary|concluding remarks)",
}
ANY_HEADING = re.compile(
    _HEAD_NUM + r"(abstract|introduction|related work|background|method|approach|model|experiment|result|evaluation|"
    r"discussion|conclusion|references|acknowledg|appendix|keywords|index terms)",
    re.I,
)


def _sentences(text: str) -> list[str]:
    flat = " ".join(text.split())
    return [s.strip() for s in _SENT.split(flat) if len(s.strip()) > 25]


def _is_heading(line: str) -> bool:
    return 0 < len(line) < 60 and bool(ANY_HEADING.match(line)) and not line.rstrip().endswith((",", ";"))


def _find_section(pages, key: str) -> tuple[str, list[int]]:
    """Return (text, pages) of the first section whose heading matches `key`."""
    pat = re.compile(_HEAD_NUM + SECTION_PATTERNS[key] + r"\b\s*[:.]?\s*$", re.I)
    lines = [(p.page, ln.strip()) for p in pages for ln in p.text.splitlines()]
    for i, (_, ln) in enumerate(lines):
        if len(ln) < 60 and pat.match(ln):
            body, used = [], set()
            for pg, nxt in lines[i + 1 :]:
                if _is_heading(nxt) and body:
                    break
                body.append(nxt)
                used.add(pg)
                if sum(len(b) for b in body) > 3000:
                    break
            if body:
                return " ".join(body), sorted(used)
    return "", []


def extractive_summary(pages) -> dict:
    first_lines = [ln.strip() for ln in pages[0].text.splitlines() if ln.strip()]
    title = next((ln for ln in first_lines if len(ln.split()) >= 2 and not ln.lower().startswith("arxiv")), "Untitled")
    authors: list[str] = []
    try:
        start = first_lines.index(title) + 1
    except ValueError:
        start = 1
    for ln in first_lines[start : start + 4]:
        if _is_heading(ln) or "@" in ln or len(ln) > 120:
            break
        for name in re.split(r",|\band\b|;|·", ln):
            name = re.sub(r"[\d*†‡§]+", "", name).strip()
            if 1 < len(name.split()) <= 4 and all(w[:1].isupper() for w in name.split()):
                authors.append(name)
    abstract, _ = _find_section(pages, "abstract")
    if not abstract:
        abstract = " ".join(_sentences(pages[0].text)[:4])

    all_text = "\n".join(p.text for p in pages)
    sections, src = {}, {}
    fallbacks = _sentences(all_text)
    for i, key in enumerate(["problem_statement", "methodology", "key_results", "conclusion"]):
        text, pgs = _find_section(pages, key)
        sents = _sentences(text)
        if not sents:  # fall back to a slice of the document
            q = len(fallbacks) // 4
            sents = fallbacks[i * q : i * q + 3]
            pgs = []
        sections[key] = sents
        src[key] = pgs[:3]

    results = [s for s in sections["key_results"] if re.search(r"\d|outperform|improv|achiev|better", s, re.I)]
    results = (results or sections["key_results"])[:4]

    counts = Counter(t for t in tokenize(all_text) if len(t) > 3 and not t.isdigit())
    keywords = [w for w, _ in counts.most_common(8)][:6]
    kw = keywords[0] if keywords else "the method"
    return {
        "title": title,
        "authors": authors[:8],
        "abstract": " ".join(_sentences(abstract)[:6]) or abstract[:1200],
        "problem_statement": " ".join(sections["problem_statement"][:3]),
        "methodology": " ".join(sections["methodology"][:3]),
        "key_results": results,
        "conclusion": " ".join(sections["conclusion"][:3]),
        "keywords": keywords,
        "suggested_questions": [
            "What problem does this paper try to solve?",
            f"How is {kw} used in the proposed approach?",
            "What are the main limitations of this work?",
        ],
        "source_pages": src,
    }


def _best_sentence(question: str, text: str) -> tuple[str, int]:
    q = set(tokenize(question))
    best, best_score = "", -1
    for s in _sentences(text) or [text[:300]]:
        score = len(q & set(tokenize(s)))
        if score > best_score:
            best, best_score = s, score
    return best, best_score


class MockProvider(LLMProvider):
    name = "mock"

    def complete(self, system, messages: list[Message], *, max_tokens=2000, task=None, hints=None) -> str:
        hints = hints or {}
        if task == "summary":
            return "```json\n" + json.dumps(extractive_summary(hints["pages"]), indent=2) + "\n```"
        if task == "summary_map":
            return "\n".join(
                f"- {' '.join(_sentences(text)[:2])} [p. {page}]" for page, text in hints.get("chunks", [])
            )
        if task == "rewrite":
            q, history = hints.get("question", ""), hints.get("history", [])
            prev = next((h["content"] for h in reversed(history) if h["role"] == "user"), None)
            if prev and re.search(r"\b(it|this|that|they|them|those|these|its|their)\b", q, re.I):
                return f"{q} (regarding: {prev})"
            return q
        return "".join(self.stream(system, messages, task=task, hints=hints))

    def stream(self, system, messages: list[Message], *, max_tokens=1500, task=None, hints=None) -> Iterator[str]:
        hints = hints or {}
        question = hints.get("question") or (messages[-1]["content"] if messages else "")
        picks = []
        for page, text in hints.get("passages", [])[:3]:
            sent, score = _best_sentence(question, text)
            if score > 0:
                picks.append((sent, page))
        if not picks:
            answer = (
                "I couldn't find anything about that in this paper, so I can't answer it from the text. "
                "*(mock provider: set `LLM_PROVIDER` to a real model for generated answers)*"
            )
        else:
            lines = "\n".join(f"- {s} [p. {p}]" for s, p in picks)
            answer = (
                "Here is what the most relevant passages of the paper say:\n\n"
                f"{lines}\n\n*(mock provider: extractive answer; set `LLM_PROVIDER` for generated answers)*"
            )
        for tok in re.findall(r"\S+\s*|\s+", answer):
            yield tok
