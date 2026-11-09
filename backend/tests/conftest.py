import pymupdf as fitz
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

PAPER_PAGES = [
    """Sparse Attention Routing for Efficient Long-Document Transformers
Alice Johnson, Bob Smith and Carol Nguyen
University of Testing

Abstract
Transformers struggle with long documents because self-attention scales quadratically with sequence length.
We propose Sparse Attention Routing (SAR), a method that routes each token to a small set of relevant blocks.
SAR reduces memory use by 70% while matching dense attention accuracy on three benchmarks.

1 Introduction
Long documents such as legal contracts and scientific papers exceed the context window of standard models.
The core problem is that quadratic attention makes processing sequences beyond 8k tokens prohibitively expensive.
Existing sparse methods use fixed patterns that miss long-range dependencies between distant sections.""",
    """2 Method
Our approach clusters tokens into blocks of 64 and learns a lightweight router network.
The router scores every block pair and keeps the top four blocks for each query block.
We train the router jointly with the language model using a straight-through estimator.
Experiments use the arXiv summarization dataset and the PubMed corpus with 16k token inputs.""",
    """3 Results
SAR achieves a ROUGE-L of 45.2 on arXiv, outperforming Longformer by 2.1 points.
Peak GPU memory drops from 38 GB to 11 GB, a reduction of 70%.
Training throughput improves by 2.4x compared with dense attention at 16k tokens.

4 Conclusion
Sparse Attention Routing shows that learned routing can replace dense attention for long documents.
A limitation is that the router adds a small latency overhead for short inputs below 1k tokens.
Future work will extend routing to multimodal inputs and streaming settings.""",
]


def make_pdf(pages: list[str]) -> bytes:
    doc = fitz.open()
    for text in pages:
        page = doc.new_page()
        page.insert_textbox(fitz.Rect(50, 50, 560, 800), text, fontsize=10)
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def paper_pdf() -> bytes:
    return make_pdf(PAPER_PAGES)


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        _env_file=None,
        llm_provider="mock",
        embedding_backend="hash",
        data_dir=tmp_path / "data",
        max_upload_mb=1,
    )
    with TestClient(create_app(settings), base_url="http://localhost") as c:
        yield c
