"""Token-ish chunking that keeps page numbers exact.

Tokens are approximated by words (1 word ~ 1.33 tokens) to avoid a tokenizer dependency.
Chunks never cross a page boundary, so every retrieved passage maps to exactly one page and
`[p. N]` citations are precise. Long pages are split into overlapping windows that prefer
to end on a paragraph or sentence boundary.
"""
import re
from dataclasses import dataclass, field

from .pdf import PageText

WORDS_PER_TOKEN = 0.75
MIN_CHUNK_WORDS = 25  # a page tail shorter than this is merged into the previous window


@dataclass
class Chunk:
    idx: int
    page: int
    pages: list[int] = field(default_factory=list)
    text: str = ""


def _windows(words: list[str], size: int, overlap: int) -> list[tuple[int, int]]:
    spans, start = [], 0
    while start < len(words):
        end = min(len(words), start + size)
        if end < len(words):
            if len(words) - end < MIN_CHUNK_WORDS:
                end = len(words)
            else:
                for j in range(end, start + int(size * 0.8), -1):
                    w = words[j - 1]
                    if w == "\n\n" or w.endswith((".", "?", "!")):
                        end = j
                        break
        spans.append((start, end))
        if end >= len(words):
            break
        start = max(start + 1, end - overlap)
    return spans


def chunk_pages(pages: list[PageText], chunk_tokens: int = 800, overlap_tokens: int = 120) -> list[Chunk]:
    size = max(50, int(chunk_tokens * WORDS_PER_TOKEN))
    overlap = min(size // 2, int(overlap_tokens * WORDS_PER_TOKEN))
    chunks: list[Chunk] = []
    for p in pages:
        words: list[str] = []
        for para in re.split(r"\n\s*\n", p.text):
            toks = para.split()
            if toks:
                words.extend(toks)
                words.append("\n\n")  # paragraph marker
        for start, end in _windows(words, size, overlap):
            text = re.sub(r"\s*\n\n\s*", "\n\n", " ".join(words[start:end])).strip()
            if text:
                chunks.append(Chunk(idx=len(chunks), page=p.page, pages=[p.page], text=text))
    return chunks
