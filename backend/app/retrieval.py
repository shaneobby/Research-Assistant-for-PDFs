"""Hybrid retrieval: dense cosine similarity + BM25, fused with Reciprocal Rank Fusion (RRF)."""
import re
import threading
from dataclasses import dataclass

import numpy as np
from rank_bm25 import BM25Okapi

from .chunking import Chunk

_WORD = re.compile(r"[a-z0-9]+")
_STOP = set(
    "a an the of and or to in on for with by is are was were be been this that these those it its as at from "
    "we our us you your they their he she his her what which who whom how why when where does do did can could "
    "would should will shall may might paper about into than then there here also such tell me explain".split()
)
RRF_K = 60


def tokenize(text: str) -> list[str]:
    return [t for t in _WORD.findall(text.lower()) if t not in _STOP]


@dataclass
class Hit:
    chunk: Chunk
    score: float


class PaperIndex:
    def __init__(self, chunks: list[Chunk], vectors: np.ndarray):
        self.chunks = chunks
        self.vectors = vectors
        self.bm25 = BM25Okapi([tokenize(c.text) or ["_"] for c in chunks]) if chunks else None

    def search(self, query: str, query_vec: np.ndarray, k: int = 6) -> list[Hit]:
        if not self.chunks:
            return []
        n = len(self.chunks)
        fused = np.zeros(n)
        if self.vectors.shape[1] == query_vec.shape[0]:
            dense = self.vectors @ query_vec
            for rank, i in enumerate(np.argsort(-dense)):
                fused[i] += 1.0 / (RRF_K + rank + 1)
        q_toks = tokenize(query)
        if q_toks:
            sparse = self.bm25.get_scores(q_toks)
            for rank, i in enumerate(np.argsort(-sparse)):
                if sparse[i] > 0:  # only reward real keyword matches
                    fused[i] += 1.0 / (RRF_K + rank + 1)
        order = np.argsort(-fused, kind="stable")[: min(k, n)]
        top = fused[order[0]] or 1.0
        return [Hit(self.chunks[i], round(float(fused[i] / top), 4)) for i in order]


class IndexCache:
    """Per-paper in-memory index, built lazily from SQLite."""

    def __init__(self):
        self._cache: dict[str, PaperIndex] = {}
        self._lock = threading.Lock()

    def get(self, paper_id: str, loader) -> PaperIndex:
        with self._lock:
            if paper_id not in self._cache:
                chunks, vecs = loader(paper_id)
                self._cache[paper_id] = PaperIndex(chunks, vecs)
            return self._cache[paper_id]

    def drop(self, paper_id: str):
        with self._lock:
            self._cache.pop(paper_id, None)
