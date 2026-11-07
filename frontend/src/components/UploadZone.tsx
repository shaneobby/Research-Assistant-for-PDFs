import { useRef, useState, type DragEvent } from 'react'
import { FileUp, Loader2 } from 'lucide-react'
import { MAX_UPLOAD_BYTES } from '../api/client'

export interface UploadProgress {
  name: string
  fraction: number
}

/** Returns an error message, or null when the file can be uploaded. */
// eslint-disable-next-line react-refresh/only-export-components
export function validatePdf(file: File): string | null {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!isPdf) return `“${file.name}” is not a PDF.`
  if (file.size > MAX_UPLOAD_BYTES)
    return `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 25 MB.`
  if (file.size === 0) return `“${file.name}” is empty.`
  return null
}

interface Props {
  onFile: (file: File) => void
  progress: UploadProgress | null
}

/** Large drop zone used as the empty state. */
export function UploadZone({ onFile, progress }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const busy = progress != null

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    const f = e.dataTransfer.files
    if (f.length && !busy) onFile(f[0])
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-4 py-10">
      <div className="w-full max-w-xl text-center">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-primary">Marginalia</p>
        <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight text-balance text-ink sm:text-5xl">
          Read papers with a <em className="text-primary">companion</em>.
        </h1>
        <p className="mx-auto mt-4 max-w-md text-ink-muted">
          Upload a research paper to get a structured summary with page references, then ask questions answered from
          the text itself.
        </p>

        <div
          role="button"
          tabIndex={0}
          aria-label="Upload a PDF: drop a file here or press Enter to browse"
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !busy) {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={`card mt-8 flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-6 py-10 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
            over ? 'border-primary! bg-primary-soft' : 'border-line hover:border-primary/60'
          } ${busy ? 'cursor-default' : ''}`}
        >
          {busy ? (
            <UploadMeter progress={progress} />
          ) : (
            <>
              <div className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
                <FileUp className="size-6" />
              </div>
              <p className="mt-4 font-medium text-ink">
                Drop a PDF here, or <span className="text-primary underline underline-offset-4">browse</span>
              </p>
              <p className="mt-1 text-xs text-ink-muted">One paper at a time · PDF up to 25 MB</p>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />

        <ol className="mx-auto mt-10 grid max-w-lg grid-cols-3 gap-4 text-left text-xs text-ink-muted">
          {[
            ['Upload', 'Text is extracted and split into passages.'],
            ['Summarise', 'Problem, method, results and conclusion with page refs.'],
            ['Discuss', 'Ask questions; answers cite the pages they used.'],
          ].map(([t, d], i) => (
            <li key={t}>
              <span className="font-serif text-lg font-semibold text-primary">{i + 1}.</span>{' '}
              <span className="font-medium text-ink">{t}</span>
              <p className="mt-1 leading-snug">{d}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

export function UploadMeter({ progress }: { progress: UploadProgress }) {
  const pct = Math.round(progress.fraction * 100)
  return (
    <div className="w-full max-w-xs" role="status">
      <div className="flex items-center justify-center gap-2 text-sm font-medium text-ink">
        <Loader2 className="size-4 animate-spin text-primary" />
        {pct < 100 ? `Uploading… ${pct}%` : 'Upload complete, processing…'}
      </div>
      <p className="mt-1 truncate text-xs text-ink-muted">{progress.name}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** Full-window overlay so a PDF can be dropped anywhere once a paper is open. */
export function DropOverlay({ active }: { active: boolean }) {
  if (!active) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-canvas/80 backdrop-blur-sm">
      <div className="rounded-2xl border-2 border-dashed border-primary bg-surface px-10 py-8 text-center">
        <FileUp className="mx-auto size-8 text-primary" />
        <p className="mt-2 font-serif text-xl text-ink">Drop to add this paper</p>
      </div>
    </div>
  )
}
