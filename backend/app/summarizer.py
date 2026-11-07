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
  "conclusion": string,              // what they conclude, limitations, future work
  "keywords": [string],              // 4-8 key terms
  "suggested_questions": [string],   // exactly 3 insightful questions a reader might ask about this paper
  "source_pages": {                  // 1-based page numbers supporting each section
    "problem_statement": [int], "methodology": [int], "key_results": [int], "conclusion": [int]
  }
}"""

SYSTEM = (
    "You are an expert research assistant who writes accurate, faithful summaries of academic papers. "
    "Use only information present in the provided text; never invent numbers, authors or claims. "
    "Write clearly for a technically literate reader who has not read the paper."
)


def _tokens(text: str) -> int:
    return int(len(text.split()) / WORDS_PER_TOKEN)


def _page_tagged(pages: list[PageText]) -> str:
    return "\n\n".join(f"=== Page {p.page} ===\n{p.text}" for p in pages)


def section_outline(pages: list[PageText]) -> str:
    """Lines that look like section headings, with their page numbers."""
    pat = re.compile(r"^((\d+(\.\d+)*\.?)|[IVX]+\.|[A-Z]\.)\s+[A-Z][\w\- ,:&]{2,60}$|^[A-Z][A-Z \-&]{3,40}$")
    out = []
    for p in pages:
        for ln in p.text.splitlines():
            ln = ln.strip()
            if pat.match(ln) and len(ln.split()) <= 8:
                out.append(f"- {ln} (p. {p.page})")
    return "\n".join(out[:80]) or "(no headings detected)"


def extract_json(text: str) -> dict:
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    raw = fenced.group(1) if fenced else text[text.find("{") : text.rfind("}") + 1]
    if not raw:
        raise ValueError("no JSON object found in model output")
    return json.loads(raw)


def _map_notes(provider: LLMProvider, chunks: list[Chunk]) -> str:
    groups: list[list[Chunk]] = [[]]
    for ch in chunks:
        if groups[-1] and sum(_tokens(c.text) for c in groups[-1]) + _tokens(ch.text) > MAP_GROUP_TOKENS:
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
) -> dict:
    full = _page_tagged(pages)
    n_pages = len(pages)
    if _tokens(full) <= SINGLE_PASS_TOKENS:
        material = "Full paper text (page-tagged):\n\n" + full
    else:
        front = _page_tagged(pages[:2])[:FRONT_MATTER_CHARS]
        notes = _map_notes(provider, chunks)
        material = (
            f"FRONT MATTER (first pages; use for title, authors, abstract):\n{front}\n\n"
            f"SECTION OUTLINE:\n{section_outline(pages)}\n\n"
            f"NOTES FROM THE WHOLE PAPER (page-cited):\n{notes}"
        )
    prompt = (
        f"{material}\n\n---\nThe paper has {n_pages} pages. Summarize it as a single JSON object with exactly this "
        f"shape:\n{SCHEMA_TEXT}\n\nReturn ONLY the JSON object, no prose before or after."
    )
    messages = [{"role": "user", "content": prompt}]
    hints = {"pages": pages}
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

    return _fix_source_pages(summary, n_pages, page_lookup).model_dump()


def _fix_source_pages(summary: Summary, n_pages: int, page_lookup) -> Summary:
    sp = summary.source_pages
    for field in ("problem_statement", "methodology", "key_results", "conclusion"):
        pages = sorted({p for p in getattr(sp, field) if 1 <= p <= n_pages})
        if not pages and page_lookup:
            value = getattr(summary, field)
            text = " ".join(value) if isinstance(value, list) else value
            if text.strip():
                pages = page_lookup(text)
        setattr(sp, field, pages)
    summary.suggested_questions = summary.suggested_questions[:3]
    return summary
