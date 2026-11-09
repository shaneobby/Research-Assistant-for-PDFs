"""Chunking sized for the embedder that keeps page numbers exact.

bge-small truncates input at 512 tokens, so anything past that is invisible to dense search. Tokens are
estimated per word with a slightly pessimistic rule that also holds up on maths and tables, where word counts
badly undercount, without needing a tokenizer here. Chunks never cross a page boundary, so every retrieved
passage maps to exactly one page and `[p. N]` citations are precise. Long pages are split into overlapping
windows that prefer to end on a paragraph or sentence boundary.
"""
import re
from dataclasses import dataclass, field

from .pdf import PageText

WORDS_PER_TOKEN = 0.75  # rough LLM-side ratio, used to size summary prompts
CHUNKER_VERSION = 2 # bump when chunk boundaries change, so stored papers get re-indexed
MIN_TAIL_TOKENS = 30  # a page tail smaller than this is merged into the previous window
MAX_WORD_CHARS = 40  # longer unbroken strings (URLs, garbled maths) are cut so one "word" can't fill a window
PARAGRAPH = "\n\n"
_RUN = re.compile(r"[a-z]+|[0-9]+|[^a-z0-9]", re.S)


@dataclass
class Chunk:
    idx: int
    page: int
    pages: list[int] = field(default_factory=list)
    text: str = ""


def estimate_tokens(text: str) -> int:
    """Upper-leaning estimate of the WordPiece token count (bge-small's tokenizer)."""
    total = 0
    for word in text.split():
        for run in _RUN.findall(word.lower()):
            if run.isascii() and run.isalpha():
                total += 1 + len(run) // 6
            elif run.isascii() and run.isdigit():
                total += 1 + len(run) // 3
            else:
                total += 1  # punctuation and non-ASCII symbols are one token per character
    return total


def _windows(words: list[str], costs: list[int], size: int, overlap: int) -> list[tuple[int, int]]:
    spans, start, n = [], 0, len(words)
    while start < n:
        end, used = start, 0
        while end < n and used + costs[end] <= size:
            used += costs[end]
            end += 1
        end = max(end, start + 1)
        if end < n:
            if sum(costs[end:]) < MIN_TAIL_TOKENS:
                end = n
            else:
                end = _snap_to_boundary(words, costs, start, end, used, size)
        spans.append((start, end))
        if end >= n:
            break
        back, kept = end, 0
        while back > start + 1 and kept + costs[back - 1] <= overlap:
            kept += costs[back - 1]
            back -= 1
        start = max(start + 1, back)
    return spans


def _snap_to_boundary(words: list[str], costs: list[int], start: int, end: int, used: int, size: int) -> int:
    """Move `end` back to a paragraph or sentence end, giving up at most 20% of the window."""
    for j in range(end, start, -1):
        if used < size * 0.8:
            break
        if words[j - 1] == PARAGRAPH or words[j - 1].endswith((".", "?", "!")):
            return j
        used -= costs[j - 1]
    return end


def _split_long(word: str) -> list[str]:
    return [word[i : i + MAX_WORD_CHARS] for i in range(0, len(word), MAX_WORD_CHARS)]


def chunk_pages(pages: list[PageText], chunk_tokens: int = 450, overlap_tokens: int = 60) -> list[Chunk]:
    size = max(50, chunk_tokens)
    overlap = min(size // 2, overlap_tokens)
    chunks: list[Chunk] = []
    for p in pages:
        words: list[str] = []
        for para in re.split(r"\n\s*\n", p.text):
            toks = [piece for tok in para.split() for piece in _split_long(tok)]
            if toks:
                words.extend(toks)
                words.append(PARAGRAPH)
        costs = [0 if w == PARAGRAPH else estimate_tokens(w) for w in words]
        for start, end in _windows(words, costs, size, overlap):
            text = re.sub(r"\s*\n\n\s*", "\n\n", " ".join(words[start:end])).strip()
            if text:
                chunks.append(Chunk(idx=len(chunks), page=p.page, pages=[p.page], text=text))
    return chunks
