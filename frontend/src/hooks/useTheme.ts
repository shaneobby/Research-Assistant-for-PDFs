import { useCallback, useEffect, useState } from 'react'
import { keys } from '../lib/storage'

export type Theme = 'light' | 'dark'

// Stored as a raw string so the inline script in index.html can read it before first paint.
function savedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(keys.theme)
    return t === 'light' || t === 'dark' ? t : null
  } catch {
    return null
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // Follow the OS setting until the user picks a theme explicitly.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => {
      if (!savedTheme()) setTheme(e.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(keys.theme, next)
      } catch {
        /* storage unavailable: theme still applies for this visit */
      }
      return next
    })
  }, [])

  return { theme, toggle }
}
