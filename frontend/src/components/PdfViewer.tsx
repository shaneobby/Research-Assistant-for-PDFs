import { useCallback, useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import { ChevronDown, ChevronUp, Download, Minus, Plus, ScanLine } from 'lucide-react'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

export interface JumpRequest {
  page: number
  nonce: number
}

interface Props {
  url: string
  filename: string
  jump: JumpRequest | null
}

const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.35, 1.6, 2]
const A4_RATIO = 1.294 // height / width placeholder until a page reports its size

export function PdfViewer({ url, filename, jump }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const [numPages, setNumPages] = useState(0)
  const [width, setWidth] = useState(600)
  const [zoom, setZoom] = useState(1)
  const [current, setCurrent] = useState(1)
  const [visible, setVisible] = useState<Set<number>>(() => new Set([1, 2]))
  const [ratio, setRatio] = useState(A4_RATIO)
  const [flash, setFlash] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Fit pages to the pane width.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width - 32)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Only render pages near the viewport; track the page in view.
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !numPages) return
    const near = new IntersectionObserver(
      (entries) => {
        const add = entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.page))
        if (add.length) setVisible((v) => (add.every((p) => v.has(p)) ? v : new Set([...v, ...add])))
      },
      { root, rootMargin: '800px 0px' },
    )
    const inView = new IntersectionObserver(
      (entries) => {
        const best = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (best) setCurrent(Number((best.target as HTMLElement).dataset.page))
      },
      { root, threshold: [0.25, 0.5, 0.75] },
    )
    pageRefs.current.slice(0, numPages).forEach((el) => {
      if (el) {
        near.observe(el)
        inView.observe(el)
      }
    })
    return () => {
      near.disconnect()
      inView.disconnect()
    }
  }, [numPages])

  const scrollTo = useCallback(
    (page: number, highlight = false) => {
      const p = Math.min(Math.max(1, page), numPages || 1)
      const el = pageRefs.current[p - 1]
      const root = scrollRef.current
      if (!el || !root) return
      setVisible((v) => new Set([...v, p - 1, p, p + 1]))
      root.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' })
      // Page sizes can still change right after a jump (lazy renders, a just-shown pane resizing),
      // so correct the position once things settle.
      for (const ms of [450, 900]) {
        setTimeout(() => {
          const target = el.offsetTop - 12
          if (Math.abs(root.scrollTop - target) > 8) root.scrollTo({ top: target })
        }, ms)
      }
      if (highlight) {
        setFlash(null)
        requestAnimationFrame(() => setFlash(p))
      }
    },
    [numPages],
  )

  useEffect(() => {
    if (!jump || !numPages) return
    // Next frame: on mobile the viewer tab may have just become visible.
    const id = requestAnimationFrame(() => scrollTo(jump.page, true))
    return () => cancelAnimationFrame(id)
  }, [jump, numPages, scrollTo])

  useEffect(() => {
    if (flash == null) return
    const t = setTimeout(() => setFlash(null), 1500)
    return () => clearTimeout(t)
  }, [flash])

  const zoomIdx = ZOOMS.indexOf(zoom)
  const pageWidth = Math.round(width * zoom)

  const btn =
    'inline-flex size-8 items-center justify-center rounded-md text-ink-muted transition hover:bg-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex items-center gap-1 border-b border-line-muted bg-surface px-2 py-1.5 text-sm">
        <button className={btn} onClick={() => scrollTo(current - 1)} disabled={current <= 1} aria-label="Previous page">
          <ChevronUp className="size-4" />
        </button>
        <button
          className={btn}
          onClick={() => scrollTo(current + 1)}
          disabled={current >= numPages}
          aria-label="Next page"
        >
          <ChevronDown className="size-4" />
        </button>
        <span className="whitespace-nowrap px-1 font-mono text-xs tabular-nums text-ink-muted" aria-live="polite">
          {numPages ? `${current} / ${numPages}` : '–'}
        </span>
        <div className="mx-1 h-5 w-px bg-line-muted" />
        <button
          className={btn}
          onClick={() => setZoom(ZOOMS[Math.max(0, zoomIdx - 1)])}
          disabled={zoomIdx <= 0}
          aria-label="Zoom out"
        >
          <Minus className="size-4" />
        </button>
        <button
          className="rounded-md px-1.5 py-1 font-mono text-xs tabular-nums text-ink-muted hover:bg-raised hover:text-ink"
          onClick={() => setZoom(1)}
          title="Fit width"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          className={btn}
          onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIdx + 1)])}
          disabled={zoomIdx >= ZOOMS.length - 1}
          aria-label="Zoom in"
        >
          <Plus className="size-4" />
        </button>
        <button
          className={`${btn} max-sm:hidden`}
          onClick={() => setZoom(1)}
          aria-label="Fit to width"
          title="Fit to width"
        >
          <ScanLine className="size-4" />
        </button>
        <span className="ml-auto truncate px-2 text-xs text-ink-muted max-sm:hidden" title={filename}>
          {filename}
        </span>
        <a className={`${btn} max-sm:ml-auto`} href={url} download={filename} aria-label="Download PDF" title="Download PDF">
          <Download className="size-4" />
        </a>
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto px-4 py-4">
        {loadError ? (
          <div className="mx-auto mt-16 max-w-sm text-center text-sm text-ink-muted">
            <p className="font-serif text-lg text-ink">Couldn’t open the PDF</p>
            <p className="mt-1">{loadError}</p>
          </div>
        ) : (
          <Document
            file={url}
            suspense={false} // otherwise load errors skip onLoadError and take down the whole app
            onLoadSuccess={(doc) => {
              setNumPages(doc.numPages)
              setLoadError(null)
              doc
                .getPage(1)
                .then((p) => {
                  const vp = p.getViewport({ scale: 1 })
                  setRatio(vp.height / vp.width)
                })
                .catch(() => {})
            }}
            onLoadError={(e) => setLoadError(e.message)}
            loading={<PdfSkeleton width={pageWidth} ratio={ratio} />}
            className="flex flex-col items-center gap-4"
          >
            {Array.from({ length: numPages }, (_, i) => {
              const n = i + 1
              return (
                <div
                  key={n}
                  ref={(el) => {
                    pageRefs.current[i] = el
                  }}
                  data-page={n}
                  className={`pdf-page relative rounded-sm bg-white shadow-md ring-1 ring-black/5 ${flash === n ? 'page-flash' : ''}`}
                  style={{ width: pageWidth, minHeight: Math.round(pageWidth * ratio) }}
                >
                  {visible.has(n) ? (
                    <Page
                      pageNumber={n}
                      width={pageWidth}
                      loading={<div className="skeleton" style={{ height: Math.round(pageWidth * ratio) }} />}
                    />
                  ) : null}
                  <span className="pointer-events-none absolute -left-1 top-2 -translate-x-full font-mono text-[0.65rem] text-ink-muted max-sm:hidden">
                    {n}
                  </span>
                </div>
              )
            })}
          </Document>
        )}
      </div>
    </div>
  )
}

function PdfSkeleton({ width, ratio }: { width: number; ratio: number }) {
  return (
    <div className="flex flex-col items-center gap-4">
      {[0, 1].map((i) => (
        <div key={i} className="skeleton" style={{ width, height: Math.round(width * ratio) }} />
      ))}
    </div>
  )
}
