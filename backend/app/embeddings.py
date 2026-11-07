"""Local embeddings.

Default: fastembed with BAAI/bge-small-en-v1.5 (ONNX, runs on CPU, no API key; the model is
downloaded once, ~70 MB). If fastembed can't load (offline, missing wheel) we fall back to a
dependency-free hashing embedder so the app keeps working; BM25 still carries keyword recall.
"""
import hashlib
import logging
import re
import threading

import numpy as np

log = logging.getLogger(__name__)
_TOKEN = re.compile(r"[a-z0-9]+")


class HashEmbedder:
    """Feature-hashed bag of words + bigrams. Crude but deterministic and instant."""

    def __init__(self, dim: int = 512):
        self.dim = dim
        self.name = f"hash-{dim}"

    def _vec(self, text: str) -> np.ndarray:
        v = np.zeros(self.dim, dtype=np.float32)
        toks = _TOKEN.findall(text.lower())
        for feat in toks + [a + "_" + b for a, b in zip(toks, toks[1:])]:
            h = int.from_bytes(hashlib.md5(feat.encode()).digest()[:8], "little")
            v[h % self.dim] += 1.0 if (h >> 63) == 0 else -1.0
        n = np.linalg.norm(v)
        return v / n if n else v

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), dtype=np.float32)
        return np.stack([self._vec(t) for t in texts])

    def embed_query(self, text: str) -> np.ndarray:
        return self._vec(text)


class FastEmbedder:
    def __init__(self, model_name: str):
        from fastembed import TextEmbedding

        self.name = model_name
        self._model = TextEmbedding(model_name=model_name)

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        return np.array(list(self._model.passage_embed(texts)), dtype=np.float32)

    def embed_query(self, text: str) -> np.ndarray:
        return np.array(next(iter(self._model.query_embed(text))), dtype=np.float32)


_embedder = None
_lock = threading.Lock()


def get_embedder(backend: str, model_name: str):
    global _embedder
    with _lock:
        if _embedder is None:
            if backend == "fastembed":
                try:
                    _embedder = FastEmbedder(model_name)
                    log.info("Embeddings: fastembed %s", model_name)
                except Exception as exc:
                    log.warning("fastembed unavailable (%s); falling back to hash embeddings", exc)
                    _embedder = HashEmbedder()
            else:
                _embedder = HashEmbedder()
        return _embedder
