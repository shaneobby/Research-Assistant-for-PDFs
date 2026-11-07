import json
import time

import pymupdf as fitz

from tests.conftest import make_pdf


def upload(client, data: bytes, name="paper.pdf"):
    return client.post("/api/papers", files={"file": (name, data, "application/pdf")})


def wait_ready(client, paper_id, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        paper = client.get(f"/api/papers/{paper_id}").json()
        if paper["status"] != "processing":
            return paper
        time.sleep(0.2)
    raise AssertionError("paper never finished processing")


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.replace("\r\n", "\n").split("\n\n"):
        name, data = None, []
        for line in block.split("\n"):
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
        if name:
            events.append((name, json.loads("\n".join(data) or "{}")))
    return events


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "llm_provider": "mock", "model": "mock-extractive-v1"}


def test_upload_summary_shape(client, paper_pdf):
    r = upload(client, paper_pdf, "sar.pdf")
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "processing"
    assert body["filename"] == "sar.pdf" and body["pages"] == 3

    paper = wait_ready(client, body["id"])
    assert paper["status"] == "ready", paper["error"]
    s = paper["summary"]
    for key in ("title", "abstract", "problem_statement", "methodology", "conclusion"):
        assert isinstance(s[key], str) and s[key], key
    assert "Sparse Attention Routing" in s["title"]
    assert "Alice Johnson" in s["authors"]
    assert isinstance(s["key_results"], list) and s["key_results"]
    assert any("45.2" in r for r in s["key_results"])
    assert len(s["suggested_questions"]) == 3
    sp = s["source_pages"]
    assert set(sp) == {"problem_statement", "methodology", "key_results", "conclusion"}
    assert all(1 <= p <= 3 for pages in sp.values() for p in pages)
    assert sp["methodology"] == [2] and sp["key_results"] == [3]


def test_list_and_pdf(client, paper_pdf):
    first = upload(client, paper_pdf, "a.pdf").json()
    second = upload(client, paper_pdf, "b.pdf").json()
    papers = client.get("/api/papers").json()
    assert [p["id"] for p in papers[:2]] == [second["id"], first["id"]]
    assert all("summary" not in p for p in papers)

    r = client.get(f"/api/papers/{first['id']}/pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content == paper_pdf


def test_chat_stream(client, paper_pdf):
    pid = upload(client, paper_pdf).json()["id"]
    wait_ready(client, pid)
    r = client.post(f"/api/papers/{pid}/chat", json={"question": "How much does GPU memory drop?", "history": []})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(r.text)
    names = [e[0] for e in events]
    assert names[0] == "sources" and names[-1] == "done"
    assert "token" in names
    chunks = events[0][1]["chunks"]
    assert chunks and {"id", "page", "text", "score"} <= set(chunks[0])
    answer = "".join(d["text"] for n, d in events if n == "token")
    assert "[p. 3]" in answer and "38 GB" in answer


def test_chat_followup_and_not_covered(client, paper_pdf):
    pid = upload(client, paper_pdf).json()["id"]
    wait_ready(client, pid)
    history = [
        {"role": "user", "content": "What is the router network?"},
        {"role": "assistant", "content": "It scores block pairs [p. 2]."},
    ]
    r = client.post(f"/api/papers/{pid}/chat", json={"question": "How is it trained?", "history": history})
    events = parse_sse(r.text)
    assert events[0][1]["query"] != "How is it trained?"  # rewritten to standalone
    assert events[-1][0] == "done"

    r = client.post(f"/api/papers/{pid}/chat", json={"question": "Quantum chromodynamics lattice gluons?"})
    answer = "".join(d["text"] for n, d in parse_sse(r.text) if n == "token")
    assert "couldn't find" in answer


def test_regenerate_and_export(client, paper_pdf):
    pid = upload(client, paper_pdf).json()["id"]
    wait_ready(client, pid)
    r = client.post(f"/api/papers/{pid}/summary")
    assert r.status_code == 202
    assert wait_ready(client, pid)["status"] == "ready"
    md = client.get(f"/api/papers/{pid}/export.md")
    assert md.status_code == 200
    assert md.text.startswith("# Sparse Attention Routing")
    assert "## Key results" in md.text


def test_delete(client, paper_pdf):
    pid = upload(client, paper_pdf).json()["id"]
    wait_ready(client, pid)
    assert client.delete(f"/api/papers/{pid}").status_code == 204
    assert client.get(f"/api/papers/{pid}").status_code == 404
    assert client.get(f"/api/papers/{pid}/pdf").status_code == 404
    assert client.delete(f"/api/papers/{pid}").status_code == 404


def test_rejects_non_pdf(client):
    r = upload(client, b"hello, I am a text file", "notes.pdf")
    assert r.status_code == 400
    assert "not a PDF" in r.json()["detail"]


def test_rejects_pdf_without_text(client):
    doc = fitz.open()
    doc.new_page()
    r = upload(client, doc.tobytes())
    assert r.status_code == 400
    assert "no extractable text" in r.json()["detail"]


def test_rejects_encrypted_pdf(client, paper_pdf):
    doc = fitz.open(stream=paper_pdf, filetype="pdf")
    data = doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="secret")
    r = upload(client, data)
    assert r.status_code == 400
    assert "encrypted" in r.json()["detail"]


def test_rejects_too_large(client):
    r = upload(client, b"%PDF-1.4\n" + b"0" * (1024 * 1024 + 10))
    assert r.status_code == 413


def test_unknown_id(client):
    assert client.get("/api/papers/nope").status_code == 404
    assert client.post("/api/papers/nope/chat", json={"question": "hi"}).status_code == 404
    assert client.post("/api/papers/nope/summary").status_code == 404


def test_long_paper_map_reduce(client):
    filler = (
        "The experiments section reports additional ablations on block size and router depth. "
        "Each configuration was trained for three epochs with identical hyperparameters. "
    ) * 25
    pages = [
        "Scaling Study of Routers\nDana Lee and Eve Park\n\nAbstract\nWe study routers at scale in many settings.\n\n"
        "1 Introduction\nRouting is hard to scale and the problem matters for efficiency.\n" + filler
    ] + [f"{i + 2} Results\n" + filler + f" Page marker {i}: accuracy reached {80 + i}.5 percent." for i in range(60)]
    pid = upload(client, make_pdf(pages)).json()["id"]
    paper = wait_ready(client, pid, timeout=60)
    assert paper["status"] == "ready", paper["error"]
    assert paper["summary"]["title"] == "Scaling Study of Routers"
