"""Measure retrieval quality on papers with known answer pages. Read-only: everything runs in a temp DATA_DIR.

    python scripts/eval_retrieval.py --pdf transformer=path/to/1706.03762.pdf [--two-column]

`--two-column` also evaluates a synthetic two-column reflow of each PDF (same text, same page numbers).
Questions and gold pages live in tests/eval/questions.json, keyed by the label given to --pdf.
Chunk settings come from the environment as usual (CHUNK_TOKENS, CHUNK_OVERLAP_TOKENS); uses the mock LLM.
"""
import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

import pymupdf as fitz

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.config import Settings  # noqa: E402
from app.llm.mock import MockProvider  # noqa: E402
from app.pdf import extract_pages  # noqa: E402
from app.schemas import Summary  # noqa: E402
from app.service import PaperService  # noqa: E402

CUTOFFS = (1, 3, 6)


def two_column_reflow(data: bytes) -> bytes:
    """Rewrite each page as two equal columns, so lines of both columns share baselines."""
    src = fitz.open(stream=data, filetype="pdf")
    out = fitz.open()
    for page in src:
        lines = [ln for ln in page.get_text("text").splitlines() if ln.strip()]
        half = len(lines) // 2
        target = out.new_page()
        for rect, part in ((fitz.Rect(36, 40, 300, 800), lines[:half]), (fitz.Rect(312, 40, 576, 800), lines[half:])):
            target.insert_textbox(rect, "\n".join(part), fontsize=6.5)
    result = out.tobytes()
    src.close()
    out.close()
    return result


def evaluate(name: str, data: bytes, questions: list[dict]) -> dict:
    t0 = time.perf_counter()
    page_count = len(extract_pages(data))
    extract_ms = (time.perf_counter() - t0) * 1000 / page_count

    with tempfile.TemporaryDirectory() as tmp:
        settings = Settings(_env_file=None, llm_provider="mock", data_dir=Path(tmp))
        service = PaperService(settings, MockProvider(settings.model))
        paper = service.create(f"{name}.pdf", data)
        t1 = time.perf_counter()
        service.process(paper["id"])
        index_s = time.perf_counter() - t1
        stored = service.store.get_paper(paper["id"])
        assert stored["status"] == "ready", stored.get("error")
        Summary.model_validate(stored["summary"])  # mock summary must still validate

        hits_at = dict.fromkeys(CUTOFFS, 0)
        reciprocal = 0.0
        misses = []
        for item in questions:
            ranked = [h.chunk.page for h in service.retrieve(paper["id"], item["q"], k=max(CUTOFFS))]
            gold = set(item["gold"])
            first = next((rank for rank, page in enumerate(ranked, 1) if page in gold), None)
            if first is None:
                misses.append(item["q"])
                continue
            reciprocal += 1 / first
            for cutoff in CUTOFFS:
                hits_at[cutoff] += first <= cutoff
        n_chunks = len(service.store.load_chunks(paper["id"])[0])
        del service

    n = len(questions)
    return {
        "variant": name,
        **{f"recall@{c}": round(hits_at[c] / n, 3) for c in CUTOFFS},
        "mrr": round(reciprocal / n, 3),
        "chunks": n_chunks,
        "extract_ms_per_page": round(extract_ms, 1),
        "index_and_summary_s": round(index_s, 2),
        "misses": misses,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pdf", action="append", required=True, metavar="LABEL=PATH")
    parser.add_argument("--two-column", action="store_true")
    args = parser.parse_args()

    all_questions = json.loads((BACKEND / "tests" / "eval" / "questions.json").read_text(encoding="utf-8"))
    for spec in args.pdf:
        label, path = spec.split("=", 1)
        data = Path(path).read_bytes()
        print(json.dumps(evaluate(label, data, all_questions[label])))
        if args.two_column:
            print(json.dumps(evaluate(f"{label}-2col", two_column_reflow(data), all_questions[label])))


if __name__ == "__main__":
    main()
