import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, BookOpenText, ChevronRight, Download, MessageSquareText, RotateCcw, Square, Trash2 } from 'lucide-react'
import type { ChatMessage, Paper, SourceChunk } from '../api/types'
import { useChat } from '../hooks/useChat'
import { chatToMarkdown, downloadText, slugify } from '../lib/markdown'
import { Markdown } from './Markdown'
import { PageChip } from './PageChip'

export interface AskRequest {
  question: string
  nonce: number
}

interface Props {
  paper: Paper
  onJump: (page: number) => void
  ask: AskRequest | null
}

export function ChatPanel({ paper, onJump, ask }: Props) {
  const { messages, streaming, send, stop, clear, retry } = useChat(paper.id)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickRef = useRef(true)
  const handledAsk = useRef<number | null>(null)
  const ready = paper.status === 'ready'
  const suggestions = paper.summary?.suggested_questions ?? []

  // Questions sent from the summary tab.
  useEffect(() => {
    if (ask && ask.nonce !== handledAsk.current && ready && !streaming) {
      handledAsk.current = ask.nonce
      send(ask.question)
    }
  }, [ask, ready, send, streaming])

  // Keep scrolled to the bottom while streaming, unless the reader scrolled up.
  useEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  // "/" focuses the input from anywhere.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Auto-grow the textarea.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [draft])

  const submit = () => {
    if (!draft.trim() || streaming || !ready) return
    stickRef.current = true
    send(draft)
    setDraft('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const iconBtn =
    'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-muted transition hover:bg-raised hover:text-ink disabled:opacity-40'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {messages.length > 0 && (
        <div className="flex items-center justify-end gap-1 border-b border-line-muted px-3 py-1.5">
          <button
            className={iconBtn}
            onClick={() => downloadText(`${slugify(paper.summary?.title || paper.filename)}-chat.md`, chatToMarkdown(paper, messages))}
          >
            <Download className="size-3.5" /> Export
          </button>
          <button className={iconBtn} onClick={clear}>
            <Trash2 className="size-3.5" /> Clear chat
          </button>
        </div>
      )}

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <EmptyChat suggestions={suggestions} ready={ready} onPick={(q) => send(q)} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
            {messages.map((m, i) => (
              <Message
                key={m.id}
                message={m}
                question={i > 0 ? messages[i - 1].content : undefined}
                live={streaming && i === messages.length - 1}
                onJump={onJump}
                onRetry={i === messages.length - 1 && !streaming ? retry : undefined}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-line-muted bg-surface px-3 py-3 sm:px-4">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-xl border border-line bg-raised px-3 py-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              disabled={!ready}
              placeholder={ready ? 'Ask about this paper…' : 'Chat opens once the paper is processed'}
              aria-label="Your question"
              className="max-h-44 min-h-6 flex-1 resize-none bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-muted/70 disabled:cursor-not-allowed"
            />
            {streaming ? (
              <button
                onClick={stop}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink transition hover:bg-surface"
                aria-label="Stop generating"
                title="Stop"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!draft.trim() || !ready}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-canvas transition hover:opacity-90 disabled:opacity-30"
                aria-label="Send"
                title="Send (Enter)"
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
          <p className="mt-1.5 hidden text-center text-[0.68rem] text-ink-muted sm:block">
            <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a new line · <Kbd>/</Kbd> to focus ·
            answers cite pages like <span className="font-mono text-primary">p. 4</span>
          </p>
        </div>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-line-muted bg-raised px-1 font-mono text-[0.65rem]">{children}</kbd>
}

function EmptyChat({ suggestions, ready, onPick }: { suggestions: string[]; ready: boolean; onPick: (q: string) => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
        <MessageSquareText className="size-5" />
      </div>
      <h3 className="font-serif text-xl font-semibold text-ink">Discuss the paper</h3>
      <p className="mt-1 text-sm text-ink-muted">
        Answers are grounded in retrieved passages and cite the pages they came from.
      </p>
      {ready && suggestions.length > 0 && (
        <div className="mt-6 flex w-full flex-col gap-2">
          {suggestions.map((q) => (
            <button
              key={q}
              onClick={() => onPick(q)}
              className="card group flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-ink-muted transition hover:text-ink"
            >
              <span className="flex-1">{q}</span>
              <ChevronRight className="size-4 shrink-0 text-primary opacity-0 transition group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const norm = (s?: string) => (s ?? '').trim().toLowerCase().replace(/[?.!\s]+$/, '')
/** The retrieval query, only when the backend rewrote the question (e.g. a follow-up). */
const rewritten = (query: string | undefined, question: string | undefined) =>
  query && norm(query) !== norm(question) ? query : undefined

function Message({
  message: m,
  question,
  live,
  onJump,
  onRetry,
}: {
  message: ChatMessage
  question?: string
  live: boolean
  onJump: (p: number) => void
  onRetry?: () => void
}) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-secondary-soft px-4 py-2.5 text-sm text-ink">
          {m.content}
        </div>
      </div>
    )
  }
  const waiting = live && !m.content
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary font-serif text-sm font-semibold text-canvas">
        M
      </div>
      <div className="min-w-0 flex-1">
        {waiting ? (
          <p className="flex items-center gap-2 py-1 text-sm text-ink-muted">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 animate-bounce rounded-full bg-primary"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </span>
            {m.sources ? `Found ${m.sources.length} passages, writing…` : 'Searching the paper…'}
          </p>
        ) : (
          m.content && (
            <Markdown onJump={onJump} className={`text-[0.92rem] ${live ? 'streaming' : ''}`}>
              {m.content}
            </Markdown>
          )
        )}
        {m.stopped && <p className="mt-1 text-xs italic text-ink-muted">Stopped.</p>}
        {m.error && (
          <div className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {m.error}
          </div>
        )}
        {(m.error || m.stopped) && onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-secondary hover:underline"
          >
            <RotateCcw className="size-3" /> Try again
          </button>
        )}
        {m.sources && m.sources.length > 0 && !waiting && (
          <Sources sources={m.sources} query={rewritten(m.query, question)} onJump={onJump} />
        )}
      </div>
    </div>
  )
}

function Sources({
  sources,
  query,
  onJump,
}: {
  sources: SourceChunk[]
  query?: string
  onJump: (p: number) => void
}) {
  // Scores differ by retriever (cosine, BM25, RRF), so bars are relative to the best passage.
  const max = Math.max(...sources.map((s) => s.score), 1e-9)
  return (
    <details className="group mt-3 rounded-lg border border-line-muted bg-surface text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-ink-muted select-none hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition group-open:rotate-90" />
        <BookOpenText className="size-3.5" />
        Sources · {sources.length} passage{sources.length === 1 ? '' : 's'}
        <span className="ml-auto flex gap-1">
          {[...new Set(sources.map((s) => s.page))].sort((a, b) => a - b).map((p) => (
            <span key={p} className="font-mono text-[0.65rem] text-primary">
              p.{p}
            </span>
          ))}
        </span>
      </summary>
      {query && (
        <p className="border-t border-line-muted px-3 pt-2 text-xs text-ink-muted">
          Searched for: <span className="italic text-ink">“{query}”</span>
        </p>
      )}
      <ol className="space-y-2 border-t border-line-muted px-3 py-3">
        {sources.map((s, i) => (
          <li key={`${s.id}-${i}`} className="flex gap-3">
            <div className="flex w-12 shrink-0 flex-col items-start gap-1">
              <PageChip page={s.page} onJump={onJump} size="md" />
              <ScoreBar score={s.score} max={max} />
            </div>
            <p className="line-clamp-4 text-xs leading-relaxed text-ink-muted">{s.text}</p>
          </li>
        ))}
      </ol>
    </details>
  )
}

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = Math.max(0.05, Math.min(1, score / max)) * 100
  return (
    <div className="h-1 w-full rounded-full bg-line-muted" title={`Relevance score ${score.toFixed(3)}`}>
      <div className="h-1 rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
    </div>
  )
}
