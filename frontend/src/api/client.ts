import type { ChatTurn, Health, Paper, SourceChunk } from './types'

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const IS_MOCK = import.meta.env.VITE_MOCK === '1'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function readError(res: Response): Promise<ApiError> {
  let detail = `${res.status} ${res.statusText}`.trim()
  try {
    const body = await res.json()
    if (body && typeof body.detail === 'string') detail = body.detail
    else if (body && Array.isArray(body.detail)) detail = body.detail.map((d: { msg?: string }) => d.msg).join('; ')
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, detail)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the backend running on port 8000?')
  }
  if (!res.ok) throw await readError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  health: () => request<Health>('/api/health'),
  listPapers: () => request<Paper[]>('/api/papers'),
  getPaper: (id: string) => request<Paper>(`/api/papers/${encodeURIComponent(id)}`),
  deletePaper: (id: string) => request<void>(`/api/papers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  regenerateSummary: (id: string) =>
    request<Paper>(`/api/papers/${encodeURIComponent(id)}/summary`, { method: 'POST' }),
  pdfUrl: (id: string) => `/api/papers/${encodeURIComponent(id)}/pdf`,
  uploadPaper,
  streamChat,
}

/** Upload with progress. Uses XHR because fetch has no upload-progress events. */
function uploadPaper(file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<Paper> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/papers')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      const body = xhr.response
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1)
        resolve(body as Paper)
      } else {
        const detail = body && typeof body.detail === 'string' ? body.detail : `Upload failed (${xhr.status})`
        reject(new ApiError(xhr.status, detail))
      }
    }
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed: cannot reach the server.'))
    xhr.onabort = () => reject(new ApiError(0, 'Upload cancelled.'))
    signal?.addEventListener('abort', () => xhr.abort())
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}

export interface ChatHandlers {
  onSources?: (chunks: SourceChunk[]) => void
  onToken: (text: string) => void
  onDone?: () => void
  onError?: (detail: string) => void
}

/**
 * POST a question and consume the text/event-stream response.
 * EventSource only supports GET, so the stream is parsed by hand from fetch's ReadableStream.
 */
async function streamChat(
  paperId: string,
  question: string,
  history: ChatTurn[],
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`/api/papers/${encodeURIComponent(paperId)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ question, history }),
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'Cannot reach the server. Is the backend running on port 8000?')
  }
  if (!res.ok) throw await readError(res)
  if (!res.body) throw new ApiError(0, 'The server returned an empty stream.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false

  const dispatch = (raw: string) => {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue
      const idx = line.indexOf(':')
      const field = idx === -1 ? line : line.slice(0, idx)
      let value = idx === -1 ? '' : line.slice(idx + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'event') event = value
      else if (field === 'data') dataLines.push(value)
    }
    if (!dataLines.length) return
    let data: Record<string, unknown>
    try {
      data = JSON.parse(dataLines.join('\n'))
    } catch {
      data = { text: dataLines.join('\n') }
    }
    switch (event) {
      case 'sources':
        handlers.onSources?.((data.chunks as SourceChunk[]) ?? [])
        break
      case 'token':
        handlers.onToken(String(data.text ?? ''))
        break
      case 'done':
        finished = true
        handlers.onDone?.()
        break
      case 'error':
        finished = true
        handlers.onError?.(String(data.detail ?? 'The model returned an error.'))
        break
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ''
    for (const part of parts) dispatch(part)
  }
  buffer += decoder.decode()
  if (buffer.trim()) dispatch(buffer)
  if (!finished) handlers.onDone?.()
}
