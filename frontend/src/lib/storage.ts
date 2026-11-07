// localStorage can throw (private mode, blocked storage, quota), so every access is guarded.

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable or full: keep working in memory */
  }
}

export function removeKey(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export const keys = {
  theme: 'marginalia:theme',
  selected: 'marginalia:selected',
  chat: (paperId: string) => `marginalia:chat:${paperId}`,
}
