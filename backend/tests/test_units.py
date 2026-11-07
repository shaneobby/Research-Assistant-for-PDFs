import numpy as np

from app.chunking import chunk_pages
from app.embeddings import HashEmbedder
from app.llm.mock import MockProvider
from app.pdf import PageText
from app.retrieval import PaperIndex
from app.summarizer import extract_json, generate_summary


def test_chunking_keeps_pages_and_overlaps():
    pages = [PageText(i, ". ".join(["word%d" % i] * 900)) for i in range(1, 4)]
    chunks = chunk_pages(pages, chunk_tokens=800, overlap_tokens=120)
    assert len(chunks) > 3
    assert chunks[0].page == 1 and chunks[-1].page == 3
    assert all(c.pages == sorted(c.pages) for c in chunks)
    a, b = chunks[0].text.split(), chunks[1].text.split()
    assert a[-10:] == b[:10] or set(a[-50:]) & set(b[:50])  # overlap


def test_hybrid_retrieval_finds_keyword_chunk():
    from app.chunking import Chunk

    texts = ["cats sit on mats", "the transformer uses sparse attention routing", "dogs bark loudly at night"]
    chunks = [Chunk(i, i + 1, [i + 1], t) for i, t in enumerate(texts)]
    emb = HashEmbedder()
    index = PaperIndex(chunks, emb.embed_documents(texts))
    hits = index.search("sparse attention", emb.embed_query("sparse attention"), k=2)
    assert hits[0].chunk.page == 2 and hits[0].score == 1.0


def test_extract_json_handles_fences_and_prose():
    assert extract_json('Sure!\n```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('Here: {"a": {"b": 2}} done') == {"a": {"b": 2}}


class FlakyProvider(MockProvider):
    """Returns garbage first, then valid JSON — exercises the retry."""

    calls = 0

    def complete(self, system, messages, **kw):
        if kw.get("task") == "summary":
            FlakyProvider.calls += 1
            if FlakyProvider.calls == 1:
                return "not json at all"
        return super().complete(system, messages, **kw)


def test_summary_retries_once_on_bad_json():
    pages = [PageText(1, "A Title Here\n\nAbstract\nWe do things. " * 5 + "\n\n1 Introduction\nThe problem is hard. " * 10)]
    out = generate_summary(FlakyProvider("m"), pages, [], page_lookup=lambda t: [1])
    assert FlakyProvider.calls == 2
    assert out["title"] == "A Title Here"
    assert np.all([p == [1] or p == [] for p in out["source_pages"].values()])
