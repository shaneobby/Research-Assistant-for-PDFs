"""FastAPI app. Run: uvicorn app.main:app --reload --port 8000"""
import json
import logging
import uuid
from urllib.parse import quote, urlsplit
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from sse_starlette.sse import EventSourceResponse, ServerSentEvent
from starlette.concurrency import iterate_in_threadpool, run_in_threadpool

from .config import Settings, get_settings
from .export import summary_markdown
from .llm import build_provider
from .pdf import PdfError
from .rag import answer_stream, rewrite_question
from .schemas import ChatRequest, Health, Paper
from .service import PaperService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")


SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


class OriginGuard:
    """Reject state-changing requests from foreign web pages (CSRF).

    A request is allowed if it has no Origin header (curl, server-to-server), the Origin is in
    CORS_ORIGINS, or it is same-origin (the Origin's host equals the Host header, which
    TrustedHostMiddleware has already vetted; this covers the nginx/Docker setup).
    """

    def __init__(self, app, allowed_origins: list[str]):
        self.app = app
        self.allowed = {o.rstrip("/").lower() for o in allowed_origins}

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] not in SAFE_METHODS:
            headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
            origin = headers.get("origin")
            if origin is not None and not self._ok(origin, headers.get("host", "")):
                await JSONResponse({"detail": "Cross-origin request blocked."}, status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)

    def _ok(self, origin: str, host: str) -> bool:
        origin = origin.rstrip("/").lower()
        return origin in self.allowed or urlsplit(origin).netloc == host.lower()


def _check_id(paper_id: str) -> None:
    """Paper ids are canonical UUID4 strings; anything else can't exist (and must never reach the filesystem)."""
    try:
        ok = str(uuid.UUID(paper_id)) == paper_id
    except ValueError:
        ok = False
    if not ok:
        raise HTTPException(404, "Paper not found.")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    provider = build_provider(settings)
    service = PaperService(settings, provider)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        log.info("LLM provider: %s (%s); data dir: %s", provider.name, provider.model, settings.resolved_data_dir)
        service.resume_unfinished()
        yield

    app = FastAPI(title="Paper Summarizer API", version="1.0.0", lifespan=lifespan)
    app.state.service = service
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(OriginGuard, allowed_origins=settings.cors_origin_list)
    # Added last so it runs first: bad Host headers (DNS rebinding) are rejected before anything else.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_host_list)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        msg = "; ".join(f"{'.'.join(str(x) for x in e['loc'][1:])}: {e['msg']}" for e in exc.errors())
        return JSONResponse({"detail": msg or "Invalid request."}, status_code=422)

    def _get(paper_id: str) -> dict:
        _check_id(paper_id)
        paper = service.store.get_paper(paper_id)
        if paper is None:
            raise HTTPException(404, "Paper not found.")
        return paper

    @app.get("/api/health", response_model=Health)
    def health():
        return Health(status="ok", llm_provider=provider.name, model=provider.model)

    @app.post("/api/papers", response_model=Paper, status_code=201)
    async def upload(background: BackgroundTasks, file: UploadFile = File(...)):
        limit = settings.max_upload_mb * 1024 * 1024
        data = await file.read(limit + 1)
        if len(data) > limit:
            raise HTTPException(413, f"File is larger than {settings.max_upload_mb} MB.")
        if not data:
            raise HTTPException(400, "Empty file.")
        filename = (file.filename or "paper.pdf").replace("\\", "/").split("/")[-1]
        try:
            paper = await run_in_threadpool(service.create, filename, data)
        except PdfError as exc:
            raise HTTPException(400, str(exc)) from exc
        background.add_task(service.process, paper["id"])
        return paper

    @app.get("/api/papers", response_model=list[Paper], response_model_exclude={"__all__": {"summary"}})
    def list_papers():
        return service.store.list_papers()

    @app.get("/api/papers/{paper_id}", response_model=Paper)
    def get_paper(paper_id: str):
        return _get(paper_id)

    @app.get("/api/papers/{paper_id}/pdf")
    def get_pdf(paper_id: str):
        paper = _get(paper_id)
        path = service.store.pdf_path(paper_id)
        if not path.exists():
            raise HTTPException(404, "PDF file missing.")
        return FileResponse(
            path,
            media_type="application/pdf",
            filename=paper["filename"],
            content_disposition_type="inline",
        )

    @app.get("/api/papers/{paper_id}/export.md", response_class=PlainTextResponse)
    def export_markdown(paper_id: str):
        paper = _get(paper_id)
        if not paper.get("summary"):
            raise HTTPException(409, "Summary is not ready yet.")
        stem = "".join(c for c in paper["filename"].rsplit(".", 1)[0] if c.isprintable() and c not in '"\\/')
        name = f"{stem or 'paper'}-summary.md"
        ascii_name = name.encode("ascii", "replace").decode().replace("?", "_")
        return PlainTextResponse(
            summary_markdown(paper),
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"},
        )

    @app.post("/api/papers/{paper_id}/summary", response_model=Paper, status_code=202)
    def regenerate(paper_id: str, background: BackgroundTasks):
        paper = _get(paper_id)
        if paper["status"] == "processing":
            return paper
        service.store.set_status(paper_id, "processing")
        background.add_task(service.process, paper_id, True)
        return _get(paper_id)

    @app.post("/api/papers/{paper_id}/chat")
    async def chat(paper_id: str, body: ChatRequest):
        _get(paper_id)
        if not await run_in_threadpool(service.store.has_chunks, paper_id):
            raise HTTPException(409, "Paper is still being indexed; try again in a moment.")
        history = [t.model_dump() for t in body.history]

        def events():
            try:
                standalone = rewrite_question(provider, body.question, history)
                hits = service.retrieve(paper_id, standalone)
                chunks = [
                    {"id": f"{paper_id}:{h.chunk.idx}", "page": h.chunk.page, "text": h.chunk.text, "score": h.score}
                    for h in hits
                ]
                yield ServerSentEvent(event="sources", data=json.dumps({"chunks": chunks, "query": standalone}))
                for piece in answer_stream(provider, body.question, standalone, history, hits):
                    yield ServerSentEvent(event="token", data=json.dumps({"text": piece}))
                yield ServerSentEvent(event="done", data="{}")
            except Exception as exc:
                log.exception("chat failed")
                yield ServerSentEvent(event="error", data=json.dumps({"detail": str(exc) or "Chat failed."}))

        return EventSourceResponse(iterate_in_threadpool(events()), ping=15)

    @app.delete("/api/papers/{paper_id}", status_code=204)
    def delete_paper(paper_id: str):
        _check_id(paper_id)
        if not service.delete(paper_id):
            raise HTTPException(404, "Paper not found.")
        return Response(status_code=204)

    return app


app = create_app()
