# API contract (backend ⇄ frontend)

Base URL: `http://localhost:8000` (frontend dev server proxies `/api` → backend).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/health` | – | `{status:"ok", llm_provider, model}` |
| POST | `/api/papers` | multipart `file` (PDF, ≤25 MB, one at a time) | `201 Paper` (status `processing`) |
| GET | `/api/papers` | – | `Paper[]` (newest first, `summary` omitted) |
| GET | `/api/papers/{id}` | – | `Paper` |
| GET | `/api/papers/{id}/pdf` | – | the original PDF (`application/pdf`) |
| POST | `/api/papers/{id}/summary` | – | regenerate summary → `202 Paper` |
| POST | `/api/papers/{id}/chat` | `{question, history:[{role:"user"\|"assistant", content}]}` | `text/event-stream` (see below) |
| DELETE | `/api/papers/{id}` | – | `204` |

Errors: `{detail: string}` with 4xx/5xx (400 not a PDF / no extractable text, 404 unknown id, 413 too large).

## Paper
```json
{
  "id": "uuid", "filename": "x.pdf", "pages": 12, "created_at": "ISO-8601",
  "status": "processing | ready | error", "error": null,
  "summary": Summary | null
}
```
Frontend polls `GET /api/papers/{id}` every ~1.5 s while `status == "processing"`.

## Summary
```json
{
  "title": "", "authors": [""], "abstract": "",
  "problem_statement": "", "methodology": "",
  "key_results": [""], "conclusion": "",
  "keywords": [""], "suggested_questions": ["", "", ""],
  "source_pages": {"problem_statement": [1,2], "methodology": [3], "key_results": [5,6], "conclusion": [9]}
}
```
Text fields may contain Markdown.

## Chat SSE events
Each event: `event: <name>\ndata: <json>\n\n`
- `sources` (sent first): `{chunks:[{id, page, text, score}]}` — retrieved passages, 1-based page numbers
- `token`: `{text}` — incremental answer text (Markdown; cites sources inline as `[p. 4]`)
- `done`: `{}`
- `error`: `{detail}`
