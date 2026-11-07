import { Loader2 } from 'lucide-react'

const steps = ['Extracting text', 'Indexing passages', 'Writing the summary']

/** Shown while the backend is processing a paper. */
export function SummarySkeleton({ filename }: { filename: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 sm:px-8" aria-busy="true" aria-label="Summary is being generated">
      <div className="card mb-8 flex items-center gap-3 rounded-xl px-4 py-3 text-sm">
        <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium text-ink">Reading {filename}…</p>
          <p className="text-xs text-ink-muted">{steps.join(' → ')}. This usually takes under a minute.</p>
        </div>
      </div>
      <div className="skeleton mb-3 h-3 w-40" />
      <div className="skeleton mb-2 h-8 w-11/12" />
      <div className="skeleton mb-5 h-8 w-2/3" />
      <div className="skeleton mb-8 h-4 w-1/2" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="mb-8">
          <div className="skeleton mb-3 h-5 w-48" />
          <div className="skeleton mb-2 h-3.5 w-full" />
          <div className="skeleton mb-2 h-3.5 w-full" />
          <div className="skeleton h-3.5 w-4/5" />
        </div>
      ))}
    </div>
  )
}
