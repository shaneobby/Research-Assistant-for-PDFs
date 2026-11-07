import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileText, MessageSquareText, NotebookText, RefreshCw, Trash2 } from 'lucide-react'
import { api } from './api/client'
import type { Paper } from './api/types'
import { ChatPanel, type AskRequest } from './components/ChatPanel'
import { Header } from './components/Header'
import { Library } from './components/Library'
import type { JumpRequest } from './components/PdfViewer'
import { PrintSummary } from './components/PrintSummary'
import { SummarySkeleton } from './components/Skeletons'
import { SummaryView } from './components/SummaryView'
import { useToast } from './components/Toasts'
import { DropOverlay, UploadZone, validatePdf, type UploadProgress } from './components/UploadZone'
import { useMediaQuery } from './hooks/useMediaQuery'
import { usePaper } from './hooks/usePaper'
import { useTheme } from './hooks/useTheme'
import { keys, readJSON, removeKey, writeJSON } from './lib/storage'

// pdf.js is large; load it only once a paper is open.
const PdfViewer = lazy(() => import('./components/PdfViewer').then((m) => ({ default: m.PdfViewer })))

type Tab = 'pdf' | 'summary' | 'chat'
const TITLES_KEY = 'marginalia:titles'

export default function App() {
  const toast = useToast()
  const { theme, toggle } = useTheme()
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  const [papers, setPapers] = useState<Paper[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(() => readJSON(keys.selected, null))
  const [titles, setTitles] = useState<Record<string, string>>(() => readJSON(TITLES_KEY, {}))
  const [upload, setUpload] = useState<UploadProgress | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => writeJSON(keys.selected, selectedId), [selectedId])
  useEffect(() => writeJSON(TITLES_KEY, titles), [titles])

  // Library
  useEffect(() => {
    let cancelled = false
    api
      .listPapers()
      .then((list) => {
        if (cancelled) return
        setPapers(list)
        setSelectedId((id) => (id && !list.some((p) => p.id === id) ? null : id))
      })
      .catch((e: Error) => !cancelled && toast.error(`Couldn’t load your library: ${e.message}`))
      .finally(() => !cancelled && setListLoading(false))
    return () => {
      cancelled = true
    }
  }, [toast])

  // Selected paper (polls while processing) mirrored into the library.
  const onPaperUpdate = useCallback((p: Paper) => {
    setPapers((ps) => ps.map((x) => (x.id === p.id ? { ...x, status: p.status, error: p.error, pages: p.pages } : x)))
    const title = p.summary?.title
    if (title) setTitles((t) => (t[p.id] === title ? t : { ...t, [p.id]: title }))
  }, [])
  const { paper, error: paperError, replace } = usePaper(selectedId, onPaperUpdate)

  // Upload
  const handleFile = useCallback(
    async (file: File) => {
      if (upload) return toast.info('Please wait for the current upload to finish.')
      const problem = validatePdf(file)
      if (problem) return toast.error(problem)
      setUpload({ name: file.name, fraction: 0 })
      try {
        const p = await api.uploadPaper(file, (fraction) => setUpload({ name: file.name, fraction }))
        setPapers((ps) => [p, ...ps.filter((x) => x.id !== p.id)])
        setSelectedId(p.id)
        setLibraryOpen(false)
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setUpload(null)
      }
    },
    [toast, upload],
  )

  // Drop a PDF anywhere on the window.
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault()
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const f = e.dataTransfer?.files?.[0]
      if (f) handleFile(f)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [handleFile])

  const handleDelete = useCallback(
    async (p: Paper) => {
      try {
        await api.deletePaper(p.id)
        setPapers((ps) => ps.filter((x) => x.id !== p.id))
        setTitles((t) => {
          const next = { ...t }
          delete next[p.id]
          return next
        })
        removeKey(keys.chat(p.id))
        setSelectedId((id) => (id === p.id ? null : id))
        toast.success(`Deleted ${p.filename}`)
      } catch (e) {
        toast.error(`Delete failed: ${(e as Error).message}`)
      }
    },
    [toast],
  )

  const handleRegenerate = useCallback(async () => {
    if (!paper) return
    try {
      const p = await api.regenerateSummary(paper.id)
      replace(p)
      onPaperUpdate(p)
      toast.info('Regenerating the summary…')
    } catch (e) {
      toast.error(`Couldn’t regenerate: ${(e as Error).message}`)
    }
  }, [paper, replace, onPaperUpdate, toast])

  const selectPaper = (id: string) => {
    setSelectedId(id)
    setLibraryOpen(false)
  }

  const library = (
    <Library
      papers={papers}
      loading={listLoading}
      selectedId={selectedId}
      titles={titles}
      upload={upload}
      onSelect={selectPaper}
      onDelete={handleDelete}
      onNew={() => fileInput.current?.click()}
      onClose={isDesktop ? undefined : () => setLibraryOpen(false)}
    />
  )

  return (
    <>
      <div className="app-shell flex h-full flex-col">
        <Header
          theme={theme}
          onToggleTheme={toggle}
          onToggleLibrary={() => setLibraryOpen((o) => !o)}
          onHome={() => setSelectedId(null)}
        />
        <div className="flex min-h-0 flex-1">
          {isDesktop ? (
            <div className="w-72 shrink-0 border-r border-line-muted">{library}</div>
          ) : (
            libraryOpen && (
              <div className="fixed inset-0 z-30 flex" role="dialog" aria-modal="true" aria-label="Library">
                <div className="h-full w-[min(20rem,85vw)] shadow-2xl">{library}</div>
                <button
                  className="flex-1 bg-canvas/60 backdrop-blur-[2px]"
                  onClick={() => setLibraryOpen(false)}
                  aria-label="Close library"
                />
              </div>
            )
          )}
          <main className="min-w-0 flex-1">
            {!selectedId ? (
              <UploadZone onFile={handleFile} progress={upload} />
            ) : !paper ? (
              paperError ? (
                <CenteredNote title="Couldn’t load this paper" body={paperError} />
              ) : (
                <SummarySkeleton filename="paper" />
              )
            ) : (
              <Workspace
                key={paper.id}
                paper={paper}
                isDesktop={isDesktop}
                onRegenerate={handleRegenerate}
                onDelete={() => handleDelete(paper)}
              />
            )}
          </main>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
            e.target.value = ''
          }}
        />
      </div>
      <DropOverlay active={dragging} />
      {paper?.summary && <PrintSummary paper={paper} summary={paper.summary} />}
    </>
  )
}

