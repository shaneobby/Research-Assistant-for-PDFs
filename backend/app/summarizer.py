"""Structured summary generation.

Short papers: one call over the full page-tagged text.
Long papers: map-reduce. MAP turns groups of chunks into page-cited notes; REDUCE combines
the front matter (first pages, for title/authors/abstract), the section-header outline and
the notes into the final JSON. Output is validated with pydantic; on bad JSON we retry once
with the validation error. `source_pages` is sanity-checked and back-filled via retrieval.
"""
import json
import logging
import re
from collections.abc import Callable

from pydantic import ValidationError

from .chunking import WORDS_PER_TOKEN, Chunk
from .llm import LLMError, LLMProvider
from .pdf import PageText
from .schemas import Summary
from .textnorm import normalize_deep

log = logging.getLogger(__name__)

SINGLE_PASS_TOKENS = 24_000  # below this, send the whole paper at once
MAP_GROUP_TOKENS = 6_000
FRONT_MATTER_CHARS = 6_000

SCHEMA_TEXT = """{
  "title": string,
  "authors": [string],
  "abstract": string,                // the paper's abstract (lightly cleaned), or a 3-5 sentence synopsis if none
  "problem_statement": string,       // what problem / gap the paper addresses and why it matters (Markdown ok)
  "methodology": string,             // how they approach it: data, model, method, experimental setup (Markdown ok)
  "key_results": [string],           // 3-6 concrete findings, with numbers where the paper gives them
  "conclusion": string,              // ONLY what the authors state in their conclusion; no added limitations or future work
  "keywords": [string],              // 4-8 key terms
  "suggested_questions": [string],   // exactly 3 short (under 15 words) questions that this paper itself can answer
  "source_pages": {                  // 1-based page numbers supporting each section
    "problem_statement": [int], "methodology": [int], "key_results": [int], "conclusion": [int]
  }
}"""

SYSTEM = (
    "You are an expert research assistant who writes accurate, faithful summaries of academic papers. "
    "Use only information present in the provided text; never invent numbers, authors or claims. "
    "Write clearly for a technically literate reader who has not read the paper. "
    "Every section, especially the conclusion, must reflect only what the authors state: mention limitations "
    "or future work only if the authors wrote them, and never add your own opinions or extrapolations. "
    "Use plain ASCII hyphens and spaces."
)


def _tokens(text: str) -> int:
    return int(len(text.split()) / WORDS_PER_TOKEN)


def _page_tagged(pages: list[PageText]) -> str:
    return "\n\n".join(f"=== Page {p.page} ===\n{p.text}" for p in pages)


HEADING_RE = re.compile(r"^((\d+(\.\d+)*\.?)|[IVX]+\.|[A-Z]\.)\s+[A-Z][\w\- ,:&]{2,60}$|^[A-Z][A-Z \-&]{3,40}$")


NUMBER_ONLY_RE = re.compile(r"^\d{1,2}(\.\d{1,2})*\.?$")


def find_headings(pages: list[PageText]) -> list[tuple[str, int]]:
    """(heading line, page) for lines that look like section headings, in reading order."""
    out = []
    for p in pages:
        lines = [ln.strip() for ln in p.text.splitlines()]
        for i, ln in enumerate(lines):
            # Two-column layouts often put the section number on a line of its own ("5" then "Conclusion").
            if NUMBER_ONLY_RE.match(ln) and i + 1 < len(lines):
                ln = f"{ln} {lines[i + 1]}"
            if HEADING_RE.match(ln) and len(ln.split()) <= 8:
                out.append((ln, p.page))
    return out


def section_outline(pages: list[PageText]) -> str:
    """Lines that look like section headings, with their page numbers."""
    return "\n".join(f"- {ln} (p. {pg})" for ln, pg in find_headings(pages)[:80]) or "(no headings detected)"


def extract_json(text: str) -> dict:
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    raw = fenced.group(1) if fenced else text[text.find("{") : text.rfind("}") + 1]
    if not raw:
        raise ValueError("no JSON object found in model output")
    return json.loads(raw)


def _map_notes(provider: LLMProvider, chunks: list[Chunk], group_tokens: int = MAP_GROUP_TOKENS) -> str:
    groups: list[list[Chunk]] = [[]]
    for ch in chunks:
        if groups[-1] and sum(_tokens(c.text) for c in groups[-1]) + _tokens(ch.text) > group_tokens:
            groups.append([])
        groups[-1].append(ch)
    notes = []
    for i, group in enumerate(groups, 1):
        body = "\n\n".join(f"[p. {c.page}] {c.text}" for c in group)
        prompt = (
            f"This is part {i} of {len(groups)} of a research paper. Write dense bullet-point notes covering the "
            "problem, methods, datasets, experiments, numeric results and conclusions found in this part. "
            "End every bullet with the page it came from, like [p. 7]. Skip references/bibliography.\n\n" + body
        )
        notes.append(
            provider.complete(
                SYSTEM,
                [{"role": "user", "content": prompt}],
                max_tokens=1200,
                task="summary_map",
                hints={"chunks": [(c.page, c.text) for c in group]},
            )
        )
        log.info("map step %d/%d done", i, len(groups))
    return "\n".join(notes)


