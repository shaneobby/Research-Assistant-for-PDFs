"""FastAPI app. Run: uvicorn app.main:app --reload --port 8000"""
import json
import logging
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
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

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        msg = "; ".join(f"{'.'.join(str(x) for x in e['loc'][1:])}: {e['msg']}" for e in exc.errors())
        return JSONResponse({"detail": msg or "Invalid request."}, status_code=422)

    def _get(paper_id: str) -> dict:
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
        stem = paper["filename"].rsplit(".", 1)[0]
        return PlainTextResponse(
            summary_markdown(paper),
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{stem}-summary.md"'},
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
        if not service.delete(paper_id):
            raise HTTPException(404, "Paper not found.")
        return Response(status_code=204)

    return app


app = create_app()
