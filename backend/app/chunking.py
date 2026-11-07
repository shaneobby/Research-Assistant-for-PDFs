"""Token-ish chunking that keeps page numbers.

We approximate tokens by words (1 word ~ 1.33 tokens) to avoid a tokenizer dependency.
Chunks never cross more than a few pages; each chunk records the page it *starts* on
plus the full set of pages it spans.
"""
import re
from dataclasses import dataclass, field

from .pdf import PageText

WORDS_PER_TOKEN = 0.75


@dataclass
class Chunk:
    idx: int
    page: int
    pages: list[int] = field(default_factory=list)
    text: str = ""


def chunk_pages(pages: list[PageText], chunk_tokens: int = 800, overlap_tokens: int = 120) -> list[Chunk]:
    size = max(50, int(chunk_tokens * WORDS_PER_TOKEN))
    overlap = min(size // 2, int(overlap_tokens * WORDS_PER_TOKEN))
    # Flatten into (word, page) keeping paragraph breaks as a marker word.
    words: list[tuple[str, int]] = []
    for p in pages:
        for para in re.split(r"\n\s*\n", p.text):
            toks = para.split()
            if toks:
                words.extend((w, p.page) for w in toks)
                words.append(("\n\n", p.page))
    chunks: list[Chunk] = []
    start = 0
    while start < len(words):
        end = min(len(words), start + size)
        # Prefer to end on a paragraph break or sentence end in the last 20% of the window.
        if end < len(words):
            for j in range(end, start + int(size * 0.8), -1):
                w = words[j - 1][0]
                if w == "\n\n" or w.endswith((".", "?", "!")):
                    end = j
                    break
        window = words[start:end]
        text = " ".join(w for w, _ in window).replace(" \n\n ", "\n\n").replace("\n\n", "\n\n").strip()
        text = re.sub(r"\s*\n\n\s*", "\n\n", text)
        span = sorted({pg for w, pg in window if w != "\n\n"})
        if text:
            chunks.append(Chunk(idx=len(chunks), page=span[0] if span else window[0][1], pages=span, text=text))
        if end >= len(words):
            break
        start = max(start + 1, end - overlap)
    return chunks
