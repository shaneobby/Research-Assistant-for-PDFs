import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { ChatMessage, ChatTurn } from '../api/types'
import { keys, readJSON, removeKey, writeJSON } from '../lib/storage'

const HISTORY_TURNS = 10 // previous messages sent with each question

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

/** Streaming chat for one paper, persisted per paper in localStorage. */
export function useChat(paperId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => readJSON(keys.chat(paperId), []))
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Persist (skipping writes mid-stream would lose a reload, so write each update; it's small).
  useEffect(() => {
    if (messages.length) writeJSON(keys.chat(paperId), messages)
    else removeKey(keys.chat(paperId))
  }, [paperId, messages])

  useEffect(() => () => abortRef.current?.abort(), [])

  const patchLast = useCallback((fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((ms) => (ms.length ? [...ms.slice(0, -1), fn(ms[ms.length - 1])] : ms))
  }, [])

  const send = useCallback(
    async (question: string) => {
      const q = question.trim()
      if (!q || streaming) return
      const history: ChatTurn[] = messages
        .filter((m) => !m.error && m.content)
        .slice(-HISTORY_TURNS)
        .map(({ role, content }) => ({ role, content }))
      const now = Date.now()
      setMessages((ms) => [
        ...ms,
        { id: newId(), role: 'user', content: q, createdAt: now },
        { id: newId(), role: 'assistant', content: '', createdAt: now },
      ])
      setStreaming(true)
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        await api.streamChat(
          paperId,
          q,
          history,
          {
            onSources: (chunks, query) => patchLast((m) => ({ ...m, sources: chunks, query })),
            onToken: (text) => patchLast((m) => ({ ...m, content: m.content + text })),
            onError: (detail) => patchLast((m) => ({ ...m, error: detail })),
          },
          ctrl.signal,
        )
      } catch (e) {
        if ((e as Error).name === 'AbortError') patchLast((m) => ({ ...m, stopped: true }))
        else patchLast((m) => ({ ...m, error: (e as Error).message }))
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null
        setStreaming(false)
      }
    },
    [messages, paperId, patchLast, streaming],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
  }, [])

  /** Re-ask the last question (after an error or a stop). */
  const retry = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUser || streaming) return
    setMessages((ms) => {
      const idx = ms.lastIndexOf(lastUser)
      return ms.slice(0, idx)
    })
    // send() reads `messages` from its closure, so defer until state settles.
    setTimeout(() => sendRef.current(lastUser.content), 0)
  }, [messages, streaming])

  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  })

  return { messages, streaming, send, stop, clear, retry }
}
