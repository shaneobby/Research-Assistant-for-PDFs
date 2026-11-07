import { useEffect, useState } from 'react'
import { Library as LibraryIcon, Moon, Sun } from 'lucide-react'
import { api, IS_MOCK } from '../api/client'
import type { Health } from '../api/types'
import type { Theme } from '../hooks/useTheme'

interface Props {
  theme: Theme
  onToggleTheme: () => void
  onToggleLibrary: () => void
  onHome: () => void
}

export function Header({ theme, onToggleTheme, onToggleLibrary, onHome }: Props) {
  const [health, setHealth] = useState<Health | null>(null)
  const [down, setDown] = useState(false)

  useEffect(() => {
    let cancelled = false
    const check = () =>
      api
        .health()
        .then((h) => !cancelled && (setHealth(h), setDown(false)))
        .catch(() => !cancelled && setDown(true))
    check()
    const t = setInterval(check, 30_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line-muted bg-surface px-3 sm:px-4">
      <button
        onClick={onToggleLibrary}
        className="rounded-md p-2 text-ink-muted hover:bg-raised hover:text-ink lg:hidden"
        aria-label="Open library"
      >
        <LibraryIcon className="size-5" />
      </button>
      <button onClick={onHome} className="flex items-center gap-2.5" aria-label="Marginalia home">
        <Logo />
        <span className="font-serif text-xl font-semibold tracking-tight text-ink">Marginalia</span>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <span
          className="hidden items-center gap-1.5 rounded-full border border-line-muted px-2.5 py-1 font-mono text-[0.68rem] text-ink-muted sm:inline-flex"
          title={down ? 'Backend unreachable' : health ? `LLM provider: ${health.llm_provider}` : 'Checking backend'}
        >
          <span className={`size-1.5 rounded-full ${down ? 'bg-danger' : health ? 'bg-success' : 'bg-warning'}`} />
          {IS_MOCK
            ? 'demo · in-browser mock'
            : down
              ? 'backend offline'
              : health
                ? `${health.llm_provider} · ${health.model}`
                : 'connecting'}
        </span>
        <button
          onClick={onToggleTheme}
          className="rounded-md p-2 text-ink-muted transition hover:bg-raised hover:text-ink"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>
      </div>
    </header>
  )
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
      <rect width="32" height="32" rx="7" className="fill-primary" />
      <path d="M9 8h9l5 5v11H9z" className="fill-canvas" />
      <path d="M18 8v5h5" fill="none" className="stroke-primary" strokeWidth="1.5" />
      <path d="M12 17h8M12 20.5h5" className="stroke-primary" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