def generate_summary(
    provider: LLMProvider,
    pages: list[PageText],
    chunks: list[Chunk],
    page_lookup: Callable[[str], list[int]] | None = None,
    title_hint: str = "",
    single_pass_tokens: int = SINGLE_PASS_TOKENS,
    map_group_tokens: int = MAP_GROUP_TOKENS,
) -> dict:
    full = _page_tagged(pages)
    n_pages = len(pages)
    if _tokens(full) <= single_pass_tokens:
        material = "Full paper text (page-tagged):\n\n" + full
    else:
        front = _page_tagged(pages[:2])[:FRONT_MATTER_CHARS]
        notes = _map_notes(provider, chunks, map_group_tokens)
        material = (
            f"FRONT MATTER (first pages; use for title, authors, abstract):\n{front}\n\n"
            f"SECTION OUTLINE:\n{section_outline(pages)}\n\n"
            f"NOTES FROM THE WHOLE PAPER (page-cited):\n{notes}"
        )
    hint = f"Likely title (largest font on page 1): {title_hint}\n" if title_hint else ""
    prompt = (
        f"{material}\n\n---\n{hint}The paper has {n_pages} pages. Summarize it as a single JSON object with exactly this "
        f"shape:\n{SCHEMA_TEXT}\n\nReturn ONLY the JSON object, no prose before or after."
    )
    messages = [{"role": "user", "content": prompt}]
    hints = {"pages": pages, "title_hint": title_hint}
    last_err = None
    for attempt in range(2):
        raw = provider.complete(SYSTEM, messages, max_tokens=3000, task="summary", hints=hints)
        try:
            summary = Summary.model_validate(extract_json(raw))
            break
        except (ValueError, ValidationError) as exc:
            last_err = exc
            log.warning("summary JSON invalid (attempt %d): %s", attempt + 1, exc)
            messages = messages + [
                {"role": "assistant", "content": raw},
                {
                    "role": "user",
                    "content": f"That was not valid JSON for the schema ({str(exc)[:500]}). "
                    "Reply with ONLY the corrected JSON object.",
                },
            ]
    else:
        raise LLMError(f"Model did not return a valid summary: {last_err}")

    return normalize_deep(_fix_source_pages(summary, n_pages, page_lookup, find_headings(pages)).model_dump())


# Which headings own which summary field. A heading only counts when it is a numbered or all-caps line
# whose title is exactly one of these words, so "3 BERT" simply matches nothing and the field falls back
# to retrieval alone.
SECTION_TITLES = {
    "problem_statement": r"introduction|background|motivation",
    "methodology": r"methods?|methodology|approach|model|materials and methods",
    "key_results": r"results?|experiments?|experimental results|evaluation|results and discussion",
    "conclusion": r"conclusions?|conclusions? and future work|concluding remarks|discussion and conclusions?",
}
HEADING_NUM = re.compile(r"^(?:\d+(?:\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s+")
MAX_CLAIMS = 8


def _claims(value) -> list[str]:
    """Split a summary section into separately checkable claims (list items, or sentences of prose)."""
    parts = value if isinstance(value, list) else re.split(r"(?<=[.!?])\s+(?=[A-Z0-9*-])", value)
    claims = [c.strip() for c in parts if len(c.strip()) >= 25]
    return claims[:MAX_CLAIMS] or [c for c in [" ".join(parts).strip()] if c]


def _section_pages(field: str, headings: list[tuple[str, int]], n_pages: int) -> set[int]:
    """Pages from the heading that names this field up to the page of the next numbered top-level heading.

    Unnumbered ALL-CAPS lines may start a section but never end one: table cells and column labels look the same.
    """
    top = [(HEADING_NUM.sub("", t).strip(), pg, bool(re.match(r"^(\d+|[IVX]+)\.?\s", t)), t.isupper()) for t, pg in headings]
    for i, (title, pg, numbered, caps) in enumerate(top):
        if (numbered or caps) and re.fullmatch(SECTION_TITLES[field], title, re.I):
            end = next((p for _, p, n, _c in top[i + 1 :] if n), n_pages)
            return set(range(pg, max(pg, end) + 1))
    return set()


def _fix_source_pages(summary: Summary, n_pages: int, page_lookup, headings=()) -> Summary:
    """Pages that support a section, checked one claim at a time.

    A whole section's text is a poor query: it paraphrases the abstract and introduction, which then outrank
    the passage that really states it. So each claim is looked up on its own, and a cited page survives only if
    some claim retrieves it. If the paper has a heading that names the field (e.g. Conclusion) and a claim
    retrieves a page inside it, those pages replace the rest, since the section itself is the best evidence.
    With no usable evidence the model's pages are dropped rather than guessed, falling back to the two pages
    that most claims retrieve.
    """
    sp = summary.source_pages
    for field in ("problem_statement", "methodology", "key_results", "conclusion"):
        pages = sorted({p for p in getattr(sp, field) if 1 <= p <= n_pages})
        if page_lookup:
            value = getattr(summary, field)
            text = " ".join(value) if isinstance(value, list) else value
            if text.strip():
                votes: dict[int, int] = {}
                for claim in _claims(value):
                    for p in dict.fromkeys(page_lookup(claim)):
                        if 1 <= p <= n_pages:
                            votes[p] = votes.get(p, 0) + 1
                section = _section_pages(field, list(headings), n_pages)
                # The last page of a section also holds the start of the next one, so it needs the model's vote too.
                in_section = sorted(p for p in set(votes) & section if p != max(section) or p in pages)
                log.debug("source_pages %s: votes=%s section=%s cited=%s", field, votes, sorted(section), pages)
                verified = [p for p in pages if p in votes]
                best = sorted(sorted(votes, key=lambda p: -votes[p])[:2])
                pages = in_section or verified or best
        setattr(sp, field, pages)
    summary.suggested_questions = summary.suggested_questions[:3]
    return summary
