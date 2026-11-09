# Backend: Paper Summarizer API

FastAPI service that takes a research-paper PDF, builds a structured summary and answers
questions about the paper with retrieval-augmented generation (RAG), streamed over SSE.
The API is specified in [`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md).

It runs **without any API key**: the default `mock` provider gives deterministic, extractive
output taken from the paper itself. Set a real provider when you want generated summaries.

## Setup

Requires Python 3.12.

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # optional: the defaults work (mock provider)
uvicorn app.main:app --reload --port 8000
```

Check it's up: <http://localhost:8000/api/health>. Interactive docs: <http://localhost:8000/docs>.

When you upload the first paper, `fastembed` downloads the embedding model
(`BAAI/bge-small-en-v1.5`, about 70 MB, cached afterwards). Offline? Set `EMBEDDING_BACKEND=hash`
or let it fall back automatically; BM25 keyword search still works either way.

### Tests

```bash
cd backend
pytest
```

The tests use the mock provider, hash embeddings and a temporary data directory. They generate
their own PDFs, so they need no network access and no key.

## Configuration (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `mock` | `mock` \| `anthropic` \| `openai` |
| `LLM_MODEL` | per provider | anthropic: `claude-sonnet-5-5`, openai: `gpt-4o-mini` |
| `ANTHROPIC_API_KEY` | – | required for `anthropic` |
| `OPENAI_API_KEY` | – | required for `openai` (any value for local servers) |
| `OPENAI_BASE_URL` | – | OpenAI-compatible servers: Ollama `http://localhost:11434/v1`, Groq `https://api.groq.com/openai/v1`, OpenRouter `https://openrouter.ai/api/v1` |
| `EMBEDDING_BACKEND` | `fastembed` | `fastembed` (local ONNX) \| `hash` (no download) |
| `EMBEDDING_MODEL` | `BAAI/bge-small-en-v1.5` | any fastembed text model |
| `DATA_DIR` | `./data` | PDFs + SQLite DB (gitignored) |
| `MAX_UPLOAD_MB` | `25` | larger uploads get 413 |
| `CORS_ORIGINS` | `http://localhost:5173,…` | comma-separated |

Examples:

```bash
# Claude
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Local Ollama (free)
LLM_PROVIDER=openai
OPENAI_BASE_URL=http://localhost:11434/v1
LLM_MODEL=llama3.1
```

## Architecture

```
upload ─► pdf.py (PyMuPDF, per-page text, reject non-PDF/encrypted/scanned)
       ─► db.py  (PDF on disk + SQLite: papers, page_texts, chunks+embeddings)
       ─► background: service.process()
            chunking.py   ~450-token chunks, 60 overlap, page numbers kept
            embeddings.py fastembed bge-small (fallback: hashing embedder)
            summarizer.py single pass (≤24k tokens) or map-reduce → strict JSON → pydantic
chat   ─► rag.py  rewrite follow-up → standalone query (uses history)
       ─► retrieval.py hybrid: dense cosine + BM25, Reciprocal Rank Fusion, top 6
       ─► grounded prompt (passages only, cite [p. N], admit when not covered)
       ─► SSE: sources → token… → done   (error on failure)
```

- **Summary pipeline.** Short papers go to the model in one call as page-tagged text. Long papers
  use map-reduce: chunk groups (~6k tokens) become page-cited notes, and the reduce step sees
  the first two pages (title, authors, abstract), a detected section outline and all the notes.
  The model must return JSON matching `Summary`. We validate it with pydantic and, on failure,
  retry once with the validation error. `source_pages` is clamped to real pages; empty
  entries are filled by retrieving the chunks that best match that section's text.
- **Retrieval.** Dense search finds paraphrases and BM25 finds exact terms (dataset names,
  metrics, numbers). RRF merges the two rankings without score calibration. Chunk vectors
  are stored in SQLite and each paper's index is built in memory the first time it's needed.
- **Providers** (`app/llm/`) share a two-method interface (`complete`, `stream`). The mock
  provider extracts headings, first sentences, sentences with numbers and keyword-overlap
  answers from the paper, so the UI shows real content offline.
- **Durability.** Everything is in `data/`. Papers still `processing` when the server stopped
  are picked up again on the next start.

## Extras beyond the contract

- `GET /api/papers/{id}/export.md`: the summary as a Markdown file you can download.
- The `sources` SSE event also includes `query`, the standalone question that was actually used
  for retrieval (handy for showing "interpreted as…").
- `POST /chat` on a paper that isn't indexed yet returns `409`.
