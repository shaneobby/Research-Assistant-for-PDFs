"""SQLite persistence for papers, summaries, page texts and chunks (+ embeddings as float32 blobs)."""
import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .chunking import Chunk
from .pdf import PageText

SCHEMA = """
CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    pages INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    summary_json TEXT
);
CREATE TABLE IF NOT EXISTS page_texts (
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (paper_id, page)
);
CREATE TABLE IF NOT EXISTS chunks (
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    page INTEGER NOT NULL,
    pages_json TEXT NOT NULL,
    text TEXT NOT NULL,
    embedding BLOB,
    PRIMARY KEY (paper_id, idx)
);
CREATE TABLE IF NOT EXISTS index_meta (
    paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
    signature TEXT NOT NULL
);
"""


class Store:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.pdf_dir = self.data_dir / "pdfs"
        self.pdf_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "papers.sqlite3"
        self._lock = threading.Lock()
        with self._conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # ---- papers -------------------------------------------------------
    def pdf_path(self, paper_id: str) -> Path:
        return self.pdf_dir / f"{paper_id}.pdf"

    def create_paper(self, paper_id: str, filename: str, pages: list[PageText], data: bytes) -> dict:
        self.pdf_path(paper_id).write_bytes(data)
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._conn() as c:
            c.execute(
                "INSERT INTO papers (id, filename, pages, created_at, status) VALUES (?, ?, ?, ?, ?)",
                (paper_id, filename, len(pages), now, "processing"),
            )
            c.executemany(
                "INSERT INTO page_texts (paper_id, page, text) VALUES (?, ?, ?)",
                [(paper_id, p.page, p.text) for p in pages],
            )
        return self.get_paper(paper_id)

    def get_paper(self, paper_id: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
        return _row_to_paper(row) if row else None

    def list_papers(self) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM papers ORDER BY created_at DESC").fetchall()
        return [_row_to_paper(r, with_summary=False) for r in rows]

    def ids_with_status(self, status: str) -> list[str]:
        with self._conn() as c:
            return [r[0] for r in c.execute("SELECT id FROM papers WHERE status = ?", (status,))]

    def set_status(self, paper_id: str, status: str, error: str | None = None, summary: dict | None = None):
        with self._lock, self._conn() as c:
            if summary is not None:
                c.execute(
                    "UPDATE papers SET status = ?, error = ?, summary_json = ? WHERE id = ?",
                    (status, error, json.dumps(summary), paper_id),
                )
            else:
                c.execute("UPDATE papers SET status = ?, error = ? WHERE id = ?", (status, error, paper_id))

    def delete_paper(self, paper_id: str) -> bool:
        with self._lock, self._conn() as c:
            cur = c.execute("DELETE FROM papers WHERE id = ?", (paper_id,))
        deleted = cur.rowcount > 0
        if deleted:
            self.pdf_path(paper_id).unlink(missing_ok=True)
        return deleted

    # ---- pages / chunks ----------------------------------------------
    def get_pages(self, paper_id: str) -> list[PageText]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT page, text FROM page_texts WHERE paper_id = ? ORDER BY page", (paper_id,)
            ).fetchall()
        return [PageText(r["page"], r["text"]) for r in rows]

    def replace_pages(self, paper_id: str, pages: list[PageText]):
        with self._lock, self._conn() as c:
            c.executemany(
                "UPDATE page_texts SET text = ? WHERE paper_id = ? AND page = ?",
                [(p.text, paper_id, p.page) for p in pages],
            )

    def index_signature(self, paper_id: str) -> str | None:
        with self._conn() as c:
            row = c.execute("SELECT signature FROM index_meta WHERE paper_id = ?", (paper_id,)).fetchone()
        return row["signature"] if row else None

    def save_chunks(self, paper_id: str, chunks: list[Chunk], embeddings: np.ndarray, signature: str):
        rows = [
            (paper_id, ch.idx, ch.page, json.dumps(ch.pages), ch.text, embeddings[i].astype(np.float32).tobytes())
            for i, ch in enumerate(chunks)
        ]
        with self._lock, self._conn() as c:
            c.execute("DELETE FROM chunks WHERE paper_id = ?", (paper_id,))
            c.executemany(
                "INSERT INTO chunks (paper_id, idx, page, pages_json, text, embedding) VALUES (?, ?, ?, ?, ?, ?)",
                rows,
            )
            c.execute("INSERT OR REPLACE INTO index_meta (paper_id, signature) VALUES (?, ?)", (paper_id, signature))

    def has_chunks(self, paper_id: str) -> bool:
        with self._conn() as c:
            return c.execute("SELECT 1 FROM chunks WHERE paper_id = ? LIMIT 1", (paper_id,)).fetchone() is not None

    def load_chunks(self, paper_id: str) -> tuple[list[Chunk], np.ndarray]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT idx, page, pages_json, text, embedding FROM chunks WHERE paper_id = ? ORDER BY idx",
                (paper_id,),
            ).fetchall()
        chunks = [Chunk(idx=r["idx"], page=r["page"], pages=json.loads(r["pages_json"]), text=r["text"]) for r in rows]
        if not rows:
            return chunks, np.zeros((0, 1), dtype=np.float32)
        vecs = np.stack([np.frombuffer(r["embedding"], dtype=np.float32) for r in rows])
        return chunks, vecs


def _row_to_paper(row: sqlite3.Row, with_summary: bool = True) -> dict:
    d = {
        "id": row["id"],
        "filename": row["filename"],
        "pages": row["pages"],
        "created_at": row["created_at"],
        "status": row["status"],
        "error": row["error"],
    }
    if with_summary:
        d["summary"] = json.loads(row["summary_json"]) if row["summary_json"] else None
    return d
