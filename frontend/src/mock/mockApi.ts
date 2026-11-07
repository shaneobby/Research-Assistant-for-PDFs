/**
 * In-browser mock of docs/API_CONTRACT.md, enabled with VITE_MOCK=1 (`npm run dev:mock`).
 * Patches window.fetch for /api/* and replaces the XHR upload and PDF URL in the api client.
 * State lives in memory; reload resets it to the seeded sample paper.
 */
import { api, ApiError, MAX_UPLOAD_BYTES } from '../api/client'
import type { Paper, SourceChunk, Summary } from '../api/types'
import { MOCK_ANSWERS, MOCK_FALLBACK, SAMPLE_PAGES, SAMPLE_SUMMARY, SAMPLE_TITLE } from './fixtures'
import { buildSamplePdf } from './samplePdf'

interface MockEntry {
  paper: Paper
  pdfUrl: string
}

const PROCESSING_MS = 3500
const store = new Map<string, MockEntry>()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function json(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function summaryFor(filename: string): Summary {
  if (filename.startsWith('tidal')) return SAMPLE_SUMMARY
  const title = filename
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
  return { ...SAMPLE_SUMMARY, title: `${title} (mock summary)` }
}

function finishLater(id: string) {
  setTimeout(() => {
    const entry = store.get(id)
    if (!entry) return
    if (/error|broken/i.test(entry.paper.filename)) {
      entry.paper = { ...entry.paper, status: 'error', error: 'No extractable text found (mock error).' }
    } else {
      entry.paper = { ...entry.paper, status: 'ready', summary: summaryFor(entry.paper.filename) }
    }
  }, PROCESSING_MS)
}

function seed() {
  const blob = buildSamplePdf(SAMPLE_TITLE, SAMPLE_PAGES)
  const id = 'sample-tidal'
  store.set(id, {
    pdfUrl: URL.createObjectURL(blob),
    paper: {
      id,
      filename: 'tidal-retrieval.pdf',
      pages: SAMPLE_PAGES.length,
      created_at: new Date(Date.now() - 86_400_000).toISOString(),
      status: 'ready',
      error: null,
      summary: SAMPLE_SUMMARY,
    },
  })
}

function listing(): Paper[] {
  return [...store.values()]
    .map((e) => ({ ...e.paper, summary: undefined }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

function sse(paper: Paper, question: string, signal?: AbortSignal | null): Response {
  const pick = MOCK_ANSWERS.find((a) => a.match.test(question)) ?? MOCK_FALLBACK
  const pages = pick.pages.filter((p) => p <= paper.pages)
  const chunks: SourceChunk[] = (pages.length ? pages : [1]).map((page, i) => ({
    id: `${paper.id}-c${page}`,
    page,
    score: Math.round((0.92 - i * 0.11) * 100) / 100,
    text: [SAMPLE_PAGES[page - 1]?.heading, ...(SAMPLE_PAGES[page - 1]?.lines ?? [])].filter(Boolean).join(' '),
  }))
  const encoder = new TextEncoder()
  const tokens = pick.answer.match(/\S+\s*|\s+/g) ?? []
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      await sleep(350)
      send('sources', { chunks })
      for (const t of tokens) {
        if (signal?.aborted) return
        await sleep(18 + Math.random() * 30)
        send('token', { text: t })
      }
      send('done', {})
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
}

async function handle(url: URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const path = url.pathname
  await sleep(150)

  if (path === '/api/health') return json({ status: 'ok', llm_provider: 'mock', model: 'mock-frontend' })
  if (path === '/api/papers' && method === 'GET') return json(listing())

  const m = path.match(/^\/api\/papers\/([^/]+)(?:\/(summary|chat|pdf))?$/)
  if (!m) return json({ detail: 'Not found' }, 404)
  const entry = store.get(decodeURIComponent(m[1]))
  if (!entry) return json({ detail: 'Paper not found' }, 404)
  const sub = m[2]

  if (!sub && method === 'GET') return json(entry.paper)
  if (!sub && method === 'DELETE') {
    store.delete(entry.paper.id)
    URL.revokeObjectURL(entry.pdfUrl)
    return json(null, 204)
  }
  if (sub === 'summary' && method === 'POST') {
    entry.paper = { ...entry.paper, status: 'processing', summary: null, error: null }
    finishLater(entry.paper.id)
    return json(entry.paper, 202)
  }
  if (sub === 'chat' && method === 'POST') {
    if (entry.paper.status !== 'ready') return json({ detail: 'Paper is not ready yet' }, 409)
    const body = JSON.parse(String(init.body ?? '{}')) as { question?: string }
    return sse(entry.paper, body.question ?? '', init.signal)
  }
  if (sub === 'pdf') return fetch(entry.pdfUrl)
  return json({ detail: 'Method not allowed' }, 405)
}

async function mockUpload(file: File, onProgress: (f: number) => void, signal?: AbortSignal): Promise<Paper> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))
    throw new ApiError(400, 'File is not a PDF')
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, 'File is larger than 25 MB')
  for (let i = 1; i <= 10; i++) {
    if (signal?.aborted) throw new ApiError(0, 'Upload cancelled.')
    await sleep(90)
    onProgress(i / 10)
  }
  const id = crypto.randomUUID()
  const paper: Paper = {
    id,
    filename: file.name,
    pages: SAMPLE_PAGES.length,
    created_at: new Date().toISOString(),
    status: 'processing',
    error: null,
    summary: null,
  }
  store.set(id, { paper, pdfUrl: URL.createObjectURL(file) })
  finishLater(id)
  return paper
}

export function installMockApi() {
  seed()
  const realFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin)
    if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) return handle(url, init)
    return realFetch(input, init)
  }
  api.uploadPaper = mockUpload
  api.pdfUrl = (id) => store.get(id)?.pdfUrl ?? ''
  console.info('[marginalia] Mock API enabled (VITE_MOCK=1).')
}
