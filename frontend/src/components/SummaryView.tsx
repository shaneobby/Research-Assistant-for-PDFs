import { useState, type ReactNode } from 'react'
import { Check, Copy, FileDown, Printer, RefreshCw, Sparkles } from 'lucide-react'
import type { Paper, Summary, SummarySection } from '../api/types'
import { downloadText, slugify, summaryToMarkdown } from '../lib/markdown'
import { Markdown } from './Markdown'
import { PageChip } from './PageChip'
import { useToast } from './Toasts'

interface Props {
  paper: Paper
  summary: Summary
  onJump: (page: number) => void
  onRegenerate: () => void
  onAsk: (question: string) => void
}

export function SummaryView({ paper, summary: s, onJump, onRegenerate, onAsk }: Props) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const pages = (k: SummarySection) => s.source_pages?.[k] ?? []

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summaryToMarkdown(paper, s))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('Clipboard is not available in this browser.')
    }
  }

  return (
    <article className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-8">
      {/* Actions */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <ActionButton onClick={copy} icon={copied ? Check : Copy} label={copied ? 'Copied' : 'Copy Markdown'} />
        <ActionButton
          onClick={() => downloadText(`${slugify(s.title || paper.filename)}-summary.md`, summaryToMarkdown(paper, s))}
          icon={FileDown}
          label="Download .md"
        />
        <ActionButton onClick={() => window.print()} icon={Printer} label="Print / PDF" />
        <ActionButton onClick={onRegenerate} icon={RefreshCw} label="Regenerate" className="sm:ml-auto" />
      </div>

      {/* Title block */}
      <header className="border-b border-line-muted pb-6">
        <p className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-primary">
          {paper.pages} pages · {paper.filename}
        </p>
        <h1 className="font-serif text-3xl font-semibold leading-tight text-balance text-ink sm:text-[2.1rem]">
          {s.title || paper.filename}
        </h1>
        {s.authors?.length > 0 && (
          <p className="mt-3 font-serif text-lg italic text-ink-muted">{s.authors.join(', ')}</p>
        )}
        {s.keywords?.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Keywords">
            {s.keywords.map((k) => (
              <li
                key={k}
                className="rounded-full border border-secondary/25 bg-secondary-soft px-2.5 py-0.5 text-xs font-medium text-secondary"
              >
                {k}
              </li>
            ))}
          </ul>
        )}
      </header>

      {/* Abstract */}
      {s.abstract && (
        <section className="mt-6">
          <SectionLabel>Abstract</SectionLabel>
          <div className="mt-2 border-l-2 border-primary pl-4">
            <Markdown onJump={onJump} className="font-serif text-[1.05rem] leading-relaxed">
              {s.abstract}
            </Markdown>
          </div>
        </section>
      )}

      <Section n={1} title="Problem Statement" pages={pages('problem_statement')} onJump={onJump}>
        <Markdown onJump={onJump}>{s.problem_statement}</Markdown>
      </Section>

      <Section n={2} title="Methodology" pages={pages('methodology')} onJump={onJump}>
        <Markdown onJump={onJump}>{s.methodology}</Markdown>
      </Section>

      <Section n={3} title="Key Results" pages={pages('key_results')} onJump={onJump}>
        <ol className="space-y-3">
          {(s.key_results ?? []).map((r, i) => (
            <li key={i} className="flex gap-4">
              <span className="w-6 shrink-0 text-right font-serif text-2xl leading-none font-semibold text-primary tabular-nums">
                {i + 1}
              </span>
              <Markdown onJump={onJump} className="min-w-0 flex-1 [&>p]:m-0">
                {r}
              </Markdown>
            </li>
          ))}
        </ol>
      </Section>

      <Section n={4} title="Conclusion" pages={pages('conclusion')} onJump={onJump}>
        <Markdown onJump={onJump}>{s.conclusion}</Markdown>
      </Section>

      {s.suggested_questions?.length > 0 && (
        <section className="card mt-10 rounded-xl p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <Sparkles className="size-4 text-primary" /> Ask the paper
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {s.suggested_questions.map((q) => (
              <button
                key={q}
                onClick={() => onAsk(q)}
                className="rounded-lg border border-line-muted bg-surface px-3 py-2 text-left text-sm text-ink-muted transition hover:border-primary/50 hover:text-ink"
              >
                {q}
              </button>
            ))}
          </div>
        </section>
      )}
    </article>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ink-muted">{children}</h2>
}

function Section({
  n,
  title,
  pages,
  onJump,
  children,
}: {
  n: number
  title: string
  pages: number[]
  onJump: (p: number) => void
  children: ReactNode
}) {
  return (
    <section className="mt-9">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-serif text-xl font-semibold text-ink">
          <span className="mr-2 text-primary">§{n}</span>
          {title}
        </h2>
        {pages.length > 0 && (
          <span className="flex flex-wrap gap-1" aria-label="Source pages">
            {pages.map((p) => (
              <PageChip key={p} page={p} onJump={onJump} size="md" />
            ))}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}

function ActionButton({
  onClick,
  icon: Icon,
  label,
  className = '',
}: {
  onClick: () => void
  icon: typeof Copy
  label: string
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border border-line-muted bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:border-line hover:text-ink ${className}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  )
}
