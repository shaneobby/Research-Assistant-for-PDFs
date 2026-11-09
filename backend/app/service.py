"""Glue between storage, indexing, the LLM and the HTTP layer."""
import logging
import threading
import uuid

from .chunking import chunk_pages
from .config import Settings
from .db import Store
from .embeddings import get_embedder
from .llm import LLMProvider
from .pdf import extract_pages, guess_title
from .retrieval import Hit, IndexCache
from .summarizer import generate_summary

log = logging.getLogger(__name__)


class PaperService:
    def __init__(self, settings: Settings, provider: LLMProvider):
        self.settings = settings
        self.provider = provider
        self.store = Store(settings.resolved_data_dir)
        self.indexes = IndexCache()
        self._busy: set[str] = set()
        self._busy_lock = threading.Lock()

    @property
    def embedder(self):
        return get_embedder(self.settings.embedding_backend, self.settings.embedding_model)

    # ---- ingestion ----------------------------------------------------
    def create(self, filename: str, data: bytes) -> dict:
        pages = extract_pages(data)  # raises PdfError -> 400
        paper_id = str(uuid.uuid4())
        return self.store.create_paper(paper_id, filename, pages, data)

    def process(self, paper_id: str, force_summary: bool = False) -> None:
        """Index (if needed) and summarize. Safe to call from a background thread."""
        with self._busy_lock:
            if paper_id in self._busy:
                return
            self._busy.add(paper_id)
        try:
            self.store.set_status(paper_id, "processing")
            pages = self.store.get_pages(paper_id)
            if not self.store.has_chunks(paper_id):
                chunks = chunk_pages(pages, self.settings.chunk_tokens, self.settings.chunk_overlap_tokens)
                vecs = self.embedder.embed_documents([c.text for c in chunks])
                self.store.save_chunks(paper_id, chunks, vecs)
                self.indexes.drop(paper_id)
                log.info("indexed %s: %d chunks", paper_id, len(chunks))
            chunks, _ = self.store.load_chunks(paper_id)
            pdf_file = self.store.pdf_path(paper_id)
            title_hint = guess_title(pdf_file.read_bytes()) if pdf_file.exists() else ""
            summary = generate_summary(
                self.provider,
                pages,
                chunks,
                page_lookup=lambda t: self._pages_for(paper_id, t),
                title_hint=title_hint,
                single_pass_tokens=self.settings.summary_single_pass_tokens,
                map_group_tokens=self.settings.summary_map_group_tokens,
            )
            if self.store.get_paper(paper_id) is None:  # deleted meanwhile
                return
            self.store.set_status(paper_id, "ready", summary=summary)
        except Exception as exc:
            log.exception("processing failed for %s", paper_id)
            if self.store.get_paper(paper_id) is not None:
                self.store.set_status(paper_id, "error", error=str(exc)[:500] or exc.__class__.__name__)
        finally:
            with self._busy_lock:
                self._busy.discard(paper_id)

    def resume_unfinished(self) -> None:
        """Papers left in `processing` by a restart get picked up again."""
        for pid in self.store.ids_with_status("processing"):
            threading.Thread(target=self.process, args=(pid,), daemon=True).start()

    # ---- retrieval ----------------------------------------------------
    def retrieve(self, paper_id: str, query: str, k: int | None = None) -> list[Hit]:
        index = self.indexes.get(paper_id, self.store.load_chunks)
        return index.search(query, self.embedder.embed_query(query), k or self.settings.top_k)

    def _pages_for(self, paper_id: str, text: str) -> list[int]:
        hits = self.retrieve(paper_id, text[:1500], k=5)
        return list(dict.fromkeys(h.chunk.page for h in hits))  # best-ranked first

    def delete(self, paper_id: str) -> bool:
        self.indexes.drop(paper_id)
        return self.store.delete_paper(paper_id)
