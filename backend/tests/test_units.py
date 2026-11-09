import numpy as np
import pytest

from app.chunking import chunk_pages, estimate_tokens
from app.config import Settings
from app.embeddings import HashEmbedder
from app.llm.mock import MockProvider
from app.pdf import PageText
from app.retrieval import PaperIndex
from app.service import PaperService
from app.summarizer import extract_json, generate_summary


def test_chunking_keeps_pages_and_overlaps():
    pages = [PageText(i, ". ".join(["word%d" % i] * 900)) for i in range(1, 4)]
    chunks = chunk_pages(pages, chunk_tokens=800, overlap_tokens=120)
    assert len(chunks) > 3
    assert chunks[0].page == 1 and chunks[-1].page == 3
    assert all(c.pages == sorted(c.pages) for c in chunks)
    a, b = chunks[0].text.split(), chunks[1].text.split()
    assert a[-10:] == b[:10] or set(a[-50:]) & set(b[:50])  # overlap


def test_two_column_page_keeps_column_order():
    import pymupdf as fitz

    from app.pdf import extract_pages

    left = [f"left sentence number {i} continues the first column." for i in range(12)]
    right = [f"right sentence number {i} continues the second column." for i in range(12)]
    doc = fitz.open()
    page = doc.new_page()
    # Same font and origin, so both columns' lines share baselines: the case y-sorting interleaves.
    page.insert_textbox(fitz.Rect(36, 50, 296, 700), "\n".join(left), fontsize=9)
    page.insert_textbox(fitz.Rect(316, 50, 576, 700), "\n".join(right), fontsize=9)
    data = doc.tobytes()
    doc.close()

    text = extract_pages(data)[0].text
    assert [ln for ln in text.splitlines() if ln] == left + right


HARD_PAGE = (
    "Prose about attention mechanisms and backpropagation in neural networks. " * 80
    + "\n\nTable 2 0.123 45.67 8.9e-10 1,234,567 (a) [17] p<0.05 " * 60
    + "\n\nf(x)=Σ_{i=1}^{N} α_i·β_j/√(d_k) ∀x∈ℝ " * 80
    + "\n\nhttps://example.org/" + "averyveryverylongunbrokenpathsegment" * 30
)


def _bge_tokenizer():
    import glob
    import os
    import tempfile

    from tokenizers import Tokenizer

    pattern = "models--Qdrant--bge-small-en-v1.5-onnx-Q/snapshots/*/tokenizer.json"
    found = glob.glob(os.path.join(tempfile.gettempdir(), "fastembed_cache", pattern))
    if not found:
        pytest.skip("bge-small tokenizer is not cached")
    tokenizer = Tokenizer.from_file(found[0])
    tokenizer.no_truncation()
    return tokenizer


def test_chunks_fit_the_embedder_window():
    chunks = chunk_pages([PageText(1, HARD_PAGE)])  # default config
    assert len(chunks) > 3
    assert all(estimate_tokens(c.text) <= 512 for c in chunks)
    tokenizer = _bge_tokenizer()
    assert max(len(tokenizer.encode(c.text).ids) for c in chunks) <= 512  # counts [CLS] and [SEP]


def test_stale_index_is_rebuilt_from_the_pdf(tmp_path, paper_pdf):
    def service(**overrides):
        settings = Settings(
            _env_file=None, llm_provider="mock", embedding_backend="hash", data_dir=tmp_path, **overrides
        )
        return PaperService(settings, MockProvider("m"))

    old = service(chunk_tokens=100, chunk_overlap_tokens=10)
    pid = old.create("p.pdf", paper_pdf)["id"]
    old.process(pid)
    summary = old.store.get_paper(pid)["summary"]
    signature = old.store.index_signature(pid)

    old.reindex_stale()  # unchanged config: nothing is rebuilt
    assert old.store.index_signature(pid) == signature

    with old.store._conn() as c:  # simulate text stored by an older extractor
        c.execute("UPDATE page_texts SET text = 'scrambled' WHERE paper_id = ?", (pid,))

    new = service(chunk_tokens=60, chunk_overlap_tokens=5)
    new.reindex_stale()
    assert new.store.index_signature(pid) != signature
    assert "scrambled" not in new.store.get_pages(pid)[0].text
    assert any("Sparse Attention Routing" in c.text for c in new.store.load_chunks(pid)[0])
    assert new.store.get_paper(pid)["summary"] == summary


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


def test_normalize_text_maps_odd_punctuation():
    from app.textnorm import normalize_deep, normalize_text

    assert normalize_text("self‑attention‐based") == "self-attention-based"
    assert normalize_text("28.4 BLEU score") == "28.4 BLEU score"
    assert normalize_text("see 【p. 8】") == "see [p. 8]"
    assert normalize_text("soft­hyphen​") == "softhyphen"
    assert normalize_text("plain – en dash and café stay") == "plain – en dash and café stay"
    assert normalize_deep({"a": ["x‑y", {"b": " z"}], "n": 3}) == {"a": ["x-y", {"b": " z"}], "n": 3}


def test_normalize_text_is_token_safe():
    from app.textnorm import normalize_text

    text = "the 【p. 8】 self‑attention model"
    tokens = [text[i : i + 3] for i in range(0, len(text), 3)]  # arbitrary chunking
    assert "".join(normalize_text(t) for t in tokens) == normalize_text(text)