function Workspace({
  paper,
  isDesktop,
  onRegenerate,
  onDelete,
}: {
  paper: Paper
  isDesktop: boolean
  onRegenerate: () => void
  onDelete: () => void
}) {
  const [tab, setTab] = useState<Tab>('summary')
  const [jump, setJump] = useState<JumpRequest | null>(null)
  const [ask, setAsk] = useState<AskRequest | null>(null)
  const activeTab: Tab = isDesktop && tab === 'pdf' ? 'summary' : tab

  const onJump = useCallback(
    (page: number) => {
      if (!isDesktop) setTab('pdf')
      setJump({ page, nonce: Date.now() })
    },
    [isDesktop],
  )
  const onAsk = useCallback((question: string) => {
    setTab('chat')
    setAsk({ question, nonce: Date.now() })
  }, [])

  const tabs: { id: Tab; label: string; icon: typeof FileText }[] = [
    ...(isDesktop ? [] : [{ id: 'pdf' as Tab, label: 'PDF', icon: FileText }]),
    { id: 'summary', label: 'Summary', icon: NotebookText },
    { id: 'chat', label: 'Chat', icon: MessageSquareText },
  ]

  const pdf = (
    <Suspense fallback={<div className="h-full bg-canvas" />}>
      <PdfViewer url={api.pdfUrl(paper.id)} filename={paper.filename} jump={jump} />
    </Suspense>
  )

  let summaryBody
  if (paper.status === 'processing') summaryBody = <SummarySkeleton filename={paper.filename} />
  else if (paper.status === 'error' || !paper.summary)
    summaryBody = (
      <CenteredNote
        title="This paper couldn’t be summarised"
        body={paper.error ?? 'The summary is missing.'}
        actions={
          <>
            <button
              onClick={onRegenerate}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-canvas"
            >
              <RefreshCw className="size-3.5" /> Try again
            </button>
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted hover:text-danger"
            >
              <Trash2 className="size-3.5" /> Delete
            </button>
          </>
        }
      />
    )
  else
    summaryBody = (
      <SummaryView paper={paper} summary={paper.summary} onJump={onJump} onRegenerate={onRegenerate} onAsk={onAsk} />
    )

  const panel = (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div role="tablist" aria-label="Paper views" className="flex shrink-0 gap-1 border-b border-line-muted px-3">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => setTab(id)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              activeTab === id ? 'border-primary text-ink' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        {!isDesktop && <div className={`absolute inset-0 ${activeTab === 'pdf' ? '' : 'hidden'}`}>{pdf}</div>}
        <div className={`absolute inset-0 overflow-y-auto ${activeTab === 'summary' ? '' : 'hidden'}`}>{summaryBody}</div>
        {/* Chat stays mounted so a streaming answer survives tab switches. */}
        <div className={`absolute inset-0 ${activeTab === 'chat' ? '' : 'hidden'}`}>
          <ChatPanel paper={paper} onJump={onJump} ask={ask} />
        </div>
      </div>
    </div>
  )

  if (!isDesktop) return panel
  return (
    <div className="grid h-full grid-cols-2 grid-rows-1">
      <div className="min-w-0 border-r border-line-muted">{pdf}</div>
      <div className="min-w-0">{panel}</div>
    </div>
  )
}

function CenteredNote({ title, body, actions }: { title: string; body: string; actions?: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-16">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
          <AlertTriangle className="size-5" />
        </div>
        <h2 className="font-serif text-xl font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-sm text-ink-muted">{body}</p>
        {actions && <div className="mt-5 flex justify-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
