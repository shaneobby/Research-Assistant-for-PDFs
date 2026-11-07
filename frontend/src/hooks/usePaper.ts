import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Paper } from '../api/types'

const POLL_MS = 1500

/**
 * Loads one paper and polls it every 1.5 s while the backend is still processing.
 * `onUpdate` lets the library list mirror status changes.
 */
export function usePaper(id: string | null, onUpdate?: (p: Paper) => void) {
  const [paper, setPaper] = useState<Paper | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  const onUpdateRef = useRef(onUpdate)
  useEffect(() => {
    onUpdateRef.current = onUpdate
  })

  useEffect(() => {
    if (!id) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const load = async (first: boolean) => {
      if (first) setLoading(true)
      try {
        const p = await api.getPaper(id)
        if (cancelled) return
        setPaper(p)
        setError(null)
        onUpdateRef.current?.(p)
        if (p.status === 'processing') timer = setTimeout(() => load(false), POLL_MS)
      } catch (e) {
        if (cancelled) return
        setError((e as Error).message)
        // Transient network errors while processing: keep polling, a bit slower.
        if (!first) timer = setTimeout(() => load(false), POLL_MS * 2)
      } finally {
        if (!cancelled && first) setLoading(false)
      }
    }
    load(true)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [id, tick])

  /** Replace the local copy (e.g. after regenerate returns 202) and restart polling. */
  const replace = useCallback((p: Paper) => {
    setPaper(p)
    setTick((t) => t + 1)
  }, [])

  return { paper: paper && paper.id === id ? paper : null, error, loading, replace }
}
