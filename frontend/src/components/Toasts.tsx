import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

type ToastKind = 'error' | 'success' | 'info'
interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  error: (msg: string) => void
  success: (msg: string) => void
  info: (msg: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

const icons = { error: AlertTriangle, success: CheckCircle2, info: Info }
const accents = { error: 'text-danger', success: 'text-success', info: 'text-secondary' }

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])
  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId++
      setToasts((ts) => [...ts.slice(-3), { id, kind, message }])
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3500)
    },
    [dismiss],
  )
  const value = useMemo<ToastApi>(
    () => ({
      error: (m) => push('error', m),
      success: (m) => push('success', m),
      info: (m) => push('info', m),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const Icon = icons[t.kind]
          return (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className="card pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg bg-surface px-4 py-3 text-sm text-ink"
            >
              <Icon className={`mt-0.5 size-4 shrink-0 ${accents[t.kind]}`} aria-hidden />
              <p className="flex-1 leading-snug">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                className="-m-1 rounded p-1 text-ink-muted hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X className="size-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
