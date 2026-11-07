import { useMemo, useState } from 'react'
import { AlertCircle, FileText, Loader2, Plus, Search, Trash2, X } from 'lucide-react'
import type { Paper } from '../api/types'
import { UploadMeter, type UploadProgress } from './UploadZone'

interface Props {
  papers: Paper[]
  loading: boolean
  selectedId: string | null
  titles: Record<string, string>
  upload: UploadProgress | null
  onSelect: (id: string) => void
  onDelete: (paper: Paper) => void
  onNew: () => void
  onClose?: () => void
}

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function Library({ papers, loading, selectedId, titles, upload, onSelect, onDelete, onNew, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return papers
    return papers.filter((p) => `${p.filename} ${titles[p.id] ?? ''}`.toLowerCase().includes(q))
  }, [papers, query, titles])

  return (
    <aside className="flex h-full w-full flex-col bg-surface">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ink-muted">Library</h2>
        {onClose && (
          <button onClick={onClose} className="rounded p-1 text-ink-muted hover:text-ink" aria-label="Close library">
            <X className="size-4" />
          </button>
        )}
      </div>
      <div className="px-3">
        <button
          onClick={onNew}
          disabled={upload != null}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-canvas transition hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="size-4" /> New paper
        </button>
        {upload && (
          <div className="card mt-3 rounded-lg p-3">
            <UploadMeter progress={upload} />
          </div>
        )}
        {papers.length > 4 && (
          <label className="mt-3 flex items-center gap-2 rounded-md border border-line-muted bg-raised px-2 py-1.5 text-sm">
            <Search className="size-3.5 text-ink-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter papers"
              className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-muted/70"
            />
          </label>
        )}
      </div>

      <nav className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Uploaded papers">
        {loading && papers.length === 0 ? (
          <div className="space-y-2 px-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-12" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-ink-muted">
            {papers.length ? 'No papers match.' : 'Papers you upload appear here.'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((p) => {
              const active = p.id === selectedId
              const title = titles[p.id] || p.filename.replace(/\.pdf$/i, '')
              return (
                <li key={p.id} className="group relative">
                  <button
                    onClick={() => onSelect(p.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 pr-9 text-left transition ${
                      active ? 'bg-primary-soft' : 'hover:bg-raised'
                    }`}
                  >
                    <StatusIcon paper={p} active={active} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`line-clamp-2 text-sm leading-snug ${active ? 'font-medium text-ink' : 'text-ink-muted group-hover:text-ink'}`}
                      >
                        {title}
                      </span>
                      <span className="mt-0.5 block font-mono text-[0.65rem] text-ink-muted/80">
                        {p.status === 'processing'
                          ? 'processing…'
                          : p.status === 'error'
                            ? 'failed'
                            : `${p.pages} pp · ${fmtDate(p.created_at)}`}
                      </span>
                    </span>
                  </button>
                  {confirming === p.id ? (
                    <div className="absolute inset-y-1 right-1 flex items-center gap-1 rounded-md bg-surface pl-1 shadow-sm">
                      <button
                        onClick={() => {
                          setConfirming(null)
                          onDelete(p)
                        }}
                        className="rounded px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        className="rounded px-1.5 py-1 text-xs text-ink-muted hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirming(p.id)}
                      className="absolute right-1.5 top-2 rounded p-1.5 text-ink-muted opacity-0 transition group-hover:opacity-100 hover:text-danger focus-visible:opacity-100 max-lg:opacity-60"
                      aria-label={`Delete ${p.filename}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </nav>
    </aside>
  )
}

function StatusIcon({ paper, active }: { paper: Paper; active: boolean }) {
  if (paper.status === 'processing') return <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
  if (paper.status === 'error') return <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
  return <FileText className={`mt-0.5 size-4 shrink-0 ${active ? 'text-primary' : 'text-ink-muted'}`} />
}
