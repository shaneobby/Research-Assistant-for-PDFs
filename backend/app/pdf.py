"""PDF validation and per-page text extraction (PyMuPDF)."""
from dataclasses import dataclass

import pymupdf as fitz

MIN_TEXT_CHARS = 200


class PdfError(ValueError):
    """Raised for PDFs we can't use; message is user-facing."""


@dataclass
class PageText:
    page: int  # 1-based
    text: str


def extract_pages(data: bytes) -> list[PageText]:
    if not data.lstrip()[:5].startswith(b"%PDF"):
        raise PdfError("File is not a PDF.")
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:  # corrupt file
        raise PdfError(f"Could not open PDF: {exc}") from exc
    try:
        if doc.needs_pass or doc.is_encrypted:
            raise PdfError("PDF is password-protected/encrypted.")
        if doc.page_count == 0:
            raise PdfError("PDF has no pages.")
        pages = [PageText(i + 1, _clean(p.get_text("text", sort=True))) for i, p in enumerate(doc)]
    finally:
        doc.close()
    if sum(len(p.text) for p in pages) < MIN_TEXT_CHARS:
        raise PdfError("PDF has no extractable text (is it a scanned image?).")
    return pages


def guess_title(data: bytes) -> str:
    """Title = the largest-font text in the top half of page 1 (falls back to PDF metadata)."""
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        return ""
    try:
        page = doc[0]
        spans = [
            (round(s["size"], 1), s["text"].strip(), s["bbox"][1])
            for b in page.get_text("dict")["blocks"]
            for ln in b.get("lines", [])
            for s in ln["spans"]
            if s["text"].strip() and s["bbox"][1] < page.rect.height * 0.5
        ]
        candidates = [s for s in spans if len(s[1]) > 3 and not s[1].lower().startswith("arxiv")]
        if candidates:
            top = max(s[0] for s in candidates)
            title = " ".join(t for size, t, _ in sorted(spans, key=lambda s: s[2]) if abs(size - top) < 0.6)
            title = " ".join(title.split())
            if 2 <= len(title.split()) <= 30:
                return title
        meta = (doc.metadata or {}).get("title", "").strip()
        return meta if len(meta.split()) >= 2 else ""
    finally:
        doc.close()


def _clean(text: str) -> str:
    # Re-join words hyphenated across line breaks, normalise whitespace per line.
    text = text.replace("­", "")
    text = text.replace("-\n", "")
    lines = [" ".join(line.split()) for line in text.splitlines()]
    out: list[str] = []
    for line in lines:
        if line or (out and out[-1]):
            out.append(line)
    return "\n".join(out).strip()
